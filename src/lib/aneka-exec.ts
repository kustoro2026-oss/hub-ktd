// Orkestrasi eksekusi pesanan TikTok Shop → Anekadropship (Fase 2, mode
// SEMI-OTOMATIS). Alur:
//
//  1. PERSIAPAN (murah, saat pesanan baru terdeteksi setelah masa tunggu):
//     cek semua produk pesanan sudah dipetakan ke Aneka → simpan label resmi
//     + rincian produk ke tabel tiktok_order_exec (status "menunggu") →
//     kirim notif WA "Setuju" berisi tautan halaman Eksekusi.
//  2. PERSETUJUAN (tombol Setuju di halaman Eksekusi, dipicu pemilik toko):
//     baru DI SINI rantai Aneka dijalankan penuh — login → payment/create →
//     variant/save → token checkout → pembayaran/process (bayar saldo) →
//     baca kode pesanan Aneka (ORDER-{payment_id}-...) dari riwayat — lalu
//     kabari WA.
//
// Rantai Aneka TIDAK dijalankan saat persiapan supaya tidak menumpuk
// pembayaran mangkrak di akun Aneka bila pemilik tidak menyetujui.
import { findAnekaCatalogById } from "@/lib/aneka-map";
import {
  anekaCheckoutToken,
  anekaCreatePayment,
  anekaFindOrderByPayment,
  anekaLogin,
  anekaPaymentListed,
  anekaProcessPayment,
  anekaResolveVariant,
  anekaVariantSave,
  type AnekaCartItem,
  type AnekaSession,
} from "@/lib/aneka-checkout";
import {
  appendTiktokOrderExecLog,
  claimTiktokOrderExecRunning,
  getAnekaProductMap,
  getTiktokOrderExec,
  listTiktokShopTokens,
  saveTiktokOrderExec,
  setTiktokOrderExecPayment,
} from "@/lib/db";
import { getTiktokOrderDetail, type TiktokOrderSummary } from "@/lib/tiktok";
import { prepareShop } from "@/lib/tiktok-orders";
import {
  NOTIF_TEMPLATE,
  ownerNumber,
  sendTemplateParams,
  sendText,
} from "@/lib/wa";

const EKSEKUSI_URL =
  "https://admin.kustoro2026.com/marketplace/tiktok/eksekusi";

/** Satu baris produk pesanan yang siap dibelikan di Aneka. */
export type AnekaExecItem = {
  tiktok_product_id: string;
  product_name: string;
  /** Nama varian dari pesanan TikTok (mis. "100 ml", "BLACK - S") —
   *  petunjuk utama mencocokkan varian Aneka. */
  sku_name: string;
  qty: number;
  aneka_product_id: string;
  aneka_variant_id: string;
  aneka_product_name: string;
  harga_modal: number;
  subtotal: number;
};

/** Muatan tersimpan di tiktok_order_exec.payload (JSON) — cukup untuk
 *  menjalankan checkout Aneka kapan saja tanpa memanggil API TikTok lagi. */
export type AnekaExecPayload = {
  order_id: string;
  shop_id: string;
  shop_name: string;
  tracking_number: string;
  label_pdf_base64: string;
  items: AnekaExecItem[];
  total_modal: number;
};

/** Dokumen resi resmi hasil cetak (struktur minimal dari tiktok-resi). */
export type AnekaExecOfficial = {
  pdf: Buffer;
  tracking_number: string;
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

/** Gabung baris kembar (produk + varian pesanan sama) menjadi satu baris
 *  dengan qty dijumlah. TikTok sering menulis qty besar sebagai beberapa
 *  baris identik (masing-masing sku_count 1), dan /variant/save Aneka
 *  MENIMPA qty produk yang sama — tanpa penggabungan ini, pesanan qty 2
 *  hanya akan membeli 1. Fungsi murni (tanpa DB) supaya bisa diuji. */
export function mergeExecItems(items: AnekaExecItem[]): AnekaExecItem[] {
  const merged = new Map<string, AnekaExecItem>();
  for (const it of items) {
    const key = `${it.tiktok_product_id}|${it.sku_name}`;
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

/** Cek apakah SEMUA produk pesanan sudah dipetakan ke Aneka (dan ada di
 *  katalog snapshot) — prasyarat eksekusi otomatis. Bila belum, pesanan
 *  tetap diproses jalur lama (kirim resi ke WA). */
export async function checkAnekaExecutable(
  order: TiktokOrderSummary,
): Promise<{ ok: true; items: AnekaExecItem[] } | { ok: false; detail: string }> {
  if (order.items.length === 0) {
    return { ok: false, detail: "Pesanan tanpa item" };
  }
  const items: AnekaExecItem[] = [];
  const missing: string[] = [];
  for (const it of order.items) {
    // TikTok mengembalikan sku_count 0/aneh → jangan menebak qty 1 dan
    // membeli jumlah yang salah — serahkan ke proses manual.
    if (!Number.isFinite(it.sku_count) || it.sku_count <= 0) {
      missing.push(`${it.product_name} (qty ${it.sku_count})`);
      continue;
    }
    const map = await getAnekaProductMap(it.product_id);
    if (!map || map.enabled !== 1 || !map.aneka_product_id) {
      missing.push(it.product_name);
      continue;
    }
    const cat = findAnekaCatalogById(map.aneka_product_id);
    const harga = parseRp(cat?.hargaModal ?? "");
    if (!cat || harga <= 0) {
      missing.push(`${it.product_name} (harga Aneka tidak ditemukan)`);
      continue;
    }
    items.push({
      tiktok_product_id: it.product_id,
      product_name: it.product_name,
      sku_name: it.sku_name ?? "",
      qty: it.sku_count,
      aneka_product_id: map.aneka_product_id,
      aneka_variant_id: map.aneka_variant_id ?? "",
      aneka_product_name: cat.name,
      harga_modal: harga,
      subtotal: harga * it.sku_count,
    });
  }
  if (missing.length > 0) {
    return {
      ok: false,
      detail: `Belum bisa dieksekusi otomatis: ${missing.join(", ")}`,
    };
  }
  return { ok: true, items: mergeExecItems(items) };
}

/** PERSIAPAN: simpan label resmi + rincian produk sebagai antrean eksekusi
 *  "menunggu" dan kirim notif WA berisi tautan Setuju. Idempoten — bila
 *  barisnya sudah menunggu, tidak menyimpan/kirim ulang (kecuali
 *  opts.resendNotice = true, dipakai ketika notif WA percobaan sebelumnya
 *  gagal terkirim). */
export async function prepareAnekaExec(
  shop: { shop_id: string; shop_name: string },
  order: TiktokOrderSummary,
  official: AnekaExecOfficial,
  opts: { resendNotice?: boolean } = {},
): Promise<{ ok: boolean; detail: string }> {
  const existing = await getTiktokOrderExec(order.order_id);
  if (existing?.status === "menunggu" && !opts.resendNotice) {
    return { ok: true, detail: "Sudah menunggu persetujuan" };
  }

  const check = await checkAnekaExecutable(order);
  if (!check.ok) return { ok: false, detail: check.detail };

  const total = check.items.reduce((s, it) => s + it.subtotal, 0);
  const payload: AnekaExecPayload = {
    order_id: order.order_id,
    shop_id: shop.shop_id,
    shop_name: shop.shop_name,
    tracking_number: official.tracking_number,
    label_pdf_base64: official.pdf.toString("base64"),
    items: check.items,
    total_modal: total,
  };

  // Persiapan ulang = antrean baru. Jejak pembayaran percobaan lama
  // DIPERTAHANKAN (aneka_payment_id/aneka_order_id + log) — bahan pengaman
  // anti-dobel bila baris ini dieksekusi lagi.
  await saveTiktokOrderExec({
    order_id: order.order_id,
    shop_id: shop.shop_id,
    status: "menunggu",
    payload: JSON.stringify(payload),
    aneka_payment_id: existing?.aneka_payment_id ?? "",
    aneka_order_id: existing?.aneka_order_id ?? "",
    detail: "",
    executed_at: "",
  });

  const baris = check.items
    .map((it) => `- ${it.qty}x ${it.product_name} (${fmtRp(it.subtotal)})`)
    .join("\n");
  const notice = await sendExecNotice(
    `Pesanan TikTok ${order.order_id} siap dieksekusi ke Aneka (${shop.shop_name}).\n${baris}\nTotal modal ${fmtRp(total)}. No resi ${official.tracking_number}.\nSetuju/batalkan: ${EKSEKUSI_URL}?order=${order.order_id}`,
  );
  if (!notice.startsWith("ok")) {
    return { ok: false, detail: `Tersimpan, tetapi notif WA gagal: ${notice}` };
  }
  return { ok: true, detail: "Menunggu persetujuan" };
}

/** Batal (dari tombol Batalkan atau deteksi pesanan dibatalkan TikTok). */
export async function cancelAnekaExec(orderId: string): Promise<void> {
  const row = await getTiktokOrderExec(orderId);
  if (!row || row.status !== "menunggu") return;
  await appendTiktokOrderExecLog(orderId, "Dibatalkan — tombol Batalkan");
  await saveTiktokOrderExec({
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

/** Pastikan pesanan TikTok belum dibatalkan pembeli — dipanggil TEPAT sebelum
 *  rantai pembayaran supaya saldo Aneka tidak terpakai untuk pesanan yang
 *  batal di tengah antrean. Verifikasi gagal = hentikan (lebih aman menunda
 *  daripada membayar pesanan yang mungkin sudah batal). */
async function tiktokOrderStillActive(
  orderId: string,
): Promise<{ ok: boolean; detail: string }> {
  const shops = await listTiktokShopTokens();
  if (shops.length === 0) {
    return {
      ok: false,
      detail:
        "Tidak ada toko TikTok Shop terotorisasi — status pesanan tidak bisa diverifikasi, eksekusi dihentikan",
    };
  }
  let prepareFail: string | null = null;
  for (const shop of shops) {
    const prep = await prepareShop(shop);
    if (!prep.ok) {
      prepareFail = prep.detail;
      continue;
    }
    const detail = await getTiktokOrderDetail(
      { cipher: prep.cipher, access_token: prep.access_token },
      [orderId],
    );
    if (!detail.ok) {
      return {
        ok: false,
        detail: `Status pesanan TikTok tidak bisa diverifikasi (${detail.detail}) — eksekusi dihentikan demi keamanan, coba lagi nanti`,
      };
    }
    const o = detail.orders.find((d) => d.id === orderId);
    if (!o) {
      return {
        ok: false,
        detail:
          "Pesanan tidak ditemukan lagi di TikTok Shop — eksekusi dihentikan",
      };
    }
    if (o.status === "CANCELLED" || o.status === "CANCELED") {
      return {
        ok: false,
        detail: "Pesanan dibatalkan pembeli — eksekusi dihentikan",
      };
    }
    return { ok: true, detail: o.status };
  }
  return {
    ok: false,
    detail: `Status pesanan TikTok tidak bisa diverifikasi (${prepareFail ?? "kredensial toko gagal"}) — eksekusi dihentikan demi keamanan, coba lagi nanti`,
  };
}

/** Susun baris keranjang Aneka dari item payload: SATU panggilan
 *  variant/save per kombinasi produk+varian — endpoint MENIMPA qty produk
 *  yang sama, jadi baris kembar dijumlahkan dulu di sini (pengaman untuk
 *  payload lama yang disimpan sebelum penggabungan di checkAnekaExecutable,
 *  mis. dua listing TikTok berbeda yang memetakan ke produk Aneka yang
 *  sama). Bila produk Aneka yang sama dipesan dengan DUA varian berbeda,
 *  keranjang Aneka tidak bisa mewakilinya — gagal aman supaya tidak
 *  membeli varian yang salah. Satu slot resi untuk pesanan ini (satu paket
 *  TikTok = satu label) — slot dipasang di baris pertama. */
export function buildAnekaCartItems(
  payloadItems: AnekaExecItem[],
):
  | { ok: true; items: AnekaCartItem[]; totalPcs: number }
  | { ok: false; detail: string } {
  type Grouped = {
    productId: string;
    variantId?: string;
    qty: number;
    label: string;
  };
  const grouped = new Map<string, Grouped>();
  const byProduct = new Map<string, { variantId: string; label: string }[]>();
  for (const it of payloadItems) {
    const variantId = it.aneka_variant_id || undefined;
    const key = `${it.aneka_product_id}|${variantId ?? ""}`;
    const prev = grouped.get(key);
    if (prev) {
      prev.qty += it.qty;
    } else {
      grouped.set(key, {
        productId: it.aneka_product_id,
        variantId,
        qty: it.qty,
        label: it.sku_name || it.product_name,
      });
    }
    const arr = byProduct.get(it.aneka_product_id) ?? [];
    arr.push({
      variantId: variantId ?? "",
      label: it.sku_name || it.product_name,
    });
    byProduct.set(it.aneka_product_id, arr);
  }
  for (const [pid, arr] of byProduct) {
    const variants = [...new Set(arr.map((a) => a.variantId))];
    if (variants.length > 1) {
      return {
        ok: false,
        detail: `Produk Aneka ${pid} dipesan dengan ${variants.length} varian berbeda (${arr
          .map((a) => a.label)
          .join(", ")}) — keranjang Aneka tidak mendukung, proses manual`,
      };
    }
  }
  const items: AnekaCartItem[] = [...grouped.values()].map((g, i) => ({
    productId: g.productId,
    variantId: g.variantId,
    qty: g.qty,
    resiCount: i === 0 ? 1 : 0,
  }));
  const totalPcs = items.reduce((s, it) => s + it.qty, 0);
  return { ok: true, items, totalPcs };
}

/** Nomor resi dari payload baris eksekusi (tahan payload rusak). */
function resiDariPayload(payload: string): string {
  try {
    const p = JSON.parse(payload) as AnekaExecPayload;
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
  return new Date(ms + 7 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
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
 *  daftar /payment-history beberapa halaman pertama. Resi unik per pesanan
 *  TikTok — penanda paling andal bahwa pesanan ini sudah dibelikan. */
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
    if (await anekaPaymentListed(session, id)) {
      return {
        paymentId: id,
        orderCode: "",
        keterangan: `payment ${id} terdaftar di riwayat pembayaran`,
      };
    }
  }
  if (resi && (await anekaPaymentListed(session, resi))) {
    return {
      paymentId: "",
      orderCode: "",
      keterangan: `nomor resi ${resi} sudah muncul di riwayat pembayaran`,
    };
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
  await saveTiktokOrderExec({
    order_id: orderId,
    status: "selesai",
    payload,
    aneka_payment_id: bukti.paymentId,
    aneka_order_id: bukti.orderCode,
    detail: "",
    executed_at: nowUtc,
  });
  await appendTiktokOrderExecLog(
    orderId,
    `${nowUtc} | pemulihan | pembayaran sebelumnya terverifikasi — ${bukti.keterangan}`,
  );
  await sendExecNotice(
    `Eksekusi Aneka BERHASIL untuk pesanan ${orderId} (dipulihkan dari percobaan sebelumnya).\n${bukti.keterangan}${bukti.paymentId ? `\nID pembayaran Aneka: ${bukti.paymentId}` : ""}${bukti.orderCode ? ` (kode pesanan: ${bukti.orderCode})` : ""}\nDetail: https://anekadropship.id/payment-history`,
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
          new Date(cd.ms + COOLDOWN_PAY_MS).toISOString().slice(0, 19).replace("T", " "),
        )} WIB (menunggu riwayat Aneka ter-update).`
      : "";
  await saveTiktokOrderExec({
    order_id: orderId,
    status: "gagal",
    payload,
    detail: `[PERLU CEK MANUAL] ${detail}${tunggu}`,
  });
  await sendExecNotice(
    `Eksekusi Aneka DITAHAN untuk pesanan ${orderId}: ${detail}${tunggu}\nPeriksa riwayat pembayaran Aneka (https://anekadropship.id/payment-history) — bila pesanan ini BELUM terbayar di sana, gunakan tombol "Sudah dicek manual — bayar ulang" di halaman Eksekusi.`,
  );
  return { ok: false, detail: `[PERLU CEK MANUAL] ${detail}${tunggu}` };
}

/** Jalankan rantai checkout Aneka penuh untuk satu antrean "menunggu"
 *  (atau coba ulang baris "gagal"). Sukses → status "selesai" + ID pesanan
 *  Aneka dikirim ke WA; gagal → status "gagal" + keterangan (bisa dicoba
 *  lagi). Sebelum membayar, pengaman anti-dobel memverifikasi riwayat Aneka
 *  (payment_id tersimpan + nomor resi); opts.force melewati pengaman itu —
 *  hanya boleh dipakai setelah pemilik memeriksa riwayat manual. */
export async function executeAnekaOrder(
  orderId: string,
  opts: { force?: boolean } = {},
): Promise<{ ok: boolean; detail: string }> {
  const row = await getTiktokOrderExec(orderId);
  if (!row) return { ok: false, detail: "Pesanan ini belum disiapkan untuk eksekusi" };
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
    await saveTiktokOrderExec({
      order_id: orderId,
      status: "gagal",
      payload: row.payload,
      detail: "Terputus di tengah — dicoba ulang",
    });
  }

  let payload: AnekaExecPayload;
  try {
    payload = JSON.parse(row.payload) as AnekaExecPayload;
  } catch {
    return { ok: false, detail: "Data eksekusi rusak — siapkan ulang pesanan ini" };
  }
  if (!payload.items?.length || !payload.label_pdf_base64) {
    return { ok: false, detail: "Data eksekusi tidak lengkap — siapkan ulang pesanan ini" };
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
        new Date(cooldown.ms + COOLDOWN_PAY_MS).toISOString().slice(0, 19).replace("T", " "),
      )} WIB sebelum memaksa bayar ulang — periksa riwayat Aneka dulu, pembayaran itu mungkin sudah berhasil.`,
    };
  }

  const gagal = async (detail: string) => {
    await saveTiktokOrderExec({
      order_id: orderId,
      status: "gagal",
      payload: row.payload,
      detail,
    });
    await sendExecNotice(
      `Eksekusi Aneka GAGAL untuk pesanan ${orderId}: ${detail}\nCoba lagi: ${EKSEKUSI_URL}?order=${orderId}\nCatatan: periksa dulu riwayat pembayaran Aneka (https://anekadropship.id/payment-history) — pastikan saldo belum terpotong sebelum mencoba lagi.`,
    );
    return { ok: false, detail };
  };

  // 1. Klaim atomik: hanya SATU permintaan Setuju yang boleh menjalankan
  //    rantai — mencegah dua tab/klik bersamaan membayar dua kali. Tiap
  //    langkah berikutnya dicatat ke kolom log baris ini — ditulis langsung
  //    per langkah supaya bila proses serverless terputus (mis. batas
  //    waktu), jejak sampai langkah terakhir tetap tersimpan untuk diagnosa.
  const claimed = await claimTiktokOrderExecRunning(orderId);
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
  await appendTiktokOrderExecLog(
    orderId,
    "---------- percobaan baru ----------",
  );
  const logStep = async (langkah: string, pesan: string) => {
    const t = new Date().toISOString().slice(0, 19).replace("T", " ");
    await appendTiktokOrderExecLog(orderId, `${t} | ${langkah} | ${pesan}`);
  };

  await logStep("mulai", "rantai checkout Aneka dijalankan");

  // 2. Pastikan pesanan TikTok masih aktif (belum dibatalkan pembeli)
  //    SEBELUM memindahkan saldo — mencegah bayar pesanan yang batal.
  const aktif = await tiktokOrderStillActive(orderId);
  if (!aktif.ok) {
    await logStep("cek-pesanan", `GAGAL — ${aktif.detail}`);
    const nowUtc = new Date().toISOString().slice(0, 19).replace("T", " ");
    await saveTiktokOrderExec({
      order_id: orderId,
      status: "batal",
      payload: row.payload,
      detail: aktif.detail,
      executed_at: nowUtc,
    });
    await sendExecNotice(
      `Eksekusi Aneka DIBATALKAN untuk pesanan ${orderId}: ${aktif.detail}`,
    );
    return { ok: false, detail: aktif.detail };
  }
  await logStep("cek-pesanan", `pesanan masih aktif (status ${aktif.detail})`);

  // PENGAMAN ANTI-DOBEL: sebelum membayar, pastikan percobaan-percobaan
  // sebelumnya belum benar-benar membayar pesanan ini di Aneka — cek
  // riwayat berdasarkan payment_id tersimpan/tercatat dan nomor resi
  // (unik per pesanan TikTok). Hanya boleh dilewati lewat tombol paksa
  // eksplisit setelah pemilik memeriksa riwayat manual (opts.force).
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
      await logStep("anti-dobel", "tidak ada jejak pembayaran sebelumnya — lanjut");
    }
  } else {
    await logStep("anti-dobel", "pengaman dilewati atas perintah eksplisit pemilik");
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
  await setTiktokOrderExecPayment(orderId, pay.paymentId);

  // 1b. Tentukan varian produk ber-varian yang belum dipetakan manual
  //     (data varian diambil dari halaman produk Aneka; nama varian pesanan
  //     sku_name jadi petunjuk pencocokan, fallback ke nama produk).
  for (const it of payload.items) {
    if (it.aneka_variant_id) continue;
    const langkah = `varian:${it.aneka_product_id}`;
    await logStep(
      langkah,
      `mencari varian untuk "${it.sku_name || it.product_name}"`,
    );
    const v = await anekaResolveVariant(
      login.session,
      it.aneka_product_id,
      it.sku_name || it.product_name,
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
  //    produk+varian (lihat buildAnekaCartItems — penggabungan qty +
  //    guard gagal-aman untuk varian campur).
  const cart = buildAnekaCartItems(payload.items);
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
      pdf: Buffer.from(payload.label_pdf_base64, "base64"),
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
  await saveTiktokOrderExec({
    order_id: orderId,
    status: "selesai",
    payload: row.payload,
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
    `Eksekusi Aneka BERHASIL untuk pesanan ${orderId}.\nID pembayaran Aneka: ${pay.paymentId}${anekaId ? ` (kode pesanan: ${anekaId})` : ""}\nDetail: https://anekadropship.id/payment-history/finish?payment_id=${pay.paymentId}&status=success`,
  );
  return {
    ok: true,
    detail: `Selesai — ID pembayaran Aneka: ${pay.paymentId}${anekaId ? ` (${anekaId})` : ""}`,
  };
}
