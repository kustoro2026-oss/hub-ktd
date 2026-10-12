// Siapkan ulang pesanan Blibli supaya diproses pipeline dari awal —
// dipakai ketika paket terlanjur jatuh ke jalur manual karena kegagalan
// sementara (mis. detail gagal diambil / pemetaan belum ada waktu itu)
// padahal sekarang seharusnya bisa dieksekusi otomatis.
// Dijaga CRON_SECRET (saluran yang sama dengan route pengecekan).
// Dipakai lewat:
//   POST /api/blibli/resi/prepare-ulang?order_item_id=...&secret=...
//   POST /api/blibli/resi/prepare-ulang?package_id=...&secret=...
// Tindakan: baris seen tiap order item diatur ulang ke "menunggu" dengan
// epoch 16 menit yang lalu (masa tunggu langsung kedaluwarsa) + attempts
// di-nol-kan, sehingga tick pengecekan berikutnya menyiapkan ulang paket
// (eksekusi Aneka + notif Setuju, atau resi sesuai hasil pemeriksaan).
import {
  getBlibliOrderExec,
  listSeenBlibliOrders,
  resetBlibliOrderSeen,
} from "@/lib/db";
import { listBlibliOrders } from "@/lib/blibli";

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
  const packageId = url.searchParams.get("package_id") ?? "";
  if (!orderItemId && !packageId) {
    return Response.json(
      { error: "order_item_id atau package_id tidak ada" },
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
    // tanpa panggilan API Blibli. Bila tidak ada baris antrean, cari
    // paketnya di daftar pesanan terbaru.
    const row = await getBlibliOrderExec(packageId);
    if (row) {
      try {
        const payload = JSON.parse(row.payload) as {
          order_item_ids?: string[];
        };
        itemIds = payload.order_item_ids ?? [];
        sumber = `antrean eksekusi ${packageId}`;
      } catch {
        // payload rusak — lanjut ke fallback.
      }
    }
    if (itemIds.length === 0) {
      const list = await listBlibliOrders({
        statusFPDateRange: {
          start: Date.now() - 30 * 24 * 60 * 60 * 1000,
          end: Date.now(),
        },
        paging: { page: 0, size: 50 },
      });
      if (!list.ok) {
        return Response.json(
          { ok: false, detail: `Daftar pesanan gagal: ${list.detail}` },
          { status: 502 },
        );
      }
      const pkg = list.data.packages.find((p) => p.packageId === packageId);
      if (!pkg) {
        return Response.json({
          package_id: packageId,
          reset: false,
          catatan:
            "Paket tidak ditemukan di antrean eksekusi maupun pesanan 30 hari terakhir — tidak ada yang diubah.",
        });
      }
      itemIds = pkg.orderItems.map((x) => x.order.itemId);
      sumber = `daftar pesanan ${packageId}`;
    }
  }

  // "menunggu" dengan epoch 16 menit lalu → masa tunggu 15 menit sudah
  // lewat saat tick berikutnya, paket langsung disiapkan ulang.
  const notify = `menunggu:${Date.now() - 16 * 60 * 1000}`;
  const seenRows = await listSeenBlibliOrders();
  const resetOk: string[] = [];
  const tidakAda: string[] = [];
  for (const id of itemIds) {
    const prev = seenRows.find((r) => r.order_item_id === id);
    const ok = await resetBlibliOrderSeen(id, notify);
    if (ok) resetOk.push(`${id} (sebelumnya: ${prev?.notify ?? "?"})`);
    else tidakAda.push(id);
  }

  return Response.json({
    order_item_id: orderItemId || undefined,
    package_id: packageId || undefined,
    sumber,
    reset: resetOk,
    belum_pernah_tercatat: tidakAda,
    catatan:
      resetOk.length > 0
        ? "Tick pengecekan berikutnya akan menyiapkan ulang (eksekusi Aneka + notif Setuju bila pemetaan lengkap) — tunggu ±20 menit."
        : "Tidak ada baris seen yang diubah — item belum pernah tercatat atau sudah terkirim statusnya.",
  });
}
