// Paksa perbarui snapshot keuangan Aneka (login + scrape riwayat + saldo).
// Dua pintu: sesi admin KTD Hub (tombol "Muat Ulang Data Aneka" di halaman
// Keuangan — POST) ATAU cron Vercel (GET, secret CRON_SECRET di header
// x-cron-secret / Authorization Bearer / query ?secret= — sama dengan route
// cron lain). Hasil scrape disimpan ke cache database oleh ambilSnapshotAneka.
//
// KEAMANAN (anti-CSRF): GET HANYA menerima CRON_SECRET, bukan sesi admin.
// Cookie SameSite=Lax ikut terkirim pada navigasi GET lintas situs (mis.
// <img src=".../refresh">), sehingga GET ber-cookie bisa memicu scrape penuh
// tanpa sepengetahuan admin. Tombol dashboard memakai POST yang tidak bisa
// dipicu navigasi lintas situs tanpa CORS preflight.
import { isAuthed } from "@/lib/auth";
import { ambilSnapshotAneka } from "@/lib/keuangan";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function izinCron(request: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const u = new URL(request.url);
  const given =
    request.headers.get("x-cron-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    u.searchParams.get("secret");
  return given === secret;
}

async function izin(request: Request): Promise<boolean> {
  if (await isAuthed()) return true;
  return izinCron(request);
}

export async function GET(request: Request) {
  if (!(await izinCron(request))) {
    return Response.json({ error: "Tidak diizinkan" }, { status: 401 });
  }
  const res = await ambilSnapshotAneka(true);
  return Response.json(res);
}

export async function POST(request: Request) {
  if (!(await izin(request))) {
    return Response.json({ error: "Tidak diizinkan" }, { status: 401 });
  }
  const res = await ambilSnapshotAneka(true);
  return Response.json(res);
}
