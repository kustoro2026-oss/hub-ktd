// Logika balasan otomatis bot WhatsApp — sama dengan bot di situs toko
// (src/app/api/wa/webhook/route.ts), dipindahkan ke KTD Hub agar semua
// pesan terpusat. Lima cabang balasan berurutan:
//   1. Pesan berbentuk order (alamat lengkap) → konfirmasi + janji resi
//   2. Chat dari iklan CTWA produk tertentu → link produk iklan + tutorial
//   3. Pertanyaan yang cocok FAQ (cara pesan, ongkir, COD, stok, jam CS,
//      retur, reseller, dll) → jawaban sesuai FAQ situs /bantuan
//   4. Pertanyaan lain yang belum terjawab FAQ → ajakan hubungi CS
//   5. Chat biasa / balasan broadcast → katalog + tutorial pemesanan

import { CATALOG_URL, CS_NUMBER_DISPLAY, looksLikeQuestion, matchFaq } from "./faq";

export { CATALOG_URL } from "./faq";

/**
 * Pemetaan ID iklan CTWA (Meta Ads) → URL produk yang diiklankan.
 * Isi tabel ini setiap kali iklan CTWA baru dibuat, contoh:
 *   "123456789012345": "https://toko.kustoro2026.com/produk/1039",
 * ID iklan bisa dilihat di Ads Manager (kolom ID iklan) atau dari payload
 * webhook (messages[].context.ad_id).
 */
export const AD_PRODUCT_MAP: Record<string, string> = {};

export const REPLY_ORDER = `Terima kasih, pesanan Anda telah kami terima.
Pesanan akan segera kami proses. Nomor resi pengiriman akan dikirimkan melalui chat ini setelah pesanan dikirim.

Hormat kami,
KTD Store`;

export const REPLY_QUESTION = `Terima kasih atas pertanyaan Anda.

Agar jawaban kami tepat, silakan sampaikan detail pertanyaan Anda di chat ini, atau hubungi CS kami di WhatsApp ${CS_NUMBER_DISPLAY} (setiap hari pukul 09:00–18:00 WIB). Pesan Anda tetap kami terima dan akan dibalas secepatnya.

Hormat kami,
KTD Store`;

export const REPLY_GENERAL = `Halo, terima kasih atas respons Anda terhadap info dari KTD Store.

Untuk memesan, silakan kunjungi katalog kami:
${CATALOG_URL}

Cara pemesanan:
1. Pilih produk, lalu klik tombol Order via WhatsApp.
2. Lengkapi nama dan alamat pengiriman (provinsi, kota, kecamatan) — ongkos kirim akan dihitung otomatis.
3. Kirim pesanan melalui WhatsApp. Kami akan segera mengonfirmasi pesanan Anda.

Anda juga dapat membeli melalui marketplace resmi kami: Blibli, TikTok Shop, dan Lazada.

Hormat kami,
KTD Store`;

export function replyForAd(productUrl: string): string {
  return `Halo, terima kasih atas minat Anda terhadap produk KTD Store.

Untuk memesan, silakan kunjungi halaman produk berikut:
${productUrl}

Cara pemesanan:
1. Klik tombol Order via WhatsApp pada halaman produk.
2. Lengkapi nama dan alamat pengiriman (provinsi, kota, kecamatan) — ongkos kirim akan dihitung otomatis.
3. Kirim pesanan melalui WhatsApp. Kami akan segera mengonfirmasi pesanan Anda.

Anda juga dapat membeli melalui marketplace resmi kami: Blibli, TikTok Shop, dan Lazada — tombol tersedia di halaman produk.

Hormat kami,
KTD Store`;
}

/** Deteksi pesan berisi data pesanan (format form situs / alamat lengkap). */
export function isOrderMessage(text: string): boolean {
  const t = text.toLowerCase();
  // Format pre-filled dari tombol Order via WhatsApp di situs.
  if (/saya ingin memesan produk|data penerima|nama produk:/.test(t)) return true;
  // Alamat gaya Indonesia: RT/RW + nomor (dengan atau tanpa pemisah).
  if (/\brt[\s.,:/_-]*\d|\brw[\s.,:/_-]*\d/.test(t)) return true;
  // Kata kunci wilayah administratif, termasuk singkatan umum
  // (kec./kab./prov./desa/kodepos) — hindari kata niaga seperti "pesan".
  if (
    /\b(kecamatan|kelurahan|kabupaten|provinsi|kode\s*pos|kodepos|desa|kec|kab|kel|prov)\b/.test(t) ||
    /\b(kec|kab|kel|prov)\./.test(t)
  )
    return true;
  // Kode pos 5 digit + kata "alamat", atau nama + alamat disebut bersama.
  if (/\b\d{5}\b/.test(t) && /\balamat\b/.test(t)) return true;
  if (/\bnama\b/.test(t) && /\balamat\b/.test(t)) return true;
  return false;
}

export type WaMessage = {
  from?: string;
  id?: string;
  type?: string;
  text?: { body?: string };
  context?: {
    ad_id?: string;
    referred_product?: { catalog_id?: string; product_retailer_id?: string };
  };
};

export type ReplyKind = "general" | "order" | "ad" | "faq" | "question";

/** Pilih balasan + klasifikasi untuk satu pesan masuk. */
export function pickReply(m: WaMessage): { kind: ReplyKind; reply: string } {
  if (m.text?.body && isOrderMessage(m.text.body)) {
    return { kind: "order", reply: REPLY_ORDER };
  }
  const adId = m.context?.ad_id;
  if (adId && AD_PRODUCT_MAP[adId]) {
    return { kind: "ad", reply: replyForAd(AD_PRODUCT_MAP[adId]) };
  }
  const body = m.text?.body ?? "";
  const faq = matchFaq(body);
  if (faq) {
    return { kind: "faq", reply: faq.answer };
  }
  if (looksLikeQuestion(body)) {
    return { kind: "question", reply: REPLY_QUESTION };
  }
  return { kind: "general", reply: REPLY_GENERAL };
}
