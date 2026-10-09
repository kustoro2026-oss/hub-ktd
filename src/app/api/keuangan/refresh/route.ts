// Paksa perbarui snapshot keuangan Aneka (login + scrape riwayat + saldo).
// Dua pintu: sesi admin KTD Hub (tombol "Muat Ulang Data Aneka" di halaman
// Keuangan) ATAU cron Vercel (GET, secret CRON_SECRET di header
// x-cron-secret / Authorization Bearer / query ?secret= — sama dengan route
// cron lain). Hasil scrape disimpan ke cache database oleh ambilSnapshotAneka.
import { isAuthed } from "@/lib/auth";
import { ambilSnapshotAneka } from "@/lib/keuangan";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function izin(request: Request): Promise<boolean> {
  if (await isAuthed()) return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const u = new URL(request.url);
  const given =
    request.headers.get("x-cron-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    u.searchParams.get("secret");
  return given === secret;
}

export async function GET(request: Request) {
  if (!(await izin(request))) {
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
