// Riwayat outreach mingguan dari TikTok (kreator yang baru terhubung).
// Query: page_index? (default 1), page_size? (default 50, 2–50).
//
// Auth: sesi admin (isAuthed) ATAU CRON_SECRET — pola route afiliasi.
import { isAuthed } from "@/lib/auth";
import {
  getCreatorOutreachRecords,
  prepareAffiliateShop,
} from "@/lib/tiktok-affiliate";

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

export async function GET(request: Request) {
  if (!cronAuthorized(request) && !(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const url = new URL(request.url);
  const pageIndexRaw = Number(url.searchParams.get("page_index") ?? 1);
  const pageSizeRaw = Number(url.searchParams.get("page_size") ?? 50);

  const prep = await prepareAffiliateShop();
  if (!prep.ok) {
    return Response.json({ ok: false, detail: prep.detail });
  }
  const res = await getCreatorOutreachRecords(
    prep.ctx,
    Number.isFinite(pageIndexRaw) ? pageIndexRaw : 1,
    Number.isFinite(pageSizeRaw) ? pageSizeRaw : 50,
  );
  if (!res.ok) {
    return Response.json({ ok: false, detail: res.detail });
  }
  return Response.json({ ok: true, total: res.total, items: res.items });
}
