// Eksekusi pesanan Lazada → Aneka (Fase 2, SEMI-OTOMATIS). Alur identik
// dengan modul Blibli (blibli-exec.ts) — penyesuaian pada model data Lazada:
//
//  1. PERSIAPAN (murah, saat pesanan baru terdeteksi setelah masa tunggu):
//     cek semua item pesanan sudah dipetakan ke Aneka → simpan rincian
//     produk ke tabel lazada_order_exec (status "menunggu") → kirim notif
//     WA "Setuju" berisi tautan halaman Eksekusi.
//  2. PERSETUJUAN (tombol Setuju di halaman Eksekusi, dipicu pemilik toko):
//     baru DI SINI rantai Aneka dijalankan penuh — pemenuhan Lazada
//     (pack → rts → label) lalu login → payment/create → variant/save →
//     token checkout → pembayaran/process (bayar saldo) → verifikasi lewat
//     payment_id dari riwayat — lalu kabari WA.
//
// Rantai Aneka TIDAK dijalankan saat persiapan supaya tidak menumpuk
// pembayaran mangkrak di akun Aneka bila pemilik tidak menyetujui.
//
// Perbedaan dengan Blibli: kunci antrean = order_id (satu pesanan = satu
// paket = satu slot resi Aneka); kunci pemetaan = SellerSku (tingkat
// produk); petunjuk varian = variation dari order item. Pemenuhan Lazada
// DITUNDA sampai eksekusi (status pesanan tidak berubah sebelum Setuju);
// nomor resi dibuat penjual (KT + order_id).
import { findAnekaCatalogById } from "@/lib/aneka-map";
import {
  anekaCheckoutToken,
  anekaCreatePayment,
  anekaFindOrderByPayment,
  anekaLogin,
  anekaPaymentEvidence,
  anekaProcessPayment,
  anekaResolveVariant,
  anekaVariantSave,
  type AnekaSession,
} from "@/lib/aneka-checkout";
import { buildAnekaCartItems } from "@/lib/aneka-exec";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  appendLazadaOrderExecLog,
  claimLazadaOrderExecRunning,
  getLazadaOrderExec,
  getLazadaProductMap,
  saveLazadaOrderExec,
  setLazadaOrderExecPayment,
} from "@/lib/db";
import {
  fulfillLazadaOrderForItems,
  getLazadaCtx,
  getLazadaOrderItems,
} from "@/lib/lazada";
import { LAZADA_STORE_NAME } from "@/lib/lazada-orders";
import {
  NOTIF_TEMPLATE,
  ownerNumber,
  sendTemplateParams,
  sendText,
} from "@/lib/wa";

const EKSEKUSI_URL = "https://admin.kustoro2026.com/marketplace/lazada/eksekusi";

/** Satu baris produk pesanan yang siap dibelikan di Aneka. */
export type LazadaExecItem = {
  /** Kunci pemetaan: SellerSku Lazada (tingkat produk). */
  lazada_sku: string;
  /** Shop SKU Lazada (tampilan/identifikasi saja). */
  seller_sku: string;
  item_name: string;
  /** Nama varian dari order item Lazada (padanan sku_name TikTok — petunjuk
   *  utama mencocokkan varian Aneka). */
  variant_name: string;
  qty: number;
  aneka_product_id: string;
  aneka_variant_id: string;
  aneka_product_name: string;
  harga_modal: number;
  subtotal: number;
};

/** Satu baris produk dari order item (bahan checkLazadaExecutable). */
export type LazadaExecSourceItem = {
  lazada_sku: string;
  seller_sku: string;
  item_name: string;
  variant_name: string;
  qty: number;
};

/** Muatan tersimpan di lazada_order_exec.payload (JSON) — cukup untuk
 *  menjalankan checkout Aneka kapan saja tanpa memanggil API Lazada lagi. */
export type LazadaExecPayload = {
  order_id: string;
  /** Order item id anggota pesanan — dipakai verifikasi "masih aktif"
   *  TEPAT sebelum membayar dan bahan pemenuhan Lazada. */
  order_item_ids: string[];
  store_name: string;
  customer_name: string;
  tracking_number: string;
  /** Kosong saat persiapan — diisi label PDF hasil pemenuhan (pack → rts →
   *  document) pada saat eksekusi. */
  label_pdf_base64: string;
  items: LazadaExecItem[];
  total_modal: number;
};

/** "Rp18.450" → 18450. */
function parseRp(s: string): number {
  const n = Number(String(s).replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** 18450 → "Rp18.450". */
function fmtRp(n: number): string {
  return "Rp" + n.toLocaleString("id-ID");
}

/** Kirim notifikasi teks ke WA admin: teks bebas (window 24 jam) → template
 *  teks cadangan (bebas window, menunggu review Meta). */
async function sendExecNotice(msg: string): Promise<string> {
  const owner = ownerNumber();
  if (!owner) return "gagal: OWNER_WA_NUMBER belum diatur";
  const free = await sendText(owner, msg);
  if (free.ok) return "ok";
  const tpl = await sendTemplateParams(owner, NOTIF_TEMPLATE, [msg]);
  if (tpl.ok) return "ok (template)";
  return `gagal: ${free.error ?? "teks ditolak"} | template: ${tpl.error ?? "ditolak"}`;
}

/** Gabung baris kembar (SKU + varian sama) menjadi satu baris dengan qty
 *  dijumlah. Lazada menulis satu order item per UNIT yang dibeli — SKU yang
 *  sama muncul berulang untuk qty > 1 — dan /variant/save Aneka MENIMPA qty
 *  produk yang sama, jadi tanpa penggabungan qty bisa beli kurang. Fungsi
 *  murni (tanpa DB) supaya bisa diuji. */
export function mergeLazadaExecItems(items: LazadaExecItem[]): LazadaExecItem[] {
  const merged = new Map<string, LazadaExecItem>();
  for (const it of items) {
    const key = `${it.lazada_sku}|${it.variant_name}`;
    const prev = merged.get(key);
    if (prev) {
      prev.qty += it.qty;
      prev.subtotal = prev.harga_modal * prev.qty;
    } else {
      merged.set(key, { ...it });
    }
  }
  return [...merged.values()];
}

/** Cek apakah SEMUA item pesanan sudah dipetakan ke Aneka (dan ada di
 *  katalog snapshot) — prasyarat eksekusi otomatis. Bila belum, pesanan
 *  tetap diproses jalur lama (kirim label ke WA). */
export async function checkLazadaExecutable(
  items: LazadaExecSourceItem[],
): Promise<{ ok: true; items: LazadaExecItem[] } | { ok: false; detail: string }> {
  if (items.length === 0) {
    return { ok: false, detail: "Pesanan tanpa item" };
  }
  const out: LazadaExecItem[] = [];
  const missing: string[] = [];
  for (const it of items) {
    // Qty 0/aneh → jangan menebak qty 1 dan membeli jumlah yang salah —
    // serahkan ke proses manual.
    if (!Number.isFinite(it.qty) || it.qty <= 0) {
      missing.push(`${it.item_name} (qty ${it.qty})`);
      continue;
    }
    const map = await getLazadaProductMap(it.lazada_sku);
    if (!map || map.enabled !== 1 || !map.aneka_product_id) {
      missing.push(`${it.item_name} (SKU ${it.lazada_sku})`);
      continue;
    }
    const cat = findAnekaCatalogById(map.aneka_product_id);
    const harga = parseRp(cat?.hargaModal ?? "");
    if (!cat || harga <= 0) {
      missing.push(`${it.item_name} (harga Aneka tidak ditemukan)`);
      continue;
    }
    out.push({
      lazada_sku: it.lazada_sku,
      seller_sku: it.seller_sku,
      item_name: it.item_name,
      variant_name: it.variant_name,
      qty: it.qty,
      aneka_product_id: map.aneka_product_id,
      aneka_variant_id: map.aneka_variant_id ?? "",
      aneka_product_name: cat.name,
      harga_modal: harga,
      subtotal: harga * it.qty,
    });
  }
  if (missing.length > 0) {
    return {
      ok: false,
      detail: `Belum bisa dieksekusi otomatis: ${missing.join(", ")}`,
    };
  }
  return { ok: true, items: mergeLazadaExecItems(out) };
}

/** Nomor resi pesanan Lazada yang dibuat penjual — sama untuk semua jalur
 *  (resi WA + eksekusi) supaya mudah dicocokkan di riwayat Aneka. */
export function lazadaTrackingNumber(orderId: string): string {
  return `${(process.env.LAZADA_TRACKING_PREFIX ?? "KT").trim()}${orderId}`;
}

/** Label resi PDF buatan sendiri (A6) untuk pesanan dropship
 *  own-logistics — dipakai bila label resmi Lazada tidak tersedia lewat
 *  API (peristiwa 17 Okt 2026: document/get membalas file 1 byte padahal
 *  code 0). Nomor resi penjual (KT...) adalah identitas kiriman, jadi
 *  label sederhana ini sah untuk diunggah ke Aneka dan ditempel di paket. */
export async function buatResiFallback(
  payload: LazadaExecPayload,
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([298, 420]); // A6 ≈ 105×148 mm
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const tengah = 149;
  const teks = (
    x: number,
    y: number,
    s: string,
    size: number,
    opts: { bold?: boolean; miring?: boolean } = {},
  ) => {
    const f = opts.bold ? bold : font;
    const w = f.widthOfTextAtSize(s, size);
    page.drawText(s, {
      x: x - w / 2,
      y,
      size,
      font: f,
      color: opts.miring ? rgb(0.35, 0.35, 0.35) : rgb(0, 0, 0),
    });
  };

  const tanggal = new Date();
  const tgl = tanggal.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  teks(tengah, 372, payload.store_name.toUpperCase(), 14, { bold: true });
  teks(tengah, 352, "RESI PENGIRIMAN", 10);
  page.drawLine({
    start: { x: 30, y: 336 },
    end: { x: 268, y: 336 },
    thickness: 1,
    color: rgb(0, 0, 0),
  });
  teks(tengah, 300, "No. Resi", 10);
  teks(tengah, 268, payload.tracking_number, 20, { bold: true });
  page.drawLine({
    start: { x: 30, y: 244 },
    end: { x: 268, y: 244 },
    thickness: 1,
    color: rgb(0, 0, 0),
  });
  teks(tengah, 210, "Pesanan Lazada", 10);
  teks(tengah, 188, payload.order_id, 13, { bold: true });
  teks(tengah, 156, "Pembeli", 10);
  teks(tengah, 134, payload.customer_name, 12, { bold: true });
  teks(tengah, 100, tgl, 10, { miring: true });
  return Buffer.from(await doc.save());
}

/** PERSIAPAN: simpan rincian produk sebagai antrean eksekusi "menunggu" dan
 *  kirim notif WA berisi tautan Setuju. Pemenuhan Lazada TIDAK dijalankan
 *  di sini (ditunda sampai Setuju) — label_pdf_base64 dibiarkan kosong.
 *  Idempoten — bila barisnya sudah menunggu, tidak menyimpan/kirim ulang
 *  (kecuali opts.resendNotice = true, dipakai ketika notif WA percobaan
 *  sebelumnya gagal terkirim). */
export async function prepareLazadaExec(
  pkg: {
    order_id: string;
    order_item_ids: string[];
    store_name: string;
    customer_name: string;
    items: LazadaExecSourceItem[];
  },
  opts: { resendNotice?: boolean } = {},
): Promise<{ ok: boolean; detail: string }> {
  const existing = await getLazadaOrderExec(pkg.order_id);
  if (existing?.status === "menunggu" && !opts.resendNotice) {
    return { ok: true, detail: "Sudah menunggu persetujuan" };
  }

  const check = await checkLazadaExecutable(pkg.items);
  if (!check.ok) return { ok: false, detail: check.detail };

  const total = check.items.reduce((s, it) => s + it.subtotal, 0);
  const payload: LazadaExecPayload = {
    order_id: pkg.order_id,
    order_item_ids: pkg.order_item_ids,
    store_name: pkg.store_name,
    customer_name: pkg.customer_name,
    tracking_number: lazadaTrackingNumber(pkg.order_id),
    label_pdf_base64: "",
    items: check.items,
    total_modal: total,
  };

  // Persiapan ulang = antrean baru. Jejak pembayaran percobaan lama
  // DIPERTAHANKAN (aneka_payment_id/aneka_order_id + log) — bahan pengaman
  // anti-dobel bila baris ini dieksekusi lagi.
  const ctx = await getLazadaCtx();
  await saveLazadaOrderExec({
    order_id: pkg.order_id,
    store_code: ctx.ok ? ctx.sellerId : "",
    status: "menunggu",
    payload: JSON.stringify(payload),
    aneka_payment_id: existing?.aneka_payment_id ?? "",
    aneka_order_id: existing?.aneka_order_id ?? "",
    detail: "",
    executed_at: "",
  });

  const baris = check.items
    .map(
      (it) =>
        `- ${it.qty}x ${it.item_name}${it.variant_name ? ` (${it.variant_name})` : ""} (${fmtRp(it.subtotal)})`,
    )
    .join("\n");
  const notice = await sendExecNotice(
    `Pesanan Lazada ${pkg.order_id} siap dieksekusi ke Aneka (${pkg.store_name}).\n${baris}\nTotal modal ${fmtRp(total)}. No resi ${payload.tracking_number}.\nSetuju/batalkan: ${EKSEKUSI_URL}?order=${pkg.order_id}`,
  );
  if (!notice.startsWith("ok")) {
    return { ok: false, detail: `Tersimpan, tetapi notif WA gagal: ${notice}` };
  }
  return { ok: true, detail: "Menunggu persetujuan" };
}

/** Batal (dari tombol Batalkan atau deteksi pesanan dibatalkan pembeli). */
export async function cancelLazadaExec(orderId: string): Promise<void> {
  const row = await getLazadaOrderExec(orderId);
  if (!row || row.status !== "menunggu") return;
  await appendLazadaOrderExecLog(orderId, "Dibatalkan — tombol Batalkan");
  await saveLazadaOrderExec({
    order_id: orderId,
    status: "batal",
    payload: row.payload,
    detail: "",
    executed_at: new Date().toISOString().slice(0, 19).replace("T", " "),
  });
}

/** Jeda minimal sebelum baris "berjalan" yang macet (proses terputus di
 *  tengah) boleh diambil alih. Rantai dibatasi 60 detik (maxDuration route),
 *  jadi baris "berjalan" dengan jejak lebih tua dari ini pasti sudah mati. */
const BERJALAN_MIN_MS = 2 * 60 * 1000;

/** Masa tunggu anti-dobel: percobaan yang sampai langkah pembayaran dengan
 *  hasil meragukan (ambigu/berhasil) tidak boleh dipaksa ulang terlalu
 *  cepat — riwayat Aneka butuh waktu untuk memuat pembayaran yang
 *  sebenarnya sudah lolos (membayar ulang saat riwayat belum ter-update
 *  adalah penyebab pembayaran dobel). */
const COOLDOWN_PAY_MS = 20 * 60 * 1000;

/** UTC "YYYY-MM-DD HH:MM:SS" → epoch ms (stempel log langkah eksekusi). */
function parseUtcMs(s: string): number {
  const t = Date.parse(s.replace(" ", "T") + "Z");
  return Number.isFinite(t) ? t : 0;
}

/** Pastikan SEMUA item pesanan belum dibatalkan pembeli — dipanggil TEPAT
 *  sebelum rantai pembayaran supaya saldo Aneka tidak terpakai untuk pesanan
 *  yang batal di tengah antrean. Verifikasi gagal = hentikan (lebih aman
 *  menunda daripada membayar pesanan yang mungkin sudah batal).
 *  batal=true hanya untuk pembatalan SUNGGAHAN (dari pihak pembeli) —
 *  kegagalan teknis (kuota API habis, jaringan) batal=false supaya baris
 *  antrean TIDAK ditutup, cukup dicoba lagi nanti. */
async function lazadaOrderStillActive(
  orderId: string,
  orderItemIds: string[],
): Promise<{ ok: boolean; detail: string; batal?: boolean }> {
  if (orderItemIds.length === 0) {
    return {
      ok: false,
      batal: false,
      detail:
        "Daftar item pesanan kosong — status pesanan tidak bisa diverifikasi, eksekusi dihentikan",
    };
  }
  const items = await getLazadaOrderItems(orderId);
  if (!items.ok) {
    return {
      ok: false,
      batal: false,
      detail: `Status pesanan Lazada tidak bisa diverifikasi (${items.detail}) — eksekusi dihentikan demi keamanan, coba lagi nanti`,
    };
  }
  const target = new Set(orderItemIds);
  const list = items.data.filter((i) => target.has(i.order_item_id));
  if (list.length === 0) {
    return {
      ok: false,
      batal: false,
      detail:
        "Item pesanan tidak terbaca di API Lazada — eksekusi dihentikan demi keamanan, coba lagi nanti",
    };
  }
  let batal = 0;
  let statusTerakhir = "";
  for (const it of list) {
    const st = (it.status ?? "").toLowerCase();
    if (["canceled", "returned", "failed", "lost"].includes(st)) {
      batal++;
    } else if (st !== "") {
      statusTerakhir = st;
    }
  }
  if (batal === list.length) {
    return {
      ok: false,
      batal: true,
      detail: "Pesanan dibatalkan pembeli — eksekusi dihentikan",
    };
  }
  if (batal > 0) {
    return {
      ok: false,
      batal: true,
      detail:
        "Sebagian item pesanan dibatalkan pembeli — eksekusi dihentikan demi keamanan (proses manual)",
    };
  }
  return { ok: true, detail: statusTerakhir || "aktif" };
}

/** Nomor resi dari payload baris eksekusi (tahan payload rusak). */
function resiDariPayload(payload: string): string {
  try {
    const p = JSON.parse(payload) as LazadaExecPayload;
    return p.tracking_number ?? "";
  } catch {
    return "";
  }
}

/** Analisis jejak log percobaan-percobaan sebelumnya: apakah pernah sampai
 *  langkah pembayaran, dan bagaimana hasilnya. Dipakai pengaman anti-dobel —
 *  "berhasil"/"ambigu" wajib diverifikasi di riwayat Aneka sebelum baris
 *  boleh membayar lagi; hanya "ditolak" (validasi ditolak situs, saldo
 *  pasti tidak bergerak) dan "belum" yang aman langsung diulang. */
function statusPembayaranSebelumnya(
  log: string,
): "berhasil" | "ditolak" | "ambigu" | "belum" {
  const lines = log
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const proses = lines.filter((l) => l.includes("pembayaran/process"));
  if (proses.some((l) => l.includes("| berhasil"))) return "berhasil";
  if (proses.length > 0) {
    const semuaDitolak = proses.every(
      (l) =>
        l.includes("Pembayaran ditolak situs") ||
        l.includes("Pembayaran ditolak:"),
    );
    return semuaDitolak ? "ditolak" : "ambigu";
  }
  // Baris checkout berhasil tanpa baris proses setelahnya = proses mati
  // tepat di langkah pembayaran — hasilnya tak diketahui → ambigu.
  const idxCheckout = lines.findIndex((l) =>
    l.includes("| checkout | token didapat"),
  );
  if (idxCheckout >= 0) return "ambigu";
  return "belum";
}

/** Waktu percobaan terakhir yang sampai di langkah pembayaran dengan hasil
 *  berhasil/ambigu (dasar masa tunggu anti-dobel) — null bila log tidak
 *  pernah sampai ke sana atau semua percobaan ditolak situs (saldo pasti
 *  tidak bergerak, aman diulang kapan saja). */
function infoCooldownBayar(log: string): { ms: number; teks: string } | null {
  const st = statusPembayaranSebelumnya(log);
  if (st !== "berhasil" && st !== "ambigu") return null;
  let terakhir: { ms: number; teks: string } | null = null;
  for (const baris of log.split("\n")) {
    const ts =
      /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/.exec(baris.trim())?.[1] ?? "";
    const ms = ts ? parseUtcMs(ts) : 0;
    if (!ms) continue;
    if (
      baris.includes("pembayaran/process") ||
      baris.includes("| checkout | token didapat")
    ) {
      if (!terakhir || ms > terakhir.ms) terakhir = { ms, teks: ts };
    }
  }
  return terakhir;
}

/** "YYYY-MM-DD HH:MM:SS" UTC → "YYYY-MM-DD HH:MM" WIB (label pesan). */
function utcKeWibJam(tsUtc: string): string {
  const ms = parseUtcMs(tsUtc);
  if (!ms) return tsUtc;
  return new Date(ms + 7 * 3600 * 1000)
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");
}

/** Bukti pesanan SUDAH terbayar di Aneka (ditemukan lewat riwayat). */
type BuktiTerbayar = {
  paymentId: string;
  orderCode: string;
  keterangan: string;
};

/** Cari bukti pesanan ini sudah pernah dibayar di Aneka — kandidat
 *  payment_id (kolom + log) diperiksa lewat halaman finish (kode ORDER
 *  numerik yang memuat payment_id), lalu payment_id/nomor resi discan di
 *  daftar /payment-history beberapa halaman pertama. Resi KT + order_id
 *  unik per pesanan Lazada — penanda paling andal bahwa pesanan ini sudah
 *  dibelikan. */
async function cariBuktiTerbayar(
  session: AnekaSession,
  anekaPaymentId: string,
  log: string,
  resi: string,
): Promise<BuktiTerbayar | null> {
  const kandidat = new Set<string>();
  if (anekaPaymentId) kandidat.add(anekaPaymentId);
  for (const m of log.matchAll(/payment_id (\d+)/g)) kandidat.add(m[1]);

  for (const id of kandidat) {
    const found = await anekaFindOrderByPayment(session, id);
    if (
      found.ok &&
      found.orderCode &&
      new RegExp(`ORDER-${id}-\\d{6,}`).test(found.orderCode)
    ) {
      return {
        paymentId: id,
        orderCode: found.orderCode,
        keterangan: `kode pesanan ${found.orderCode} memuat payment ${id}`,
      };
    }
  }
  for (const id of kandidat) {
    // "Terdaftar di riwayat" BUKAN bukti bayar sejak 2026-10 — payment
    // Pending (belum dibayar) juga tampil di /payment-history. Bukti hanya
    // sah bila status barisnya non-Pending.
    const ev = await anekaPaymentEvidence(session, id);
    if (ev.found && !ev.pending) {
      return {
        paymentId: id,
        orderCode: "",
        keterangan: `payment ${id} terdaftar di riwayat pembayaran (status ${ev.status || "non-pending"})`,
      };
    }
  }
  if (resi) {
    const ev = await anekaPaymentEvidence(session, resi);
    if (ev.found && !ev.pending) {
      return {
        paymentId: "",
        orderCode: "",
        keterangan: `nomor resi ${resi} sudah muncul di riwayat pembayaran (status ${ev.status || "non-pending"})`,
      };
    }
  }
  return null;
}

/** Tandai baris selesai dari bukti pembayaran sebelumnya (tanpa membayar
 *  ulang) + kabari WA. */
async function pulihkanSelesai(
  orderId: string,
  payload: string,
  bukti: BuktiTerbayar,
): Promise<{ ok: boolean; detail: string }> {
  const nowUtc = new Date().toISOString().slice(0, 19).replace("T", " ");
  await saveLazadaOrderExec({
    order_id: orderId,
    status: "selesai",
    payload,
    aneka_payment_id: bukti.paymentId,
    aneka_order_id: bukti.orderCode,
    detail: "",
    executed_at: nowUtc,
  });
  await appendLazadaOrderExecLog(
    orderId,
    `${nowUtc} | pemulihan | pembayaran sebelumnya terverifikasi — ${bukti.keterangan}`,
  );
  await sendExecNotice(
    `Eksekusi Aneka BERHASIL untuk pesanan Lazada ${orderId} (dipulihkan dari percobaan sebelumnya).\n${bukti.keterangan}${bukti.paymentId ? `\nID pembayaran Aneka: ${bukti.paymentId}` : ""}${bukti.orderCode ? ` (kode pesanan: ${bukti.orderCode})` : ""}\nDetail: https://anekadropship.id/payment-history`,
  );
  return { ok: true, detail: `Dipulihkan — ${bukti.keterangan}` };
}

/** Blokir coba-ulang yang berisiko membayar dobel: percobaan sebelumnya
 *  sampai langkah pembayaran tetapi bukti terbayar tidak terbaca di
 *  riwayat. Baris ditandai "gagal" dengan penanda [PERLU CEK MANUAL] —
 *  UI menampilkan tombol paksa untuk pemilik yang SUDAH memeriksa manual.
 *  Bila percobaan terakhir baru saja (masa tunggu aktif), batas waktu
 *  coba-ulang disertakan supaya riwayat Aneka keburu ter-update. */
async function blokirCekManual(
  orderId: string,
  payload: string,
  log: string,
  detail: string,
): Promise<{ ok: false; detail: string }> {
  const cd = infoCooldownBayar(log);
  const tunggu =
    cd && Date.now() - cd.ms < COOLDOWN_PAY_MS
      ? `\nMasa tunggu: coba lagi setelah ${utcKeWibJam(
          new Date(cd.ms + COOLDOWN_PAY_MS)
            .toISOString()
            .slice(0, 19)
            .replace("T", " "),
        )} WIB (menunggu riwayat Aneka ter-update).`
      : "";
  await saveLazadaOrderExec({
    order_id: orderId,
    status: "gagal",
    payload,
    detail: `[PERLU CEK MANUAL] ${detail}${tunggu}`,
  });
  await sendExecNotice(
    `Eksekusi Aneka DITAHAN untuk pesanan Lazada ${orderId}: ${detail}${tunggu}\nPeriksa riwayat pembayaran Aneka (https://anekadropship.id/payment-history) — bila pesanan ini BELUM terbayar di sana, gunakan tombol "Sudah dicek manual — bayar ulang" di halaman Eksekusi.`,
  );
  return { ok: false, detail: `[PERLU CEK MANUAL] ${detail}${tunggu}` };
}

/** Jalankan rantai checkout Aneka penuh untuk satu antrean "menunggu"
 *  (atau coba ulang baris "gagal"). Sukses → status "selesai" + ID pesanan
 *  Aneka dikirim ke WA; gagal → status "gagal" + keterangan (bisa dicoba
 *  lagi). Sebelum membayar, pemenuhan Lazada (pack → rts → label) dijalankan
 *  bila belum pernah; pengaman anti-dobel memverifikasi riwayat Aneka
 *  (payment_id tersimpan + nomor resi); opts.force melewati pengaman itu —
 *  hanya boleh dipakai setelah pemilik memeriksa riwayat manual. */
export async function executeLazadaOrder(
  orderId: string,
  opts: { force?: boolean } = {},
): Promise<{ ok: boolean; detail: string }> {
  const row = await getLazadaOrderExec(orderId);
  if (!row)
    return { ok: false, detail: "Pesanan ini belum disiapkan untuk eksekusi" };
  if (row.status === "selesai") {
    return { ok: false, detail: "Pesanan ini sudah dieksekusi" };
  }
  if (row.status === "batal") {
    return { ok: false, detail: "Pesanan ini dibatalkan" };
  }

  // Baris "berjalan" berarti ada percobaan yang mungkin terputus di tengah
  // (batas waktu serverless, tab ditutup). Pulihkan dengan hati-hati —
  // JANGAN pernah membayar dua kali.
  if (row.status === "berjalan") {
    const lines = row.log.trim().split("\n").filter(Boolean);
    const last = lines[lines.length - 1] ?? "";
    const ts = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.exec(last)?.[0] ?? "";
    const ageMs = ts ? Date.now() - parseUtcMs(ts) : Number.POSITIVE_INFINITY;
    if (ageMs < BERJALAN_MIN_MS) {
      return {
        ok: false,
        detail: "Eksekusi masih berjalan — muat ulang halaman sebentar lagi",
      };
    }
    const stBayar = statusPembayaranSebelumnya(row.log);
    if (stBayar === "berhasil" || stBayar === "ambigu") {
      // Terputus di/sekitar langkah pembayaran → verifikasi dulu lewat
      // riwayat Aneka; bila tidak terbukti terbayar, TAHAN (jangan nekat
      // membayar ulang — risiko dobel lebih mahal daripada tertunda).
      const login = await anekaLogin();
      if (!login.ok) {
        return blokirCekManual(
          orderId,
          row.payload,
          row.log,
          `percobaan sebelumnya sampai langkah pembayaran, tetapi login Aneka untuk verifikasi gagal (${login.detail})`,
        );
      }
      const bukti = await cariBuktiTerbayar(
        login.session,
        row.aneka_payment_id,
        row.log,
        resiDariPayload(row.payload),
      );
      if (bukti) return pulihkanSelesai(orderId, row.payload, bukti);
      return blokirCekManual(
        orderId,
        row.payload,
        row.log,
        stBayar === "berhasil"
          ? "percobaan sebelumnya mencatat pembayaran berhasil tetapi belum terbukti di riwayat — kemungkinan riwayat Aneka belum ter-update"
          : "percobaan sebelumnya terputus di langkah pembayaran dan belum terbukti belum terbayar",
      );
    }
    // Terputus SEBELUM pembayaran — aman diulang: kembalikan ke "gagal"
    // supaya klaim atomik di bawah bisa mengambil alih.
    await saveLazadaOrderExec({
      order_id: orderId,
      status: "gagal",
      payload: row.payload,
      detail: "Terputus di tengah — dicoba ulang",
    });
  }

  let payload: LazadaExecPayload;
  try {
    payload = JSON.parse(row.payload) as LazadaExecPayload;
  } catch {
    return {
      ok: false,
      detail: "Data eksekusi rusak — siapkan ulang pesanan ini",
    };
  }
  if (!payload.items?.length) {
    return {
      ok: false,
      detail: "Data eksekusi tidak lengkap — siapkan ulang pesanan ini",
    };
  }

  // MASA TUNGGU ANTI-DOBEL: pembayaran ulang PAKSA (opts.force) ditolak bila
  // percobaan sebelumnya baru saja sampai langkah pembayaran dengan hasil
  // meragukan — riwayat Aneka butuh waktu untuk memuat pembayaran yang
  // sebenarnya sudah lolos (kalau dipaksa terburu-buru, bisa bayar dobel).
  // Percobaan biasa TIDAK ditahan di sini: pengaman anti-dobel di bawah
  // yang memverifikasi (read-only, aman).
  const cooldown = infoCooldownBayar(row.log);
  if (opts.force && cooldown && Date.now() - cooldown.ms < COOLDOWN_PAY_MS) {
    return {
      ok: false,
      detail: `Masa tunggu anti-dobel: percobaan sebelumnya sampai langkah pembayaran (${utcKeWibJam(cooldown.teks)} WIB). Tunggu sampai ${utcKeWibJam(
        new Date(cooldown.ms + COOLDOWN_PAY_MS)
          .toISOString()
          .slice(0, 19)
          .replace("T", " "),
      )} WIB sebelum memaksa bayar ulang — periksa riwayat Aneka dulu, pembayaran itu mungkin sudah berhasil.`,
    };
  }

  const gagal = async (detail: string) => {
    // Payload TERBARU disimpan (bukan row.payload) — bila pemenuhan sudah
    // berhasil, label_pdf_base64 harus tetap tersimpan supaya coba ulang
    // tidak memanggil ulang pack/rts/document (dan kehilangan jejak label).
    await saveLazadaOrderExec({
      order_id: orderId,
      status: "gagal",
      payload: JSON.stringify(payload),
      detail,
    });
    await sendExecNotice(
      `Eksekusi Aneka GAGAL untuk pesanan Lazada ${orderId}: ${detail}\nCoba lagi: ${EKSEKUSI_URL}?order=${orderId}\nCatatan: periksa dulu riwayat pembayaran Aneka (https://anekadropship.id/payment-history) — pastikan saldo belum terpotong sebelum mencoba lagi.`,
    );
    return { ok: false, detail };
  };

  // 1. Klaim atomik: hanya SATU permintaan Setuju yang boleh menjalankan
  //    rantai — mencegah dua tab/klik bersamaan membayar dua kali. Tiap
  //    langkah berikutnya dicatat ke kolom log baris ini — ditulis langsung
  //    per langkah supaya bila proses serverless terputus (mis. batas
  //    waktu), jejak sampai langkah terakhir tetap tersimpan untuk diagnosa.
  const claimed = await claimLazadaOrderExecRunning(orderId);
  if (!claimed) {
    return {
      ok: false,
      detail:
        "Pesanan ini sedang dieksekusi atau sudah diproses — muat ulang halaman",
    };
  }
  // Jejak log TIDAK dihapus antar percobaan — log lama adalah bahan
  // pengaman anti-dobel (statusPembayaranSebelumnya + payment_id tercatat).
  // Beri pemisah supaya jejak tiap percobaan tetap mudah dibaca.
  await appendLazadaOrderExecLog(orderId, "---------- percobaan baru ----------");
  const logStep = async (langkah: string, pesan: string) => {
    const t = new Date().toISOString().slice(0, 19).replace("T", " ");
    await appendLazadaOrderExecLog(orderId, `${t} | ${langkah} | ${pesan}`);
  };

  await logStep("mulai", "rantai checkout Aneka dijalankan");

  // 2. Pastikan item pesanan masih aktif (belum dibatalkan pembeli) SEBELUM
  //    memindahkan saldo — mencegah bayar pesanan yang batal.
  const aktif = await lazadaOrderStillActive(payload.order_id, payload.order_item_ids);
  if (!aktif.ok) {
    await logStep("cek-pesanan", `GAGAL — ${aktif.detail}`);
    const nowUtc = new Date().toISOString().slice(0, 19).replace("T", " ");
    if (!aktif.batal) {
      // Kegagalan TEKNIS (kuota API habis, jaringan, dll.) — bukan
      // pembatalan. Baris jangan ditutup: kembalikan ke "gagal" supaya
      // pemilik bisa menekan Setuju lagi saat gangguan lewat.
      await saveLazadaOrderExec({
        order_id: orderId,
        status: "gagal",
        payload: row.payload,
        detail: aktif.detail,
      });
      await sendExecNotice(
        `Eksekusi Aneka DITUNDA untuk pesanan Lazada ${orderId}: ${aktif.detail}\nCoba lagi: ${EKSEKUSI_URL}?order=${orderId}`,
      );
      return { ok: false, detail: aktif.detail };
    }
    await saveLazadaOrderExec({
      order_id: orderId,
      status: "batal",
      payload: row.payload,
      detail: aktif.detail,
      executed_at: nowUtc,
    });
    await sendExecNotice(
      `Eksekusi Aneka DIBATALKAN untuk pesanan Lazada ${orderId}: ${aktif.detail}`,
    );
    return { ok: false, detail: aktif.detail };
  }
  await logStep("cek-pesanan", `pesanan masih aktif (status ${aktif.detail})`);

  // 3. PEMENUHAN LAZADA (pack → rts → label) — ditunda sampai persetujuan
  //    supaya status pesanan tidak berubah sebelum pemilik Setuju. Label
  //    PDF hasilnya dipakai untuk upload resi di pembayaran Aneka. Bila
  //    payload sudah punya label (percobaan ulang setelah pemenuhan
  //    berhasil), pakai ulang tanpa memanggil API pemenuhan lagi.
  let pdfBuffer: Buffer | null = null;
  if (payload.label_pdf_base64) {
    const tersimpan = Buffer.from(payload.label_pdf_base64, "base64");
    // Label tersimpan hanya dipakai bila benar-benar PDF valid — mencegah
    // file rusak dari percobaan lama diunggah lagi ke pembayaran.
    pdfBuffer =
      tersimpan.length >= 5 && tersimpan.subarray(0, 5).toString("ascii") === "%PDF-"
        ? tersimpan
        : null;
  }
  if (!pdfBuffer) {
    const fulf = await fulfillLazadaOrderForItems(
      payload.order_item_ids,
      payload.order_id,
    );
    if (!fulf.ok) {
      // rts sudah berhasil (rtsDone) = pesanan siap kirim, hanya label
      // resmi yang tidak tersedia — pakai resi PDF buatan sendiri supaya
      // checkout Aneka tetap bisa diselesaikan. Bila rts sendiri gagal,
      // JANGAN nekat membayar: pesanan belum siap kirim.
      if (fulf.rtsDone) {
        const fallback = await buatResiFallback(payload).catch(() => null);
        if (fallback) {
          pdfBuffer = fallback;
          payload = {
            ...payload,
            label_pdf_base64: fallback.toString("base64"),
          };
          await saveLazadaOrderExec({
            order_id: orderId,
            status: "berjalan",
            payload: JSON.stringify(payload),
          });
          await logStep(
            "fulfill",
            `label resmi tidak tersedia (${fulf.detail}) — dipakai resi PDF buatan sendiri (resi ${payload.tracking_number})`,
          );
        } else {
          await logStep(
            "fulfill",
            `GAGAL — ${fulf.detail} (resi PDF buatan sendiri juga gagal)`,
          );
          return gagal(fulf.detail);
        }
      } else {
        await logStep("fulfill", `GAGAL — ${fulf.detail}`);
        return gagal(fulf.detail);
      }
    } else {
      pdfBuffer = fulf.pdf;
      payload = {
        ...payload,
        tracking_number: fulf.trackingNumber,
        label_pdf_base64: fulf.pdf.toString("base64"),
      };
      await saveLazadaOrderExec({
        order_id: orderId,
        status: "berjalan",
        payload: JSON.stringify(payload),
      });
      await logStep(
        "fulfill",
        `berhasil — pack + rts + label (resi ${fulf.trackingNumber})`,
      );
    }
  }

  // PENGAMAN ANTI-DOBEL: sebelum membayar, pastikan percobaan-percobaan
  // sebelumnya belum benar-benar membayar pesanan ini di Aneka — cek
  // riwayat berdasarkan payment_id tersimpan/tercatat dan nomor resi (unik
  // per pesanan Lazada). Hanya boleh dilewati lewat tombol paksa eksplisit
  // setelah pemilik memeriksa riwayat manual (opts.force).
  let login = opts.force ? await anekaLogin() : null;
  if (!opts.force) {
    const stBayar = statusPembayaranSebelumnya(row.log);
    const punyaJejak =
      row.aneka_payment_id !== "" ||
      stBayar === "berhasil" ||
      stBayar === "ambigu";
    if (punyaJejak) {
      const loginG = await anekaLogin();
      if (!loginG.ok) {
        await logStep("anti-dobel", `login verifikasi GAGAL — ${loginG.detail}`);
        if (stBayar === "berhasil" || stBayar === "ambigu") {
          return blokirCekManual(
            orderId,
            row.payload,
            row.log,
            `ada jejak pembayaran sebelumnya tetapi login Aneka untuk verifikasi gagal (${loginG.detail})`,
          );
        }
      } else {
        login = { ok: true as const, session: loginG.session };
        const bukti = await cariBuktiTerbayar(
          loginG.session,
          row.aneka_payment_id,
          row.log,
          payload.tracking_number,
        );
        if (bukti) {
          await logStep(
            "anti-dobel",
            `terbukti sudah terbayar — ${bukti.keterangan}`,
          );
          return pulihkanSelesai(orderId, row.payload, bukti);
        }
        if (stBayar === "berhasil" || stBayar === "ambigu") {
          await logStep(
            "anti-dobel",
            `DITAHAN — ${stBayar} tetapi belum terbukti di riwayat`,
          );
          return blokirCekManual(
            orderId,
            row.payload,
            row.log,
            stBayar === "berhasil"
              ? "percobaan sebelumnya mencatat pembayaran berhasil tetapi belum terbukti di riwayat — kemungkinan riwayat Aneka belum ter-update"
              : "percobaan sebelumnya terputus di langkah pembayaran dan belum terbukti belum terbayar",
          );
        }
        await logStep(
          "anti-dobel",
          `payment lama ${row.aneka_payment_id} belum terbukti terbayar — aman lanjut dengan payment baru`,
        );
      }
    } else {
      await logStep(
        "anti-dobel",
        "tidak ada jejak pembayaran sebelumnya — lanjut",
      );
    }
  } else {
    await logStep(
      "anti-dobel",
      "pengaman dilewati atas perintah eksplisit pemilik",
    );
  }

  // Login + buat pembayaran (payment_id baru setiap percobaan).
  if (!login) {
    login = await anekaLogin();
  }
  if (!login.ok) {
    await logStep("login", `GAGAL — ${login.detail}`);
    return gagal(login.detail);
  }
  await logStep("login", "berhasil masuk");
  const pay = await anekaCreatePayment(login.session);
  if (!pay.ok) {
    await logStep("payment/create", `GAGAL — ${pay.detail}`);
    return gagal(pay.detail);
  }
  await logStep("payment/create", `berhasil — payment_id ${pay.paymentId}`);
  // SEGERA catat payment_id ke baris — bila percobaan ini gagal/terputus
  // di langkah mana pun, id ini jadi kunci verifikasi anti-dobel saat
  // coba ulang (jangan sampai jejak pembayaran hilang seperti kejadian
  // pembayaran dobel).
  await setLazadaOrderExecPayment(orderId, pay.paymentId);

  // 1b. Tentukan varian produk ber-varian yang belum dipetakan manual
  //     (data varian diambil dari halaman produk Aneka; variant_name dari
  //     order item jadi petunjuk pencocokan, fallback ke nama item).
  for (const it of payload.items) {
    if (it.aneka_variant_id) continue;
    const langkah = `varian:${it.aneka_product_id}`;
    await logStep(
      langkah,
      `mencari varian untuk "${it.variant_name || it.item_name}"`,
    );
    const v = await anekaResolveVariant(
      login.session,
      it.aneka_product_id,
      it.variant_name || it.item_name,
    );
    if (!v.ok) {
      await logStep(langkah, `GAGAL — ${v.detail}`);
      return gagal(v.detail);
    }
    if (v.variantId) it.aneka_variant_id = v.variantId;
    await logStep(
      langkah,
      v.variantId
        ? `dipakai variant_id ${v.variantId}${v.label ? ` (${v.label})` : ""}`
        : "produk tanpa varian",
    );
  }

  // 2. Masukkan produk: satu panggilan variant/save per kombinasi
  //    produk+varian (buildAnekaCartItems dari modul TikTok — penggabungan
  //    qty + guard gagal-aman untuk varian campur).
  const cart = buildAnekaCartItems(
    payload.items.map((it) => ({
      tiktok_product_id: it.lazada_sku,
      product_name: it.item_name,
      sku_name: it.variant_name,
      qty: it.qty,
      aneka_product_id: it.aneka_product_id,
      aneka_variant_id: it.aneka_variant_id,
      aneka_product_name: it.aneka_product_name,
      harga_modal: it.harga_modal,
      subtotal: it.subtotal,
    })),
  );
  if (!cart.ok) {
    await logStep("variant/save", `GAGAL — ${cart.detail}`);
    return gagal(cart.detail);
  }
  const save = await anekaVariantSave(login.session, pay.paymentId, cart.items);
  if (!save.ok) {
    await logStep("variant/save", `GAGAL — ${save.detail}`);
    return gagal(save.detail);
  }
  await logStep(
    "variant/save",
    `berhasil — ${cart.items.length} baris (total ${cart.totalPcs} pcs) masuk keranjang (slot resi 1)`,
  );

  // 3. Token halaman checkout → bayar saldo + upload label resmi.
  const tok = await anekaCheckoutToken(login.session, pay.paymentId);
  if (!tok.ok) {
    await logStep("checkout", `GAGAL — ${tok.detail}`);
    return gagal(tok.detail);
  }
  await logStep(
    "checkout",
    `token didapat — ${tok.itemResiIds.length} baris item_resi`,
  );
  const process = await anekaProcessPayment(
    login.session,
    pay.paymentId,
    tok.token,
    tok.itemResiIds,
    {
      number: payload.tracking_number,
      pdf: pdfBuffer ?? undefined,
    },
  );
  if (!process.ok) {
    await logStep("pembayaran/process", `GAGAL — ${process.detail}`);
    return gagal(process.detail);
  }
  await logStep(
    "pembayaran/process",
    `berhasil — bayar saldo wallet + upload label ${payload.tracking_number}`,
  );

  // 4. Konfirmasi lewat halaman detail riwayat pembayaran Aneka (kunci
  //    payment_id); bukan penentu sukses — pembayaran sudah lolos — hanya
  //    untuk laporan dan tautan detail.
  const found = await anekaFindOrderByPayment(login.session, pay.paymentId);
  const anekaId = found.ok && found.orderCode ? found.orderCode : "";
  await logStep(
    "verifikasi",
    anekaId
      ? `payment ${pay.paymentId} terverifikasi di riwayat — ${anekaId}`
      : `payment ${pay.paymentId} tidak terbaca kodenya — cek riwayat manual`,
  );

  const nowUtc = new Date().toISOString().slice(0, 19).replace("T", " ");
  await saveLazadaOrderExec({
    order_id: orderId,
    status: "selesai",
    // Payload terkini (varian ter-resolve + label hasil pemenuhan) —
    // bukan payload awal, supaya baris selesai menampilkan resi dan varian
    // yang benar-benar dipakai.
    payload: JSON.stringify(payload),
    aneka_payment_id: pay.paymentId,
    aneka_order_id: anekaId,
    detail: "",
    executed_at: nowUtc,
  });
  await logStep(
    "selesai",
    `status selesai — payment ${pay.paymentId}${anekaId ? ` (${anekaId})` : ""}`,
  );

  await sendExecNotice(
    `Eksekusi Aneka BERHASIL untuk pesanan Lazada ${orderId}.\nID pembayaran Aneka: ${pay.paymentId}${anekaId ? ` (kode pesanan: ${anekaId})` : ""}\nDetail: https://anekadropship.id/payment-history/finish?payment_id=${pay.paymentId}&status=success`,
  );
  return {
    ok: true,
    detail: `Selesai — ID pembayaran Aneka: ${pay.paymentId}${anekaId ? ` (${anekaId})` : ""}`,
  };
}
