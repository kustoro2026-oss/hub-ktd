import { isAuthed } from "@/lib/auth";
import { pullBlibliOrders } from "@/lib/blibli-orders";

// Ambil pesanan terbaru toko Blibli (KTD STORE).
// Dipakai halaman Pesanan KTD Hub; orkestrasi di lib/blibli-orders.ts.
export async function GET() {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }

  const results = await pullBlibliOrders();
  if (results.length === 0) {
    return Response.json({
      ok: false,
      detail: "Toko Blibli belum terhubung.",
    });
  }

  return Response.json({ ok: true, results });
}
