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

async function handle(request: Request) {
  if (!cronAuthorized(request) && !(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  let res;
  try {
    res = await checkNewTiktokOrders();
  } catch (e) {
    res = {
      ok: false,
      detail: `Kesalahan server: ${
        e instanceof Error ? e.message : "tidak dikenal"
      }`,
    };
  }
  // Di production, body 5xx bisa diganti Cloudflare dengan halaman 502
  // generik — balas 200 + pesan supaya alasan aslinya sampai ke pemanggil.
  const status = res.ok ? 200 : process.env.NODE_ENV === "production" ? 200 : 500;
  return Response.json(res, { status });
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
