// PDF resi satu pesanan TikTok — dibuka di tab baru dari halaman Pesanan
// lalu dicetak. Perlu sesi admin karena PDF berisi data pelanggan (nama,
// alamat, telepon) yang sensitif.
import { isAuthed } from "@/lib/auth";
import { listTiktokShopTokens } from "@/lib/db";
import { getTiktokOrderDetail } from "@/lib/tiktok";
import { prepareShop } from "@/lib/tiktok-orders";
import { buildResiPdf } from "@/lib/resi";
import { nowWib } from "@/lib/wa";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ order_id: string }> },
) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const { order_id } = await params;

  // Cari pesanan di semua toko terotorisasi (id pesanan unik global, tetapi
  // detail hanya bisa dibaca dengan kredensial toko pemiliknya).
  const shops = await listTiktokShopTokens();
  for (const shop of shops) {
    const prep = await prepareShop(shop);
    if (!prep.ok) continue;
    const detail = await getTiktokOrderDetail(
      { cipher: prep.cipher, access_token: prep.access_token },
      [order_id],
    );
    if (!detail.ok) continue;
    const order = detail.orders.find((o) => o.id === order_id);
    if (!order) continue;

    const pdf = await buildResiPdf(order, {
      shopName: shop.shop_name || "KTD Store",
      generatedAt: nowWib(),
    });
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="resi-${order_id}.pdf"`,
      },
    });
  }

  return Response.json({ error: "Pesanan tidak ditemukan" }, { status: 404 });
}
