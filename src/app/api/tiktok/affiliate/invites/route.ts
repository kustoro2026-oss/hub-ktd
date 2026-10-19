// Jurnal undangan afiliasi yang tersimpan di KTD Hub (satu baris per
// kreator). Query: limit? (default 100, maks 500), offset?.
//
// Auth: sesi admin (isAuthed) ATAU CRON_SECRET — pola route afiliasi.
import { isAuthed } from "@/lib/auth";
import { listAffiliateInvites } from "@/lib/db";

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
  const limitRaw = Number(url.searchParams.get("limit") ?? 100);
  const offsetRaw = Number(url.searchParams.get("offset") ?? 0);
  const rows = await listAffiliateInvites({
    limit: Number.isFinite(limitRaw) ? limitRaw : 100,
    offset: Number.isFinite(offsetRaw) ? offsetRaw : 0,
  });
  return Response.json({ ok: true, items: rows });
}
