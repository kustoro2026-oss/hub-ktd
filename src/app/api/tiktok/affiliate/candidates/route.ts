// Daftar kandidat kreator dari cache (kolam yang sudah terkumpul dari
// pencarian marketplace + cron auto). Dipakai TabCari untuk langsung
// menampilkan banyak kreator tanpa perlu mencari dari TikTok dulu.
//
// Query: limit? (1-2000, default 500).
// Auth: sesi admin (isAuthed) ATAU CRON_SECRET — pola route afiliasi.
import { isAuthed } from "@/lib/auth";
import { listAffiliateCreatorCandidates } from "@/lib/db";

export const dynamic = "force-dynamic";

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

export async function GET(request: Request) {
  if (!cronAuthorized(request) && !(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const rawLimit = Number(new URL(request.url).searchParams.get("limit") ?? 500);
  const limit = Math.min(
    Math.max(Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 500, 1),
    2000,
  );
  const rows = await listAffiliateCreatorCandidates({ limit });
  const items = rows.map((row) => {
    // Kolom data menyimpan JSON AffiliateCreatorRow lengkap; kolom datar
    // dipakai sebagai cadangan bila JSON kosong/rusak.
    try {
      const d = JSON.parse(row.data) as Record<string, unknown>;
      return {
        creatorOpenId: String(d.creatorOpenId ?? row.creator_open_id),
        username: String(d.username ?? row.username),
        nickname: String(d.nickname ?? row.nickname),
        avatarUrl: String(d.avatarUrl ?? row.avatar_url),
        followerCount: Number(d.followerCount ?? row.follower_count ?? 0),
        categoryIds: Array.isArray(d.categoryIds)
          ? (d.categoryIds as unknown[]).map(String)
          : [],
        avgEcLiveUv: Number(d.avgEcLiveUv ?? 0),
        avgEcVideoViewCount: Number(d.avgEcVideoViewCount ?? 0),
        gmv: (d.gmv ?? null) as { currency: string; amount: number } | null,
        hasCollaborated: d.hasCollaborated === true,
        hasInvited90d: d.hasInvited90d === true,
        isCreatorBlocked: d.isCreatorBlocked === true,
        creatorLevel: Number(d.creatorLevel ?? 0),
        ppsScore: String(d.ppsScore ?? ""),
        isFastGrowing: d.isFastGrowing === true,
      };
    } catch {
      return {
        creatorOpenId: row.creator_open_id,
        username: row.username,
        nickname: row.nickname,
        avatarUrl: row.avatar_url,
        followerCount: row.follower_count,
        categoryIds: [],
        avgEcLiveUv: 0,
        avgEcVideoViewCount: 0,
        gmv: null,
        hasCollaborated: false,
        hasInvited90d: false,
        isCreatorBlocked: false,
        creatorLevel: 0,
        ppsScore: "",
        isFastGrowing: false,
      };
    }
  });
  return Response.json({ ok: true, items });
}
