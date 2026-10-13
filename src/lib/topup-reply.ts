// Balasan bot untuk chat masuk yang menyebut No. Pesanan top-up (KTD-xxx).
//
// Kebijakan baru (13 Okt 2026): pembeli TIDAK dikirimi notifikasi WA proaktif
// (hemat biaya template) — info diberikan di halaman bayar + ajakan chat WA
// duluan. Begitu pembeli chat, bot membalas status pesanan ini GRATIS karena
// masih di dalam window layanan 24 jam dari pesan masuk.
import { getTopupOrder, type TopupOrderRow } from "@/lib/db";
import { normalizePhone } from "@/lib/wa";

const rupiah = (n: number) => `Rp ${new Intl.NumberFormat("id-ID").format(n)}`;

/** Ambil No. Pesanan top-up dari teks chat, mis. "KTD-MV6LBXJ6WX". */
export function extractTopupOrderId(text: string): string | null {
  const m = text.match(/\b(KTD-[A-Z0-9]{6,})\b/i);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Balasan status pesanan top-up untuk pembeli yang chat duluan.
 * Kembalikan null bila pesanan tidak cocok dengan nomor pengirim (jangan
 * membocorkan pesanan orang lain) atau bukan pesanan top-up.
 */
export async function replyForTopupOrder(
  id: string,
  sender: string,
): Promise<string | null> {
  const o = await getTopupOrder(id);
  if (!o) return null;
  // Nomor pengirim wajib cocok dengan No. HP Pemesan yang tercatat.
  const from = normalizePhone(sender);
  const buyer = normalizePhone(o.buyer_phone);
  if (from && buyer && from !== buyer) return null;
  return topupStatusReply(o);
}

/** Susun teks balasan formal per status pesanan. */
export function topupStatusReply(o: TopupOrderRow): string {
  const produk = o.product_name || o.sku;
  const jumlah = rupiah(o.amount);

  if (o.payment_status === "paid") {
    if (o.topup_status === "success") {
      return [
        `Terima kasih atas konfirmasi Anda. Kabar baik — top up ${produk} pada pesanan ${o.id} sudah berhasil diproses.`,
        ...(o.digiflazz_sn ? [`Nomor SN: ${o.digiflazz_sn}`] : []),
        "",
        "Terima kasih sudah berbelanja di KTD Store.",
        "",
        "Hormat kami,",
        "KTD Store",
      ].join("\n");
    }
    if (o.topup_status === "failed") {
      return [
        `Terima kasih atas konfirmasi Anda. Maaf, top up ${produk} pada pesanan ${o.id} belum berhasil diproses.`,
        "Tim kami sedang menindaklanjuti. Untuk cek ulang atau pengembalian dana, silakan hubungi CS kami.",
        "",
        "Hormat kami,",
        "KTD Store",
      ].join("\n");
    }
    // processing / pending — pembayaran lunas, eksekusi belum kelar.
    return [
      `Terima kasih atas konfirmasi Anda. Pembayaran pesanan ${o.id} (${produk}) sebesar ${jumlah} sudah kami terima dan top up sedang diproses.`,
      "Silakan cek kembali statusnya beberapa saat lagi di halaman pembayaran.",
      "",
      "Hormat kami,",
      "KTD Store",
    ].join("\n");
  }

  if (o.payment_status === "expired" || o.payment_status === "failed") {
    return [
      `Terima kasih atas konfirmasi Anda. Pembayaran pesanan ${o.id} (${produk}) gagal atau telah kedaluwarsa.`,
      "Silakan buat pesanan baru bila ingin mencoba lagi.",
      "",
      "Hormat kami,",
      "KTD Store",
    ].join("\n");
  }

  // Menunggu pembayaran — beri petunjuk sesuai kanal yang dibuat.
  if (o.payment_va) {
    return [
      `Terima kasih atas konfirmasi Anda. Pembayaran pesanan ${o.id} (${produk}) sebesar ${jumlah} belum kami terima.`,
      `Silakan transfer tepat sebesar ${jumlah} ke nomor Virtual Account berikut:`,
      o.payment_va,
      "",
      "Pesanan akan terverifikasi otomatis setelah transfer diterima.",
      "",
      "Hormat kami,",
      "KTD Store",
    ].join("\n");
  }
  if (o.payment_qr) {
    return [
      `Terima kasih atas konfirmasi Anda. Pembayaran pesanan ${o.id} (${produk}) sebesar ${jumlah} belum kami terima.`,
      "Silakan buka halaman pembayaran untuk memindai kode QRIS:",
      `https://toko.kustoro2026.com/topup/bayar/${o.id}`,
      "",
      "Pesanan akan terverifikasi otomatis setelah pembayaran diterima.",
      "",
      "Hormat kami,",
      "KTD Store",
    ].join("\n");
  }
  return [
    `Terima kasih atas konfirmasi Anda. Pesanan ${o.id} (${produk}) sebesar ${jumlah} masih menunggu pembayaran.`,
    "Silakan selesaikan pembayaran di halaman pembayaran, atau hubungi CS kami untuk bantuan.",
    "",
    "Hormat kami,",
    "KTD Store",
  ].join("\n");
}
