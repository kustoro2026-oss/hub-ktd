import { isAuthed } from "@/lib/auth";
import { pullLazadaOrders } from "@/lib/lazada-orders";

// Ambil pesanan terbaru toko Lazada (KTD STORE).
// Dipakai halaman Pesanan KTD Hub; orkestrasi di lib/lazada-orders.ts.
export async function GET() {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }

  const results = await pullLazadaOrders();
  if (results.length === 0) {
    return Response.json({
      ok: false,
      detail: "Toko Lazada belum terhubung.",
    });
  }

  return Response.json({ ok: true, results });
}
