// Label kirim RESMI TikTok Shop satu pesanan (persis menu "Cetak Resi"
// aplikasi) — dibuka di tab baru dari halaman Pesanan lalu dicetak. Perlu
// sesi admin karena label berisi data pelanggan (nama, alamat, telepon)
// yang sensitif.
import { isAuthed } from "@/lib/auth";
import { listTiktokShopTokens } from "@/lib/db";
import {
  downloadShippingDocument,
  getShippingDocument,
} from "@/lib/tiktok";
import { prepareShop } from "@/lib/tiktok-orders";

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
  // dokumen hanya bisa diambil dengan kredensial toko pemiliknya).
  const shops = await listTiktokShopTokens();
  for (const shop of shops) {
    const prep = await prepareShop(shop);
    if (!prep.ok) continue;
    const cred = { cipher: prep.cipher, access_token: prep.access_token };

    const doc = await getShippingDocument(cred, order_id, "SHIPPING_LABEL");
    if (!doc.ok) continue;
    const dl = await downloadShippingDocument(doc.doc_url);
    if (!dl.ok) continue;

    return new Response(new Uint8Array(dl.pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="resi-${order_id}.pdf"`,
      },
    });
  }

  // Label resmi tidak tersedia — tampilkan keterangan ramah alih-alih PDF.
  return new Response(
    `<!doctype html><html lang="id"><head><meta charset="utf-8">` +
      `<title>Label tidak tersedia</title></head><body style="font-family:system-ui,sans-serif;max-width:520px;margin:60px auto;padding:0 16px;color:#334155">` +
      `<h1 style="font-size:20px">Label kirim belum tersedia</h1>` +
      `<p>Label resmi TikTok Shop untuk pesanan ini belum bisa diambil lewat API.` +
      ` Kemungkinan paketnya belum diatur pengirimannya atau pesanan tidak memakai pengiriman platform.</p>` +
      `<p>Silakan cetak lewat aplikasi TikTok Shop: <b>Pesanan → pilih pesanan → Cetak Resi</b>.</p>` +
      `<p><a href="/marketplace/tiktok/pesanan" style="color:#059669">Kembali ke halaman Pesanan</a></p>` +
      `</body></html>`,
    {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  );
}
