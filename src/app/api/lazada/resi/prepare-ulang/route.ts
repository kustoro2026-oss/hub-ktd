// Siapkan ulang pesanan Lazada supaya diproses pipeline dari awal —
// dipakai ketika pesanan terlanjur jatuh ke jalur manual karena kegagalan
// sementara (mis. detail gagal diambil / pemetaan belum ada waktu itu)
// padahal sekarang seharusnya bisa dieksekusi otomatis.
// Dijaga CRON_SECRET (saluran yang sama dengan route pengecekan).
// Dipakai lewat:
//   POST /api/lazada/resi/prepare-ulang?order_item_id=...&secret=...
//   POST /api/lazada/resi/prepare-ulang?order_id=...&secret=...
// Tindakan: baris seen tiap order item diatur ulang ke "menunggu" dengan
// epoch 16 menit yang lalu (masa tunggu langsung kedaluwarsa) + attempts
// di-nol-kan, sehingga tick pengecekan berikutnya menyiapkan ulang pesanan
// (eksekusi Aneka + notif Setuju, atau resi sesuai hasil pemeriksaan).
import {
  getLazadaOrderExec,
  listSeenLazadaOrders,
  resetLazadaOrderSeen,
} from "@/lib/db";
import { getLazadaOrderItems } from "@/lib/lazada";

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
  const url = new URL(request.url);
  const orderItemId = url.searchParams.get("order_item_id") ?? "";
  const orderId = url.searchParams.get("order_id") ?? "";
  if (!orderItemId && !orderId) {
    return Response.json(
      { error: "order_item_id atau order_id tidak ada" },
      { status: 400 },
    );
  }

  // Tentukan daftar order item id yang diatur ulang.
  let itemIds: string[] = [];
  let sumber = "";
  if (orderItemId) {
    itemIds = [orderItemId];
    sumber = `order_item_id=${orderItemId}`;
  } else {
    // Resolusi id item lewat antrean eksekusi (payload.order_item_ids) —
    // tanpa panggilan API Lazada. Bila tidak ada baris antrean, cari
    // item pesanan lewat /order/items/get.
    const row = await getLazadaOrderExec(orderId);
    if (row) {
      try {
        const payload = JSON.parse(row.payload) as {
          order_item_ids?: string[];
        };
        itemIds = payload.order_item_ids ?? [];
        sumber = `antrean eksekusi ${orderId}`;
      } catch {
        // payload rusak — lanjut ke fallback.
      }
    }
    if (itemIds.length === 0) {
      const items = await getLazadaOrderItems(orderId);
      if (!items.ok) {
        return Response.json(
          { ok: false, detail: `Item pesanan gagal: ${items.detail}` },
          { status: 502 },
        );
      }
      if (items.data.length === 0) {
        return Response.json({
          order_id: orderId,
          reset: false,
          catatan:
            "Pesanan tidak ditemukan di antrean eksekusi maupun /order/items/get — tidak ada yang diubah.",
        });
      }
      itemIds = items.data.map((x) => x.order_item_id);
      sumber = `item pesanan ${orderId}`;
    }
  }

  // "menunggu" dengan epoch 16 menit lalu → masa tunggu 15 menit sudah
  // lewat saat tick berikutnya, pesanan langsung disiapkan ulang.
  const notify = `menunggu:${Date.now() - 16 * 60 * 1000}`;
  const seenRows = await listSeenLazadaOrders();
  const resetOk: string[] = [];
  const tidakAda: string[] = [];
  for (const id of itemIds) {
    const prev = seenRows.find((r) => r.order_item_id === id);
    const ok = await resetLazadaOrderSeen(id, notify);
    if (ok) resetOk.push(`${id} (sebelumnya: ${prev?.notify ?? "?"})`);
    else tidakAda.push(id);
  }

  return Response.json({
    order_item_id: orderItemId || undefined,
    order_id: orderId || undefined,
    sumber,
    reset: resetOk,
    belum_pernah_tercatat: tidakAda,
    catatan:
      resetOk.length > 0
        ? "Tick pengecekan berikutnya akan menyiapkan ulang (eksekusi Aneka + notif Setuju bila pemetaan lengkap) — tunggu ±20 menit."
        : "Tidak ada baris seen yang diubah — item belum pernah tercatat atau sudah terkirim statusnya.",
  });
}
