// Cari kreator Creator Marketplace untuk diundang ke program afiliasi.
// Body: keyword?, count_ge?, count_le?, not_invited_l90_days?,
// category_parent_id?, category_child_ids?, sorter_algorithm_id?,
// page_token?, search_key?, page_size? (hanya 12 atau 20),
// pages? (1-20, berapa halaman dipindai server-side per panggilan).
// Hasil otomatis disimpan ke cache kandidat (kolam kreator untuk cron auto).
// Antarpage diberi jeda 2 detik + backoff bertahap karena batas rate TikTok
// bersifat dinamis per app-group (kode 36009002); halaman yang tetap gagal
// dicatat di page_errors (klien bisa lanjut lewat Muat Lebih).
//
// Auth: sesi admin (isAuthed) ATAU CRON_SECRET (Bearer / x-cron-secret /
// ?secret=) — pola sama dengan route afiliasi lainnya.
import { isAuthed } from "@/lib/auth";
import {
  prepareAffiliateShop,
  searchMarketplaceCreators,
  sleep,
  type AffiliateCreatorRow,
} from "@/lib/tiktok-affiliate";
import { upsertAffiliateCreatorCache } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

function strOf(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function numOf(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export async function POST(request: Request) {
  if (!cronAuthorized(request) && !(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const prep = await prepareAffiliateShop();
  if (!prep.ok) {
    return Response.json({ ok: false, detail: prep.detail });
  }

  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const filter = {
    keyword: strOf(body.keyword) || undefined,
    countGe: numOf(body.count_ge),
    countLe: numOf(body.count_le),
    notInvitedL90Days: body.not_invited_l90_days === true,
    categoryParentId: strOf(body.category_parent_id) || undefined,
    categoryChildIds: Array.isArray(body.category_child_ids)
      ? (body.category_child_ids as unknown[]).map(String)
      : undefined,
    sorterAlgorithmId: strOf(body.sorter_algorithm_id) || undefined,
  };
  // Pindai beberapa halaman marketplace sekaligus (param pages, maks 20)
  // agar daftar kreator langsung banyak tanpa bolak-balik panggilan.
  const pageSize = Number(body.page_size ?? 20);
  const rawPages = Number(body.pages ?? 1);
  const maxPages = Math.min(
    Math.max(Number.isFinite(rawPages) ? Math.floor(rawPages) : 1, 1),
    20,
  );
  let token = strOf(body.page_token) || undefined;
  let key = strOf(body.search_key) || undefined;
  const seen = new Set<string>();
  const items: AffiliateCreatorRow[] = [];
  const pageErrors: { page: number; code: number | null; detail: string }[] =
    [];
  let pagesScanned = 0;
  let nextPageToken = "";
  let searchKey = key ?? "";
  for (let p = 0; p < maxPages; p += 1) {
    // Jeda antarpage: batas rate TikTok dinamis per app-group (36009002),
    // jadi biarkan napas 2 detik antara panggilan marketplace.
    if (p > 0) await sleep(2000);
    let res = await searchMarketplaceCreators(prep.ctx, filter, {
      pageToken: token,
      searchKey: key,
      pageSize,
    });
    // Backoff bertahap bila kena rate-limit app-group sesaat.
    for (let t = 0; !res.ok && p > 0 && t < 2; t += 1) {
      await sleep(3000 + t * 3000);
      res = await searchMarketplaceCreators(prep.ctx, filter, {
        pageToken: token,
        searchKey: key,
        pageSize,
      });
    }
    if (!res.ok) {
      if (p === 0) return Response.json({ ok: false, detail: res.detail });
      pageErrors.push({
        page: p + 1,
        code: res.code ?? null,
        detail: res.detail,
      });
      break;
    }
    pagesScanned += 1;
    for (const c of res.items) {
      if (!seen.has(c.creatorOpenId)) {
        seen.add(c.creatorOpenId);
        items.push(c);
      }
    }
    nextPageToken = res.nextPageToken;
    searchKey = res.searchKey;
    if (!res.nextPageToken) break;
    token = res.nextPageToken;
    key = res.searchKey;
  }

  // Simpan ke cache kandidat agar cron auto punya kolam kreator.
  await upsertAffiliateCreatorCache(
    items.map((c) => ({
      creator_open_id: c.creatorOpenId,
      username: c.username,
      nickname: c.nickname,
      avatar_url: c.avatarUrl,
      follower_count: c.followerCount,
      data: JSON.stringify(c),
    })),
  );

  return Response.json({
    ok: true,
    items,
    next_page_token: nextPageToken,
    search_key: searchKey,
    pages_scanned: pagesScanned,
    page_errors: pageErrors,
  });
}
