// Cari kreator Creator Marketplace untuk diundang ke program afiliasi.
// Body: keyword?, count_ge?, count_le?, not_invited_l90_days?,
// category_parent_id?, category_child_ids?, sorter_algorithm_id?,
// page_token?, search_key?, page_size? (hanya 12 atau 20).
// Hasil otomatis disimpan ke cache kandidat (kolam kreator untuk cron auto).
//
// Auth: sesi admin (isAuthed) ATAU CRON_SECRET (Bearer / x-cron-secret /
// ?secret=) — pola sama dengan route afiliasi lainnya.
import { isAuthed } from "@/lib/auth";
import {
  prepareAffiliateShop,
  searchMarketplaceCreators,
} from "@/lib/tiktok-affiliate";
import { upsertAffiliateCreatorCache } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

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
  const res = await searchMarketplaceCreators(prep.ctx, filter, {
    pageToken: strOf(body.page_token) || undefined,
    searchKey: strOf(body.search_key) || undefined,
    pageSize: Number(body.page_size ?? 20),
  });
  if (!res.ok) {
    return Response.json({ ok: false, detail: res.detail });
  }

  // Simpan ke cache kandidat agar cron auto punya kolam kreator.
  await upsertAffiliateCreatorCache(
    res.items.map((c) => ({
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
    items: res.items,
    next_page_token: res.nextPageToken,
    search_key: res.searchKey,
  });
}
