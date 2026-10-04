// Pengecekan pesanan TikTok baru → buat + kirim resi PDF ke WA pemilik.
//
// Dipanggil dari empat tempat:
//  1. Tombol "Cek Pesanan Baru" di halaman Pesanan (sesi admin, POST).
//  2. Tick SchedulerTick setiap menit selama ada tab admin Hub terbuka
//     (sesi admin, POST).
//  3. Cron Vercel harian (GET, secret di header Authorization Bearer —
//     Vercel otomatis menyertakan env CRON_SECRET di sana).
//  4. cron-job.org (GET/POST, ?secret=) untuk pengecekan lebih rapat.
//
// Endpoint idempoten: tabel tiktok_order_seen mencegah resi terkirim dua
// kali. Pengecekan pertama berjalan dalam mode baseline (tandai pesanan
// lama tanpa kirim apa pun).
import { isAuthed } from "@/lib/auth";
import { checkNewTiktokOrders } from "@/lib/tiktok-resi";

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

async function handle(request: Request) {
  if (!cronAuthorized(request) && !(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const res = await checkNewTiktokOrders();
  return Response.json(res, { status: res.ok ? 200 : 500 });
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
