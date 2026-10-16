import { isAuthed } from "@/lib/auth";
import { pullLazadaOrders } from "@/lib/lazada-orders";
import type { LazadaOrdersFilter } from "@/lib/lazada";

// Ambil pesanan terbaru toko Lazada (KTD STORE).
// Dipakai halaman Pesanan KTD Hub; orkestrasi di lib/lazada-orders.ts.
// Tanpa rentang tanggal → 30 hari terakhir (API /orders/get mewajibkan
// created_after/update_after — tanpa ini error E018).
export async function GET(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }

  const url = new URL(request.url);
  const filter: LazadaOrdersFilter = {
    created_after: url.searchParams.get("created_after") ??
      new Date(Date.now() - 30 * 86400 * 1000).toISOString(),
    sort_by: "updated_at",
    sort_direction: "DESC",
    offset: 0,
    limit: 100,
  };

  const results = await pullLazadaOrders(filter);
  if (results.length === 0) {
    return Response.json({
      ok: false,
      detail: "Toko Lazada belum terhubung.",
    });
  }

  return Response.json({ ok: true, results });
}
