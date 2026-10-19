// Pengundang otomatis (cron adaptif): undang kreator per jadwal dengan cap
// harian. Alur tiap run:
//   1. Baca pengaturan (saklar auto_enabled, cap harian, filter follower,
//      daftar produk, komisi, kontak penjual).
//   2. Hentikan bila cap undangan hari ini (WIB) sudah tercapai.
//   3. Cari kreator marketplace (filter follower + belum diundang 90 hari)
//      beberapa halaman, simpan ke cache kandidat.
//   4. Gabung hasil pencarian + cache lama, lalu BUANG kreator yang sudah
//      diundang menurut jurnal internal (filter 90 hari TikTok terbukti
//      bocor — dedup wajib pakai catatan sendiri).
//   5. Cek eligibilitas (blocked/connected/paired/quota per tingkat).
//   6. Undang berurutan (batch 50, pemecahan adaptif untuk error
//      per-kreator) sampai cap tercapai, jurnal tiap batch.
//
// Dipanggil Vercel Cron (vercel.json) dengan header Authorization: Bearer.
// Auth: CRON_SECRET atau sesi admin — pola route afiliasi.
import { isAuthed } from "@/lib/auth";
import {
  checkCreatorOutreachEligibility,
  journalInviteBatch,
  prepareAffiliateShop,
  searchMarketplaceCreators,
  sendTargetCollaborationInvites,
  type AffiliateCreatorRow,
} from "@/lib/tiktok-affiliate";
import {
  countAffiliateInvitesSentSince,
  getAffiliateSettings,
  listAffiliateCreatorCandidates,
  listInvitedCreatorOpenIds,
  upsertAffiliateCreatorCache,
} from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const AUTO = {
  DEFAULT_CAP: 500,
  MAX_CAP: 1000,
  SEARCH_PAGES: 5,
  SEARCH_PAGE_SIZE: 20,
  CACHE_LIMIT: 300,
  MAX_INVITE_PER_RUN: 500,
};

type Candidate = { creatorOpenId: string; followerCount: number };

/** True bila secret cocok lewat salah satu saluran yang didukung. */
function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  const given =
    (auth.startsWith("Bearer ") ? auth.slice(7) : "") ||
    request.headers.get("x-cron-secret") ||
    new URL(request.url).searchParams.get("secret");
  return given === secret;
}

export async function POST(request: Request) {
  if (!cronAuthorized(request) && !(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const settings = await getAffiliateSettings();
  if (settings.auto_enabled !== "1") {
    return Response.json({
      ok: true,
      skipped: "disabled",
      detail: "Pengundang otomatis dimatikan.",
    });
  }

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
    return Response.json({
      ok: true,
      skipped: "cap",
      sent_today: sentToday,
      daily_cap: dailyCap,
    });
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
  if (productIds.length === 0) {
    return Response.json({
      ok: false,
      detail:
        "Pengaturan produk belum diisi — pilih produk dulu di halaman Afiliasi.",
    });
  }
  const commissionRaw = Number(settings.commission_percent ?? 15);
  const commissionPercent = Math.min(
    Math.max(Number.isFinite(commissionRaw) ? commissionRaw : 15, 0.01),
    50,
  );

  const prep = await prepareAffiliateShop();
  if (!prep.ok) {
    return Response.json({ ok: false, detail: prep.detail });
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
    const res = await searchMarketplaceCreators(
      prep.ctx,
      filter,
      {
        pageToken: pageToken || undefined,
        searchKey: searchKey || undefined,
        pageSize: AUTO.SEARCH_PAGE_SIZE,
      },
    );
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
    return Response.json({
      ok: true,
      skipped: "empty",
      searched: fresh.length,
      cached: cached.length,
      sent_today: sentToday,
      daily_cap: dailyCap,
    });
  }

  // 4) Cek eligibilitas (100 per panggilan, dipotong lib).
  const elig = await checkCreatorOutreachEligibility(
    prep.ctx,
    pool.map((c) => c.creatorOpenId),
  );
  if (!elig.ok) {
    return Response.json({ ok: false, detail: elig.detail });
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
    return Response.json({
      ok: true,
      skipped: "ineligible",
      checked: pool.length,
      sent_today: sentToday,
      daily_cap: dailyCap,
    });
  }

  // 5) Undang + jurnal tiap batch.
  const products = productIds.map((id) => ({
    id,
    targetCommissionRate: Math.round(commissionPercent * 100),
  }));
  const summary = await sendTargetCollaborationInvites(
    prep.ctx,
    {
      name: `Undangan Auto KTD ${new Date()
        .toISOString()
        .slice(0, 16)
        .replace("T", " ")}`,
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
    return Response.json({ ok: false, detail: summary.detail });
  }
  return Response.json({
    ok: true,
    invited: summary.invitedCount,
    batches_total: summary.batches.length,
    batches_failed: summary.batches.filter((b) => !b.ok).length,
    candidates_checked: pool.length,
    eligible: target.length,
    sent_today: sentToday,
    daily_cap: dailyCap,
  });
}
