// Mesin FAQ bot WhatsApp KTD Hub — menjawab pertanyaan umum pelanggan
// secara otomatis. Jawaban diselaraskan dengan halaman /bantuan situs toko
// (jam CS, retur, reseller, pembayaran) dan konfigurasi checkout
// (COD Rp 2.500/paket, transfer bank, ongkir otomatis KiriminAja).
//
// Gaya teks keluar mengikuti konvensi proyek: Bahasa Indonesia formal,
// sapaan "Anda", tanpa emoji, ditutup tanda tangan "Hormat kami, KTD Store".
//
// Modul ini sengaja TANPA import apa pun supaya bisa diuji langsung lewat
// `node` (type stripping Node 24) — sama seperti handover.ts.

export const CATALOG_URL = "https://toko.kustoro2026.com/";
export const CS_NUMBER_DISPLAY = "0851 7115 7938";

const SIGN = "Hormat kami,\nKTD Store";

export type FaqEntry = {
  id: string;
  /** Pola yang dicocokkan pada teks berhuruf kecil. */
  patterns: RegExp[];
  answer: string;
  /** Hanya cocok untuk pesan pendek (salam / ucapan terima kasih). */
  short?: boolean;
};

export const FAQ_ENTRIES: FaqEntry[] = [
  {
    id: "salam",
    short: true,
    patterns: [
      /\bhalo+\b/,
      /\bhai\b|\bhi\b|\bhello\b/,
      /\bassalamualaikum\b|\basalamualaikum\b|\bassalamu'alaikum\b/,
      /\bselamat (pagi|siang|sore|malam)\b/,
      /\bpermisi\b|\bpunten\b/,
      /\bmin\b|\bgan\b|\bkak\b|\bbang\b|\bmas\b|\bmbak\b|\bbro\b|\bsis\b/,
    ],
    answer: `Halo! Terima kasih telah menghubungi KTD Store.

Ada yang bisa kami bantu? Untuk melihat katalog produk, silakan kunjungi:
${CATALOG_URL}

Untuk memesan, klik tombol "Order via WhatsApp" pada halaman produk.

${SIGN}`,
  },
  {
    id: "makasih",
    short: true,
    patterns: [
      /\bmakasih\b|\bmakasi\b|\bterima kasih\b|\bterimakasih\b|\bthanks\b|\btq\b|\btks\b/,
      /\boke\b|\bok\b|\bokey\b|\bsiap\b|\bsip\b/,
    ],
    answer: `Terima kasih kembali atas kepercayaan Anda.

Jika ada pertanyaan lain, kami siap membantu.

${SIGN}`,
  },
  {
    id: "cara-pesan",
    patterns: [
      /\bcara (pesan|order|beli|checkout)(nya)?\b/,
      /\b(gimana|gmn) (caranya )?(pesan|order|beli)(nya)?\b/,
      /\b(pesan|order|beli)(nya)? gimana\b|\bcaranya (pesan|order|beli)\b/,
      /\blangkah (pesan|order|beli)\b/,
    ],
    answer: `Cara pemesanan di KTD Store:
1. Buka katalog: ${CATALOG_URL}
2. Pilih produk, lalu klik tombol "Order via WhatsApp".
3. Lengkapi nama dan alamat pengiriman (provinsi, kota, kecamatan) — ongkos kirim dihitung otomatis.
4. Kirim pesanan melalui WhatsApp. Kami akan segera mengonfirmasi pesanan Anda.

Anda juga dapat membeli melalui marketplace resmi kami: Blibli, TikTok Shop, dan Lazada.

${SIGN}`,
  },
  {
    id: "katalog",
    patterns: [
      /\b(produk|barang|jualan) apa (saja|aja)\b/,
      /\bjual apa\b|\bdagang apa\b/,
      /\bkatalog\b|\bdaftar produk\b|\blist produk\b/,
      /\bproduknya apa\b|\bproduk nya apa\b/,
      /\bada apa aja\b|\bada produk apa\b/,
    ],
    answer: `Katalog lengkap KTD Store tersedia di:
${CATALOG_URL}

Tersedia berbagai produk: obat & alat pertanian, suplemen, kesehatan & kecantikan, kebutuhan rumah tangga, dan lainnya.

${SIGN}`,
  },
  {
    id: "harga",
    patterns: [
      /\b(berapa|brp) harganya\b|\bharga(nya)? (berapa|brp)\b/,
      /\bharga produk\b|\bdaftar harga\b|\bprice list\b/,
      /\bmahalnya (berapa|brp)\b|\bharga (di|nya)\b/,
    ],
    answer: `Harga setiap produk tertera pada halaman produknya di katalog:
${CATALOG_URL}

Total harga beserta ongkos kirim dihitung otomatis saat Anda mengisi form pemesanan.

${SIGN}`,
  },
  {
    id: "diskon",
    patterns: [
      /\bdiskon\b|\bpromo\b|\bpromosi\b/,
      /\bpotongan harga\b|\bcoupon\b|\bkupon\b|\bvoucher\b/,
      /\bgratis ongkir\b|\bfree ongkir\b|\bflash sale\b/,
    ],
    answer: `Informasi promo dan harga terbaru selalu kami perbarui di katalog:
${CATALOG_URL}

Untuk menanyakan promo yang sedang berjalan, silakan sampaikan di chat ini — CS kami akan menjawab secepatnya.

${SIGN}`,
  },
  {
    id: "ongkir",
    patterns: [
      /\bongkir\b|\bongkos kirim\b|\bongkos pengiriman\b|\bbiaya kirim\b|\bongkirnya\b/,
      /\b(berapa|brp) ongkir\b|\bonkir (ke|untuk|nya)\b/,
      /\bshipping\b/,
    ],
    answer: `Ongkos kirim dihitung otomatis saat Anda mengisi form pemesanan — pilih provinsi, kota, dan kecamatan tujuan, lalu biaya kirim muncul sesuai kurir yang tersedia.

Beberapa produk dikirim dari gudang berbeda, sehingga pesanan dapat terbagi menjadi beberapa paket.

${SIGN}`,
  },
  {
    id: "cod",
    patterns: [
      /\bcod\b/,
      /\bbayar (di|ditempat|di tempat|pas barang|pas paket|di rumah)\b/,
      /\bcash on delivery\b/,
    ],
    answer: `Tentu. Kami menerima pembayaran COD (bayar di tempat) dengan biaya tambahan Rp 2.500 per paket. Silakan pilih metode pembayaran COD saat mengisi form pemesanan.

Selain COD, tersedia juga pembayaran transfer bank.

${SIGN}`,
  },
  {
    id: "pembayaran",
    patterns: [
      /\bpembayaran\b|\bcara bayar\b|\bbayarnya gimana\b|\bbayar gimana\b|\bbayar lewat apa\b/,
      /\btransfer\b|\brekening\b|\bno rek\b|\bnomor rekening\b/,
      /\bqris\b|\be-?wallet\b|\bdana\b|\bovo\b|\bgopay\b|\bshopee ?pay\b/,
      /\bmetode (bayar|pembayaran)\b/,
    ],
    answer:
      "Metode pembayaran kami: COD (bayar di tempat, biaya Rp 2.500 per paket) atau transfer bank ke rekening resmi toko:\n\nMandiri 1340025493742 a.n. KUSTORO\n\nSetelah transfer, mohon kirim bukti transfer ke chat ini agar pesanan segera kami proses.\n\n" +
      SIGN,
  },
  {
    id: "stok",
    patterns: [
      /\bstok\b|\bstock\b|\bready\b|\bready stock\b|\bmasi ada\b|\bmasih ada\b/,
      /\bkosong\b|\bhabis\b|\btersedia\b|\bada barang\b/,
    ],
    answer: `Sebagian besar produk di katalog siap stok:
${CATALOG_URL}

Untuk memastikan ketersediaan produk tertentu, kirimkan nama produknya ke chat ini — CS kami akan mengecek dan menjawab secepatnya.

${SIGN}`,
  },
  {
    id: "pengiriman",
    patterns: [
      /\bberapa lama\b|\bestimasi\b|\blama (gak|tidak|nya)\b/,
      /\bsampai kapan\b|\bkapan (sampai|nyampe|nyampein|datang)\b|\bkapan sampai\b/,
      /\bpengiriman (berapa|berapa lama)\b|\bberapa hari sampai\b/,
      /\bkirimnya (berapa|kapan)\b/,
    ],
    answer:
      "Pesanan diproses setelah dikonfirmasi. Estimasi sampai umumnya 1–5 hari kerja tergantung tujuan dan kurir.\n\nNomor resi pengiriman akan dikirimkan melalui chat ini setelah paket diserahkan ke kurir.\n\n" +
      SIGN,
  },
  {
    id: "resi",
    patterns: [
      /\bresi\b|\bno resi(nya)?\b|\bnomor resi\b|\blacak\b|\btrack(ing)?\b/,
      /\bstatus pesanan\b|\bcek pesanan\b|\bpesanan saya\b|\bpesananku\b/,
      /\bmana resinya\b|\bresinya mana\b/,
    ],
    answer:
      "Nomor resi dikirimkan ke chat ini setelah paket diserahkan ke kurir.\n\nUntuk mengecek status pesanan, hubungi CS dengan menyertakan nama dan detail pesanan Anda — kami akan mengirimkan status serta nomor resinya.\n\n" +
      SIGN,
  },
  {
    id: "lokasi",
    patterns: [
      /\btoko ?(nya )?(di|dimana|di mana)\b|\btoko dimana\b/,
      /\balamat toko\b|\blokasi toko\b|\balamatnya (di|dimana)\b/,
      /\btoko offline\b|\boffline store\b|\bcabang\b/,
      /\bbisa datang langsung\b|\bbisa mampir\b|\bpickup\b/,
    ],
    answer: `KTD Store adalah toko online — pemesanan dilakukan melalui situs kami:
${CATALOG_URL}

Pesanan dikirim dari gudang kami/mitra ke alamat Anda. Kami tidak melayani pembelian langsung di toko.

${SIGN}`,
  },
  {
    id: "jam",
    patterns: [
      /\bjam operasional\b|\bjam kerja\b|\bjam buka\b/,
      /\bbuka jam berapa\b|\bjam berapa (buka|cs|admin)\b/,
      /\bcs aktif\b|\badmin (online|aktif)\b/,
      /\bkok (gak|belum|ga) (dibalas|dibales|dijawab)\b/,
    ],
    answer:
      "CS kami aktif setiap hari pukul 09:00–18:00 WIB, kecuali hari libur nasional. Pesan di luar jam tersebut akan kami balas pada hari berikutnya.\n\nPesan Anda tetap kami terima dan tercatat.\n\n" +
      SIGN,
  },
  {
    id: "retur",
    patterns: [
      /\bretur\b|\bdiretur\b|\bpengembalian\b|\bpenukaran\b/,
      /\btukar\b|\bditukar\b|\bgaransi\b|\bklaim\b|\bkomplain\b/,
      /\brusak\b|\bcacat\b|\bbarang salah\b|\bsalah kirim\b/,
    ],
    answer:
      "Pengembalian dan penukaran dapat diajukan melalui CS WhatsApp kami. Pastikan produk dalam kondisi asli beserta kemasannya, dan sertakan bukti pembelian.\n\nSampaikan kendala Anda di chat ini — CS akan segera membantu.\n\n" +
      SIGN,
  },
  {
    id: "asli",
    patterns: [
      /\basli\b|\boriginal\b|\bori\b|\bkw\b|\bpalsu\b|\btiruan\b/,
      /\bbpom\b|\bresmi\b|\bterpercaya\b|\bpenipuan\b|\baman gak\b|\baman ga\b/,
    ],
    answer: `KTD Store memilih produk dari pemasok terpercaya dan juga menjual melalui toko resmi kami di Blibli, TikTok Shop, dan Lazada (tombol tersedia di setiap halaman produk).

Keterangan legalitas produk (misalnya BPOM) tercantum pada halaman produk masing-masing:
${CATALOG_URL}

${SIGN}`,
  },
  {
    id: "marketplace",
    patterns: [
      /\bblibli\b|\btiktok\b|\btiktok shop\b|\bshopee\b|\btokopedia\b|\blazada\b/,
      /\bmarketplace\b|\btoko resmi\b|\btoko hijau\b|\btoko oren\b|\btoko ungu\b/,
    ],
    answer: `Toko resmi kami tersedia di Blibli, TikTok Shop, dan Lazada — tombol link ada di setiap halaman produk katalog:
${CATALOG_URL}

Anda juga dapat memesan langsung via WhatsApp dengan klik "Order via WhatsApp" pada halaman produk.

${SIGN}`,
  },
  {
    id: "reseller",
    patterns: [
      /\breseller\b|\bresseler\b|\bdropship(ping|per|er)?\b/,
      /\bgrosir\b|\bagen\b|\bmember\b|\bkerja ?sama\b|\bsupplier\b|\bkulakan\b/,
    ],
    answer:
      "Untuk informasi program reseller/dropship, harga khusus member, dan cara bergabung dengan supplier kami — silakan hubungi CS kami melalui WhatsApp. Kami akan menjelaskan langkahnya.\n\n" +
      SIGN,
  },
  {
    id: "cs",
    patterns: [
      /\bcs\b|\badmin(nya)?\b|\bcustomer service\b|\bservice center\b/,
      /\bnomor (cs|admin|wa|whatsapp)\b|\bkontak\b/,
      /\bmanusia\b|\borangnya\b|\bsama (orang|admin|cs)\b/,
      /\bbantuan\b|\bhelp\b/,
    ],
    answer: `Tim CS kami siap membantu setiap hari pukul 09:00–18:00 WIB. Silakan hubungi WhatsApp ${CS_NUMBER_DISPLAY}, atau sampaikan pertanyaan Anda di chat ini — pesan tetap kami terima dan akan dibalas CS.

Pusat bantuan lengkap juga tersedia di: ${CATALOG_URL}bantuan

${SIGN}`,
  },
];

// Kata tanya umum — bila tidak ada FAQ yang cocok, pesan berisi kata tanya
// dijawab dengan ajakan menghubungi CS (bukan tutorial katalog).
const QUESTION_WORDS =
  /\b(apa|apakah|bagaimana|gimana|gmn|berapa|brp|kapan|kenapa|mengapa|knp|kok|boleh|bisa|adakah|dimana|di mana|manakah|kah|tanya|nanya)\b|\?/;

/** True bila pesan tampak seperti pertanyaan yang belum terjawab FAQ. */
export function looksLikeQuestion(text: string): boolean {
  return QUESTION_WORDS.test(text.toLowerCase());
}

/** Normalisasi ringan untuk pencocokan: huruf kecil + spasi rapi. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Hitung jumlah kata kunci yang cocok pada satu pola (mode global) —
 *  pesan yang menyebut banyak kata kunci satu topik menang atas pesan
 *  dengan satu kata kunci dari topik lain. */
function countMatches(p: RegExp, t: string): number {
  const g = new RegExp(
    p.source,
    p.flags.includes("g") ? p.flags : `${p.flags}g`,
  );
  return t.match(g)?.length ?? 0;
}

/** Cari jawaban FAQ terbaik untuk satu pesan. */
export function matchFaq(
  text: string,
): { id: string; answer: string } | null {
  const t = normalize(text);
  if (!t) return null;
  const short = t.length <= 60;
  let best: { entry: FaqEntry; hits: number } | null = null;
  for (const entry of FAQ_ENTRIES) {
    if (entry.short && !short) continue;
    let hits = 0;
    for (const p of entry.patterns) {
      hits += countMatches(p, t);
    }
    if (hits > 0 && (!best || hits > best.hits)) {
      best = { entry, hits };
    }
  }
  return best ? { id: best.entry.id, answer: best.entry.answer } : null;
}
