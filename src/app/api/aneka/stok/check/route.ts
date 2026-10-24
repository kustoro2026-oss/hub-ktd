// Hook "order selesai" (Tahap 4): kurangi stok di semua channel lain
// setiap ada pesanan berstatus selesai (TikTok COMPLETED, Blibli item
// D/terkirim, Lazada delivered). Dipanggil dari:
//  1. SchedulerTick setiap menit selama ada tab admin Hub terbuka
//     (sesi admin, POST).
//  2. Cron Vercel tiap 15 menit (GET, secret di header Authorization
//     Bearer — Vercel otomatis menyertakan env CRON_SECRET di sana).
//  3. cron-job.org (GET/POST, ?secret=) bila ingin lebih rapat.
//
// Idempoten: tabel stok_penyesuaian + flag per kanal mencegah pengurangan
// ganda; kanal gagal dicoba lagi pada tick berikutnya.
import { isAuthed } from "@/lib/auth";
import { cekOrderSelesaiSemuaChannel } from "@/lib/stok-sync";

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
  // Tombol manual menambah ?force=1 — jalankan selalu. Tick penjadwal/
  // pinger/webhook tanpa force MELEWATI ronde bila worker VPS baru saja
  // menjalankannya (menghemat CPU serverless).
  const force = new URL(request.url).searchParams.get("force") === "1";
  let res;
  try {
    res = await cekOrderSelesaiSemuaChannel({ skipIfWorkerFresh: !force });
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
