import { isAuthed } from "@/lib/auth";
import { pullTiktokShopOrders } from "@/lib/tiktok-orders";

// Ambil pesanan terbaru semua toko TikTok Shop yang terotorisasi.
// Dipakai halaman Pesanan KTD Hub; orkestrasi di lib/tiktok-orders.ts.
export async function GET() {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }

  const results = await pullTiktokShopOrders();
  if (results.length === 0) {
    return Response.json({
      ok: false,
      detail: "Belum ada toko TikTok Shop yang terotorisasi.",
    });
  }

  return Response.json({ ok: true, results });
}
