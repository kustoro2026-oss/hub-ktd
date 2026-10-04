// Generator PDF resi penjualan ala "cetak resi" aplikasi TikTok Shop —
// memuat data pembeli, item + harga, pembayaran, dan pengiriman.
// Dipakai untuk kirim otomatis ke WA admin dan tombol cetak di halaman
// Pesanan. Font bawaan Helvetica hanya mendukung Latin-1, jadi teks
// disaring karakter di luarnya (emoji/aksara lain diganti "?").
import PDFDocument from "pdfkit";
import type { TiktokOrderDetail } from "@/lib/tiktok";

const latin1 = (s: string): string =>
  (s ?? "").replace(/[^\u0020-\u00FF]/g, "?");

const rupiah = (v: string): string => {
  const n = Number(v ?? "0");
  if (!Number.isFinite(n)) return v || "0";
  return `Rp ${n.toLocaleString("id-ID")}`;
};

/** Epoch detik (UTC) → "DD/MM/YYYY HH.MM" WIB. */
function wib(ts: number): string {
  if (!ts) return "—";
  const w = new Date((ts + 7 * 3600) * 1000);
  if (Number.isNaN(w.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(w.getUTCDate())}/${p(w.getUTCMonth() + 1)}/${w.getUTCFullYear()} ${p(w.getUTCHours())}.${p(w.getUTCMinutes())}`;
}

const STATUS_LABEL: Record<string, string> = {
  UNPAID: "Belum dibayar",
  ON_HOLD: "Tertahan",
  AWAITING_SHIPMENT: "Menunggu kirim",
  PARTIALLY_SHIPPING: "Sebagian terkirim",
  AWAITING_COLLECTION: "Menunggu pickup",
  IN_TRANSIT: "Dalam perjalanan",
  DELIVERED: "Terkirim",
  COMPLETED: "Selesai",
  CANCELLED: "Dibatalkan",
};

const PLATFORM_LABEL: Record<string, string> = {
  TIKTOK_SHOP: "TikTok Shop",
  TOKOPEDIA: "Tokopedia",
};

export async function buildResiPdf(
  order: TiktokOrderDetail,
  opts: { shopName: string; generatedAt: string },
): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const M = 40; // margin
  const W = doc.page.width - M * 2; // lebar isi

  // ---------- Kepala ----------
  doc.font("Helvetica-Bold").fontSize(16).text("KTD STORE", M, M, {
    width: W,
    align: "center",
  });
  doc.font("Helvetica").fontSize(10).fillColor("#555555");
  doc.text(
    `Resi Penjualan — ${PLATFORM_LABEL[order.commerce_platform] ?? (order.commerce_platform || "TikTok Shop")}`,
    M,
    M + 20,
    { width: W, align: "center" },
  );
  doc.text("Toko online kebutuhan rumah tangga, kesehatan & pertanian", M, M + 34, {
    width: W,
    align: "center",
  });
  doc.fillColor("#000000");
  doc.moveTo(M, M + 52).lineTo(M + W, M + 52).stroke();

  let y = M + 62;
  const row = (label: string, value: string) => {
    doc.font("Helvetica").fontSize(9.5).fillColor("#555555");
    doc.text(label, M, y, { width: 130 });
    doc.fillColor("#000000");
    doc.text(latin1(value), M + 130, y, { width: W - 130 });
    y += 15;
  };

  row("No. Pesanan", order.id);
  row("Waktu Pesan", wib(order.create_time));
  row("Status", STATUS_LABEL[order.status] ?? order.status);
  row("Metode Bayar", order.is_cod ? "COD (bayar di tempat)" : order.payment_method_name || "—");

  // ---------- Penerima ----------
  y += 6;
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#000000");
  doc.text("PENERIMA", M, y);
  y += 16;
  const addr = order.recipient_address;
  if (addr) {
    const district = addr.district_info
      .map((d) => d.address_name)
      .filter(Boolean)
      .join(", ");
    row("Nama", addr.name || "—");
    row("No. HP", addr.phone_number || "—");
    row("Alamat", `${addr.full_address || "—"}${district ? `, ${district}` : ""}`);
    row("Kode Pos", addr.postal_code || "—");
  } else {
    row("Alamat", "Belum tersedia (pesanan belum dibayar)");
  }

  // ---------- Item ----------
  y += 8;
  doc.font("Helvetica-Bold").fontSize(11).text("ITEM PESANAN", M, y);
  y += 18;

  const colNo = M;
  const colNama = M + 26;
  const colJml = M + W - 120;
  const colHarga = M + W - 60;

  doc.font("Helvetica-Bold").fontSize(9);
  doc.text("PRODUK", colNama, y, { width: colJml - colNama - 8 });
  doc.text("JML", colJml, y, { width: 30, align: "center" });
  doc.text("HARGA", colHarga, y, { width: 60, align: "right" });
  y += 12;
  doc.moveTo(M, y).lineTo(M + W, y).stroke();
  y += 6;

  doc.font("Helvetica").fontSize(9);
  for (const it of order.line_items) {
    const qty =
      it.combined_listing_skus.reduce((a, c) => a + (c.sku_count || 0), 0) || 1;
    const harga = it.sale_price || it.original_price || "0";
    const text = latin1(it.product_name || it.sku_name || "(produk)");
    doc.text(text, colNama, y, { width: colJml - colNama - 8 });
    doc.text(String(qty), colJml, y, { width: 30, align: "center" });
    doc.text(rupiah(harga), colHarga, y, { width: 60, align: "right" });
    y += 15;
    if (y > doc.page.height - 120) {
      doc.addPage();
      y = M;
    }
  }

  // ---------- Pembayaran ----------
  y += 6;
  doc.moveTo(M, y).lineTo(M + W, y).stroke();
  y += 8;

  const baris = (label: string, value: string, bold = false) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 10 : 9.5);
    doc.fillColor(bold ? "#000000" : "#555555");
    doc.text(label, M, y, { width: W - 140 });
    doc.fillColor("#000000");
    doc.text(rupiah(value), M + W - 140, y, { width: 140, align: "right" });
    y += bold ? 18 : 15;
  };

  const p = order.payment;
  baris("Subtotal Produk", p.sub_total);
  if (Number(p.seller_discount) > 0) baris("Diskon Penjual", `-${p.seller_discount}`);
  if (Number(p.platform_discount) > 0) baris("Diskon Platform", `-${p.platform_discount}`);
  baris("Ongkos Kirim", p.shipping_fee);
  if (Number(p.buyer_service_fee) > 0) baris("Biaya Layanan", p.buyer_service_fee);
  if (Number(p.shipping_insurance_fee) > 0) baris("Asuransi Kirim", p.shipping_insurance_fee);
  baris("TOTAL", p.total_amount, true);

  // ---------- Pengiriman ----------
  y += 6;
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#000000");
  doc.text("PENGIRIMAN", M, y);
  y += 16;
  row("Kurir", order.shipping_provider || order.line_items[0]?.shipping_provider_name || "—");
  row("No. Resi Kurir", order.tracking_number || "Belum ada (paket belum diserahkan)");

  if (order.buyer_message) {
    y += 4;
    row("Catatan Pembeli", order.buyer_message);
  }

  // ---------- Kaki ----------
  doc.font("Helvetica").fontSize(8.5).fillColor("#777777");
  doc.text(
    `Dicetak otomatis oleh KTD Hub pada ${latin1(opts.generatedAt)} — ${latin1(opts.shopName)}`,
    M,
    doc.page.height - 50,
    { width: W, align: "center" },
  );

  doc.end();
  return await done;
}
