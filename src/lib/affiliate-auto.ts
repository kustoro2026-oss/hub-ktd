// Orkestrasi undangan afiliasi TikTok otomatis — logika cron harian dalam
// satu fungsi supaya dipakai bersama route Vercel dan worker VPS.
// Alur tiap run:
//   1. Baca pengaturan (saklar auto_enabled, cap harian, filter follower,
//      daftar produk, komisi, kontak penjual).
//   2. PANEN dulu (selalu): cari kreator marketplace (filter follower +
//      belum diundang 90 hari) beberapa halaman, simpan ke cache kandidat —
//      supaya kolam kreator terus tumbuh meski cap undangan sudah tercapai.
//   3. Hentikan bila cap undangan hari ini (WIB) sudah tercapai.
//   4. Gabung hasil pencarian + cache lama, lalu BUANG kreator yang sudah
//      diundang menurut jurnal internal (filter 90 hari TikTok terbukti
//      bocor — dedup wajib pakai catatan sendiri).
//   5. Cek eligibilitas (blocked/connected/paired/quota per tingkat).
//   6. Undang berurutan (batch 50, pemecahan adaptif untuk error
//      per-kreator) sampai cap tercapai, jurnal tiap batch.
import {
  checkCreatorOutreachEligibility,
  collaborationNameStamp,
  journalInviteBatch,
  prepareAffiliateShop,
  searchMarketplaceCreators,
  sendTargetCollaborationInvites,
  sleep,
  type AffiliateCreatorRow,
} from "@/lib/tiktok-affiliate";
import { filterActiveProductIds } from "@/lib/tiktok-products";
import {
  countAffiliateInvitesSentSince,
  getAffiliateSettings,
  listAffiliateCreatorCandidates,
  listInvitedCreatorOpenIds,
  upsertAffiliateCreatorCache,
} from "@/lib/db";

const AUTO = {
  DEFAULT_CAP: 500,
  MAX_CAP: 1000,
  SEARCH_PAGES: 15,
  SEARCH_PAGE_SIZE: 20,
  CACHE_LIMIT: 300,
  MAX_INVITE_PER_RUN: 500,
};

type Candidate = { creatorOpenId: string; followerCount: number };

export type AffiliateAutoResult = {
  ok: boolean;
  skipped?: "disabled" | "cap" | "empty" | "ineligible" | "conflict";
  detail?: string;
  searched?: number;
  cached?: number;
  invited?: number;
  batches_total?: number;
  batches_failed?: number;
  candidates_checked?: number;
  eligible?: number;
  checked?: number;
  sent_today?: number;
  daily_cap?: number;
  invalid_products?: number;
};

/** Jalankan satu siklus undangan afiliasi otomatis. */
export async function runAffiliateAutoCron(): Promise<AffiliateAutoResult> {
  const settings = await getAffiliateSettings();
  if (settings.auto_enabled !== "1") {
    return {
      ok: true,
      skipped: "disabled",
      detail: "Pengundang otomatis dimatikan.",
    };
  }

  let productIds: string[] = [];
  try {
    const parsed = JSON.parse(settings.product_ids ?? "") as unknown;
    if (Array.isArray(parsed)) {
      productIds = parsed.map(String).filter((s) => s !== "");
    }
  } catch {
    productIds = [];
  }
  const commissionRaw = Number(settings.commission_percent ?? 15);
  const commissionPercent = Math.min(
    Math.max(Number.isFinite(commissionRaw) ? commissionRaw : 15, 0.01),
    50,
  );

  const prep = await prepareAffiliateShop();
  if (!prep.ok) {
    return { ok: false, detail: prep.detail };
  }

  // 1) Cari kreator marketplace sesuai filter pengaturan.
  const filter = {
    countGe: Number(settings.min_followers ?? "") || undefined,
    countLe: Number(settings.max_followers ?? "") || undefined,
    notInvitedL90Days: true,
    sorterAlgorithmId: settings.sorter_algorithm_id ?? undefined,
  };
  const fresh: AffiliateCreatorRow[] = [];
  let pageToken = "";
  let searchKey = "";
  for (let p = 0; p < AUTO.SEARCH_PAGES; p += 1) {
    // Jeda antarpage: batas rate TikTok dinamis per app-group (36009002).
    if (p > 0) await sleep(2000);
    let res = await searchMarketplaceCreators(
      prep.ctx,
      filter,
      {
        pageToken: pageToken || undefined,
        searchKey: searchKey || undefined,
        pageSize: AUTO.SEARCH_PAGE_SIZE,
      },
    );
    // Backoff bertahap bila kena rate-limit app-group sesaat. Bisa terjadi
    // bahkan di halaman pertama karena kuota dibagi satu grup aplikasi.
    for (let t = 0; !res.ok && t < 2; t += 1) {
      await sleep(3000 + t * 3000);
      res = await searchMarketplaceCreators(
        prep.ctx,
        filter,
        {
          pageToken: pageToken || undefined,
          searchKey: searchKey || undefined,
          pageSize: AUTO.SEARCH_PAGE_SIZE,
        },
      );
    }
    if (!res.ok) {
      // Pencarian gagal (mis. kuota harian pencarian) — lanjut pakai cache.
      break;
    }
    fresh.push(...res.items);
    searchKey = res.searchKey;
    if (!res.nextPageToken) break;
    pageToken = res.nextPageToken;
  }
  if (fresh.length > 0) {
    await upsertAffiliateCreatorCache(
      fresh.map((c) => ({
        creator_open_id: c.creatorOpenId,
        username: c.username,
        nickname: c.nickname,
        avatar_url: c.avatarUrl,
        follower_count: c.followerCount,
        data: JSON.stringify(c),
      })),
    );
  }

  // Panen di atas selalu jalan supaya kolam kandidat terus tumbuh meski cap
  // undangan hari ini sudah tercapai.
  const capRaw = Number(settings.daily_cap ?? AUTO.DEFAULT_CAP);
  const dailyCap = Number.isFinite(capRaw) && capRaw > 0
    ? Math.min(Math.floor(capRaw), AUTO.MAX_CAP)
    : AUTO.DEFAULT_CAP;
  // Cap dihitung per hari kalender WIB (bukan 24 jam berjalan) supaya dua
  // run cron harian (08:30 & 14:30 WIB) sama-sama bisa mengisi cap harian.
  const now = new Date();
  const wibMidnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), -7),
  ).toISOString();
  const sentToday = await countAffiliateInvitesSentSince(wibMidnight);
  const remaining = dailyCap - sentToday;
  if (remaining <= 0) {
    return {
      ok: true,
      skipped: "cap",
      searched: fresh.length,
      sent_today: sentToday,
      daily_cap: dailyCap,
    };
  }
  if (productIds.length === 0) {
    return {
      ok: false,
      searched: fresh.length,
      detail:
        "Pengaturan produk belum diisi — pilih produk dulu di halaman Afiliasi.",
    };
  }
  // Validasi produk terhadap daftar toko live: produk terhapus/ternonaktifkan
  // membuat TikTok membalas 200 TANPA membuat kolaborasi (kegagalan senyap
  // yang dulu lolos tercatat "sent"). Saring di sini + hentikan bila kosong.
  const prodCheck = await filterActiveProductIds(prep.ctx, productIds);
  if (!prodCheck.ok) {
    return { ok: false, searched: fresh.length, detail: prodCheck.detail };
  }
  if (prodCheck.valid.length === 0) {
    return {
      ok: false,
      searched: fresh.length,
      detail:
        "Semua produk di pengaturan sudah tidak aktif/terhapus di TikTok — perbarui daftar produk di halaman Afiliasi.",
    };
  }
  productIds = prodCheck.valid;

  // 2) Kolam kandidat: hasil pencarian baru + cache lama.
  const cached = await listAffiliateCreatorCandidates({
    limit: AUTO.CACHE_LIMIT,
  });
  const byId = new Map<string, Candidate>();
  for (const row of cached) {
    let candidate: Candidate = {
      creatorOpenId: row.creator_open_id,
      followerCount: row.follower_count,
    };
    try {
      const parsed = JSON.parse(row.data) as Partial<AffiliateCreatorRow>;
      if (parsed.creatorOpenId) {
        candidate = {
          creatorOpenId: parsed.creatorOpenId,
          followerCount: parsed.followerCount ?? row.follower_count,
        };
      }
    } catch {
      // Baris cache tanpa data utuh — pakai kolom cache apa adanya.
    }
    byId.set(candidate.creatorOpenId, candidate);
  }
  for (const c of fresh) {
    byId.set(c.creatorOpenId, {
      creatorOpenId: c.creatorOpenId,
      followerCount: c.followerCount,
    });
  }

  // 3) Dedup wajib pakai jurnal internal — filter "belum diundang 90 hari"
  //    TikTok terbukti bocor (kreator yang sudah diundang muncul lagi).
  const invitedSet = new Set(await listInvitedCreatorOpenIds());
  const pool = [...byId.values()]
    .filter((c) => !invitedSet.has(c.creatorOpenId))
    .sort((a, b) => b.followerCount - a.followerCount)
    .slice(0, Math.min(remaining, AUTO.MAX_INVITE_PER_RUN));
  if (pool.length === 0) {
    return {
      ok: true,
      skipped: "empty",
      searched: fresh.length,
      cached: cached.length,
      sent_today: sentToday,
      daily_cap: dailyCap,
    };
  }

  // 4) Cek eligibilitas (100 per panggilan, dipotong lib).
  const elig = await checkCreatorOutreachEligibility(
    prep.ctx,
    pool.map((c) => c.creatorOpenId),
  );
  if (!elig.ok) {
    return { ok: false, detail: elig.detail };
  }
  const eligible = new Set(
    elig.results
      .filter(
        (r) =>
          !r.isBlocked &&
          !r.isConnected &&
          !r.isPaired &&
          r.isFollowerThresholdMet &&
          r.isLevelQuotaAvailable,
      )
      .map((r) => r.creatorOpenId),
  );
  const target = pool
    .map((c) => c.creatorOpenId)
    .filter((id) => eligible.has(id))
    .slice(0, remaining);
  if (target.length === 0) {
    return {
      ok: true,
      skipped: "ineligible",
      checked: pool.length,
      sent_today: sentToday,
      daily_cap: dailyCap,
    };
  }

  // 5) Undang + jurnal tiap batch.
  const products = productIds.map((id) => ({
    id,
    targetCommissionRate: Math.round(commissionPercent * 100),
  }));
  const summary = await sendTargetCollaborationInvites(
    prep.ctx,
    {
      name: `UndanganAutoKTD${collaborationNameStamp()}`,
      endTime: String(Math.floor(Date.now() / 1000) + 30 * 86400),
      products,
      creatorUserOpenIds: target,
      sellerContactInfo: {
        email: settings.contact_email ?? "",
        phoneNumber: settings.contact_phone ?? "",
        whatsapp: settings.contact_whatsapp ?? "",
        telegram: settings.contact_telegram ?? "",
        line: "",
      },
      // Kebijakan toko: tanpa sampel gratis (anti-penyalahgunaan sampel).
      freeSampleRule: { hasFreeSample: false, isSampleApprovalExempt: false },
    },
    async (_index, batch) => {
      await journalInviteBatch(prep.shop.shop_id, productIds, batch);
    },
  );
  if (!summary.ok) {
    return { ok: false, detail: summary.detail };
  }
  const failed = summary.batches.filter((b) => !b.ok);
  // Gagal "keras": batch tanpa satu pun keterangan konflik/open id invalid —
  // berarti error API, produk invalid, nama buruk, rate-limit, dll. Hanya ini
  // yang layak dilaporkan sebagai kegagalan pekerjaan. Gagal "lunak" (TikTok
  // menolak membuat kolaborasi semata karena kreator sudah diundang/open id
  // invalid) bukan kesalahan job — kreatornya sudah dijurnal conflict/invalid.
  const hardFailed = failed.filter(
    (b) => b.conflicts.length === 0 && b.invalidOpenIds.length === 0,
  );
  if (failed.length > 0 && failed.length === summary.batches.length) {
    if (hardFailed.length === 0) {
      // Semua batch "gagal" hanya karena kreator sudah diundang sebelumnya —
      // bukan kegagalan pekerjaan. Kembalikan ok:true supaya worker tidak
      // mengirim notif WA false-alarm tiap hari (tembok konflik massal).
      const skippedPairs = summary.batches.reduce(
        (sum, b) => sum + b.conflicts.length + b.invalidOpenIds.length,
        0,
      );
      return {
        ok: true,
        skipped: "conflict",
        invited: 0,
        batches_total: summary.batches.length,
        batches_failed: failed.length,
        candidates_checked: pool.length,
        eligible: target.length,
        sent_today: sentToday,
        daily_cap: dailyCap,
        detail: `Semua kandidat sudah diundang sebelumnya — ${skippedPairs} pasangan kreator–produk dilewati (conflict/open id invalid).`,
      };
    }
    const first = hardFailed[0];
    return {
      ok: false,
      invited: 0,
      batches_total: summary.batches.length,
      batches_failed: failed.length,
      candidates_checked: pool.length,
      eligible: target.length,
      sent_today: sentToday,
      daily_cap: dailyCap,
      detail: `Semua batch undangan gagal — ${first?.detail ?? "tanpa keterangan"}`,
    };
  }
  return {
    ok: true,
    invited: summary.invitedCount,
    batches_total: summary.batches.length,
    batches_failed: failed.length,
    candidates_checked: pool.length,
    eligible: target.length,
    sent_today: sentToday,
    daily_cap: dailyCap,
    invalid_products: prodCheck.invalid.length,
  };
}
