// Pengundang afiliasi otomatis (cron harian 08:30 & 14:30 WIB).
// Logika penuh ada di @/lib/affiliate-auto (dipakai bersama worker VPS).
// Dipanggil Vercel Cron (vercel.json) dengan header Authorization: Bearer.
// Auth: CRON_SECRET atau sesi admin — pola route afiliasi.
import { isAuthed } from "@/lib/auth";
import { runAffiliateAutoCron } from "@/lib/affiliate-auto";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
  const result = await runAffiliateAutoCron();
  return Response.json(result);
}
