// Siapkan ulang satu pesanan TikTok supaya diproses pipeline dari awal —
// dipakai ketika pesanan terlanjur jatuh ke jalur resi manual karena bug
// (mis. guard qty yang salah) padahal seharusnya bisa dieksekusi otomatis.
// Dijaga CRON_SECRET (saluran yang sama dengan route pengecekan).
// Dipakai lewat POST /api/tiktok/resi/prepare-ulang?order_id=...&secret=...
// Tindakan: baris seen pesanan diatur ulang ke "menunggu" dengan epoch 16
// menit yang lalu (masa tunggu langsung kedaluwarsa) + attempts di-nol-kan,
// sehingga tick pengecekan berikutnya menyiapkan eksekusi Aneka + notif WA.
import { listSeenTiktokOrders, resetTiktokOrderSeen } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** True bila secret cocok. */
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
  if (!cronAuthorized(request)) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const orderId = new URL(request.url).searchParams.get("order_id") ?? "";
  if (!orderId) {
    return Response.json({ error: "order_id tidak ada" }, { status: 400 });
  }
  const rows = await listSeenTiktokOrders();
  const prev = rows.find((r) => r.order_id === orderId);
  // "menunggu" dengan epoch 16 menit lalu → masa tunggu 15 menit sudah
  // lewat saat tick berikutnya, pesanan langsung disiapkan ulang.
  const reset = await resetTiktokOrderSeen(
    orderId,
    `menunggu:${Date.now() - 16 * 60 * 1000}`,
  );
  return Response.json({
    order_id: orderId,
    seen_sebelumnya: prev?.notify ?? null,
    reset,
    catatan: reset
      ? "Tick pengecekan berikutnya akan menyiapkan ulang pesanan ini (eksekusi Aneka + notif Setuju) — tunggu ±20 menit."
      : "Pesanan tidak ada di riwayat seen — tidak ada yang diubah.",
  });
}
