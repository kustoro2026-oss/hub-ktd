// Eksekusi pesanan Blibli → Aneka (Fase 2, SEMI-OTOMATIS). Alur identik
// dengan modul TikTok (aneka-exec.ts) — penyesuaian hanya pada model data
// Blibli:
//
//  1. PERSIAPAN (murah, saat pesanan baru terdeteksi setelah masa tunggu):
//     cek semua produk paket sudah dipetakan ke Aneka → simpan label resmi
//     + rincian produk ke tabel blibli_order_exec (status "menunggu") →
//     kirim notif WA "Setuju" berisi tautan halaman Eksekusi.
//  2. PERSETUJUAN (tombol Setuju di halaman Eksekusi, dipicu pemilik toko):
//     baru DI SINI rantai Aneka dijalankan penuh — login → payment/create →
//     variant/save → token checkout → pembayaran/process (bayar saldo) →
//     verifikasi lewat payment_id dari riwayat — lalu kabari WA.
//
// Rantai Aneka TIDAK dijalankan saat persiapan supaya tidak menumpuk
// pembayaran mangkrak di akun Aneka bila pemilik tidak menyetujui.
//
// Perbedaan dengan TikTok: kunci antrean = packageId (satu paket = satu
// label = satu slot resi Aneka); kunci pemetaan = productSku blibliSku
// (tingkat produk seperti product_id TikTok — satu baris menaungi semua
// varian); petunjuk varian = product.variantName + product.notes (catatan
// pembeli, mis. "ukuran 40") dari detail order item — untuk listing tanpa
// varian, ukuran/warna sering hanya ada di notes.
import { findAnekaCatalogById } from "@/lib/aneka-map";
import {
  anekaCheckoutToken,
  anekaCreatePayment,
  anekaFindOrderByPayment,
  anekaFormatRp,
  anekaKeranjangCheck,
  anekaLogin,
  anekaNamaCocok,
  anekaNamaMuatDiHtml,
  anekaPaymentEvidence,
  anekaProcessPayment,
  anekaResolveVariant,
  anekaVariantSave,
  type AnekaSession,
} from "@/lib/aneka-checkout";
import {
  ambilSaldoAuditAneka,
  auditVarianAneka,
  blockerSaldo,
  ONGKOS_PACKING_AUDIT,
  susunAudit,
  type AuditBlocker,
  type ExecAudit,
} from "@/lib/aneka-audit";
import { buildAnekaCartItems } from "@/lib/aneka-exec";
import { blibliEnv, getBlibliOrderDetail, getBlibliShippingLabel } from "@/lib/blibli";
import {
  appendBlibliOrderExecLog,
  claimAnekaAkun,
  claimBlibliOrderExecPrepared,
  claimBlibliOrderExecRunning,
  getBlibliOrderExec,
  getBlibliProductMap,
  releaseAnekaAkun,
  saveBlibliOrderExec,
  setBlibliOrderExecPayment,
} from "@/lib/db";
import { sendOwnerNotice } from "@/lib/wa";

const EKSEKUSI_URL =
  "https://admin.kustoro2026.com/marketplace/blibli/eksekusi";

/** Satu baris produk paket yang siap dibelikan di Aneka. */
export type BlibliExecItem = {
  /** Kunci pemetaan: productSku Blibli ("KTS-70007-XXXXX"). */
  blibli_sku: string;
  /** Seller SKU baris mass-upload (tampilan/identifikasi saja). */
  seller_sku: string;
  item_name: string;
  /** Nama varian + catatan pembeli (product.notes) dari detail order item
   *  Blibli — petunjuk utama mencocokkan varian Aneka (padanan sku_name
   *  TikTok). Untuk listing tanpa varian, ukuran/warna ada di catatan. */
  variant_name: string;
  /** Kata kunci warna default SKU dari Pemetaan (warna_hint) — digabung
   *  dengan variant_name saat mencocokkan varian Aneka, karena API Blibli
   *  tidak memuat warna pilihan pembeli untuk listing satu varian. */
  warna_hint: string;
  /** Label varian Aneka terpilih hasil audit (nama + warna + ukuran) —
   *  ditampilkan di notif WA & halaman Eksekusi supaya pemilik bisa
   *  memeriksa sebelum menekan Setuju. */
  aneka_variant_label?: string;
  qty: number;
  aneka_product_id: string;
  aneka_variant_id: string;
  aneka_product_name: string;
  harga_modal: number;
  subtotal: number;
};

/** Satu baris produk dari detail order item (bahan checkBlibliExecutable). */
export type BlibliExecSourceItem = {
  blibli_sku: string;
  seller_sku: string;
  item_name: string;
  variant_name: string;
  qty: number;
};

/** Muatan tersimpan di blibli_order_exec.payload (JSON) — cukup untuk
 *  menjalankan checkout Aneka kapan saja tanpa memanggil API Blibli lagi. */
export type BlibliExecPayload = {
  package_id: string;
  /** Order item id anggota paket — dipakai verifikasi "masih aktif"
   *  TEPAT sebelum membayar. */
  order_item_ids: string[];
  store_name: string;
  customer_name: string;
  awb_number: string;
  label_pdf_base64: string;
  items: BlibliExecItem[];
  total_modal: number;
  /** Hasil audit kesiapan (varian/label/saldo) — disimpan saat persiapan
   *  dan diperbarui tombol Periksa Kesiapan; dipakai gerbang tombol
   *  Setuju di halaman Eksekusi. */
  audit?: ExecAudit;
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
 *  teks cadangan. Memakai sendOwnerNotice yang mencatat wamid kiriman
 *  (tabel wa_owner_notices) supaya status "failed" dari webhook Meta bisa
 *  dikirim ulang otomatis — peristiwa 24 Okt 2026: pesan diterima Meta
 *  (HTTP 200) tapi gagal terkirim diam-diam karena window 24 jam habis. */
async function sendExecNotice(msg: string): Promise<string> {
  return sendOwnerNotice(msg);
}

/** Gabung baris kembar (SKU + varian sama) menjadi satu baris dengan qty
 *  dijumlah. Blibli menulis satu order item per baris, tetapi SKU yang sama
 *  bisa muncul lebih dari sekali (listing kembar) — /variant/save Aneka
 *  MENIMPA qty produk yang sama, jadi tanpa penggabungan qty bisa beli
 *  kurang. Fungsi murni (tanpa DB) supaya bisa diuji. */
export function mergeBlibliExecItems(items: BlibliExecItem[]): BlibliExecItem[] {
  const merged = new Map<string, BlibliExecItem>();
  for (const it of items) {
    const key = `${it.blibli_sku}|${it.variant_name}`;
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

/** Kata warna (ID/EN) untuk penjaga konflik dengan warna_hint. */
const WARNA_KONFLIK = [
  "merah", "hitam", "putih", "biru", "hijau", "kuning", "ungu", "orange",
  "oranye", "pink", "abu", "coklat", "cokelat", "cream", "krem", "mocca",
  "beige", "gold", "silver", "red", "black", "white", "blue", "green",
  "yellow", "purple", "gray", "grey", "brown", "lilac", "mint", "peach",
  "navy", "maroon", "tosca",
];

/** Petunjuk varian lengkap = nama varian + catatan pembeli + warna default
 *  SKU (warna_hint dari Pemetaan, bila diisi) — dipakai audit varian dan
 *  pencocokan varian Aneka saat eksekusi. Bila catatan pembeli menyebut
 *  warna yang BEDA dari warna_hint, warna_hint diabaikan — pembeli yang
 *  menang, bukan tebakan default (mencegah salah beli warna). */
function petunjukVarianBlibli(it: BlibliExecItem): string {
  const hint = (it.warna_hint ?? "").trim();
  const pembeli = (it.variant_name ?? "").trim();
  if (!hint) return pembeli;
  const warnaPembeli = WARNA_KONFLIK.filter((c) =>
    new RegExp(`\\b${c}\\b`).test(pembeli.toLowerCase()),
  );
  if (
    warnaPembeli.length > 0 &&
    !warnaPembeli.some((c) => hint.toLowerCase().includes(c))
  ) {
    return pembeli; // konflik warna — abaikan warna_hint
  }
  return [pembeli, hint].filter(Boolean).join(" | ");
}

/** Cek apakah SEMUA item paket sudah dipetakan ke Aneka (dan ada di katalog
 *  snapshot) — prasyarat eksekusi otomatis. Bila belum, paket tetap
 *  diproses jalur lama (kirim label ke WA). */
export async function checkBlibliExecutable(
  items: BlibliExecSourceItem[],
): Promise<{ ok: true; items: BlibliExecItem[] } | { ok: false; detail: string }> {
  if (items.length === 0) {
    return { ok: false, detail: "Paket tanpa item" };
  }
  const out: BlibliExecItem[] = [];
  const missing: string[] = [];
  for (const it of items) {
    // Qty 0/aneh → jangan menebak qty 1 dan membeli jumlah yang salah —
    // serahkan ke proses manual.
    if (!Number.isFinite(it.qty) || it.qty <= 0) {
      missing.push(`${it.item_name} (qty ${it.qty})`);
      continue;
    }
    const map = await getBlibliProductMap(it.blibli_sku);
    if (!map || map.enabled !== 1 || !map.aneka_product_id) {
      missing.push(`${it.item_name} (SKU ${it.blibli_sku})`);
      continue;
    }
    const cat = findAnekaCatalogById(map.aneka_product_id);
    const harga = parseRp(cat?.hargaModal ?? "");
    if (!cat || harga <= 0) {
      missing.push(`${it.item_name} (harga Aneka tidak ditemukan)`);
      continue;
    }
    out.push({
      blibli_sku: it.blibli_sku,
      seller_sku: it.seller_sku,
      item_name: it.item_name,
      variant_name: it.variant_name,
      warna_hint: map.warna_hint ?? "",
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
  return { ok: true, items: mergeBlibliExecItems(out) };
}

/** PERSIAPAN: simpan label resmi + rincian produk sebagai antrean eksekusi
 *  "menunggu" dan kirim notif WA berisi tautan Setuju. Idempoten — bila
 *  barisnya sudah menunggu, tidak menyimpan/kirim ulang (kecuali
 *  opts.resendNotice = true, dipakai ketika notif WA percobaan sebelumnya
 *  gagal terkirim). */
export async function prepareBlibliExec(
  pkg: {
    package_id: string;
    order_item_ids: string[];
    store_name: string;
    customer_name: string;
    items: BlibliExecSourceItem[];
  },
  official: { pdf: Buffer; tracking_number: string },
  opts: { resendNotice?: boolean } = {},
): Promise<{ ok: boolean; detail: string }> {
  const existing = await getBlibliOrderExec(pkg.package_id);
  if (existing?.status === "menunggu" && !opts.resendNotice) {
    return { ok: true, detail: "Sudah menunggu persetujuan" };
  }

  const check = await checkBlibliExecutable(pkg.items);
  if (!check.ok) return { ok: false, detail: check.detail };

  const total = check.items.reduce((s, it) => s + it.subtotal, 0);
  const payload: BlibliExecPayload = {
    package_id: pkg.package_id,
    order_item_ids: pkg.order_item_ids,
    store_name: pkg.store_name,
    customer_name: pkg.customer_name,
    awb_number: official.tracking_number,
    label_pdf_base64: official.pdf.toString("base64"),
    items: check.items,
    total_modal: total,
  };

  // AUDIT KESIAPAN: cocokkan varian + cek saldo + catat blocker label SEBELUM
  // antrean disimpan — peristiwa 28 Okt 2026 (gagal varian di Blibli karena
  // listing tanpa varian sementara produk Aneka punya 15 varian) tidak
  // boleh terulang: masalah harus ketahuan di sini, bukan saat eksekusi.
  // variantId hasil pencocokan disimpan ke payload supaya eksekusi melewati
  // pencarian ulang.
  const auditBlockers: AuditBlocker[] = [];
  const va = await auditVarianAneka(
    payload.items.map((it) => ({
      aneka_product_id: it.aneka_product_id,
      variant_hint: petunjukVarianBlibli(it),
      nama: it.item_name,
      aneka_variant_id: it.aneka_variant_id,
    })),
  );
  va.hasil.forEach((h, i) => {
    if (h.variantId) payload.items[i].aneka_variant_id = h.variantId;
    if (h.label) payload.items[i].aneka_variant_label = h.label;
  });
  auditBlockers.push(...va.blockers);
  if (!official?.pdf?.length) {
    auditBlockers.push({
      kode: "label",
      teks: "Label resmi belum tersedia — Setuju dinonaktifkan sampai label terisi",
    });
  }
  const saldoAudit = await ambilSaldoAuditAneka();
  auditBlockers.push(
    ...blockerSaldo({
      saldo: saldoAudit.saldo,
      segar: saldoAudit.segar,
      kebutuhan: total + ONGKOS_PACKING_AUDIT,
    }),
  );
  payload.audit = susunAudit({
    blockers: auditBlockers,
    saldo: saldoAudit.saldo,
  });

  // Baris BARU disimpan lewat klaim atomik: dua ronde pengecekan yang
  // tumpang tindih (tab admin + ping eksternal + tick webhook berjalan
  // tanpa mutex lintas ronde) sama-sama bisa membaca "belum ada baris" lalu
  // sama-sama menyimpan dan mengirim notif Setuju. Hanya pemenang klaim
  // yang menyimpan dan mengirim — yang kalah melewati kirim. Jalur
  // persiapan ulang (baris lama, mis. notif WA gagal terkirim) tetap
  // memakai upsert — jejak pembayaran lama tidak boleh hilang.
  if (!existing) {
    const claimed = await claimBlibliOrderExecPrepared(
      pkg.package_id,
      blibliEnv().storeCode,
      JSON.stringify(payload),
    );
    if (!claimed) {
      return { ok: true, detail: "Sudah menunggu persetujuan" };
    }
  } else {
    await saveBlibliOrderExec({
      package_id: pkg.package_id,
      store_code: blibliEnv().storeCode,
      status: "menunggu",
      payload: JSON.stringify(payload),
      aneka_payment_id: existing?.aneka_payment_id ?? "",
      aneka_order_id: existing?.aneka_order_id ?? "",
      detail: "",
      executed_at: "",
    });
  }

  const baris = check.items
    .map(
      (it) =>
        `- ${it.qty}x ${it.item_name}${it.variant_name ? ` (${it.variant_name})` : ""}${it.aneka_variant_label ? ` → ${it.aneka_variant_label}` : ""} (${fmtRp(it.subtotal)})`,
    )
    .join("\n");
  const auditTeks =
    payload.audit && payload.audit.blockers.length > 0
      ? `\n\nPERHATIAN — audit kesiapan menemukan blocker (tombol Setuju dinonaktifkan sampai beres):\n${payload.audit.blockers.map((b) => `[${b.kode}] ${b.teks}`).join("\n")}`
      : "";
  const notice = await sendExecNotice(
    `Pesanan Blibli ${pkg.package_id} siap dieksekusi ke Aneka (${pkg.store_name}).\n${baris}\nTotal modal ${fmtRp(total)}. No resi ${official.tracking_number}.\nSetuju/batalkan: ${EKSEKUSI_URL}?order=${pkg.package_id}${auditTeks}`,
  );
  if (!notice.startsWith("ok")) {
    return { ok: false, detail: `Tersimpan, tetapi notif WA gagal: ${notice}` };
  }
  return { ok: true, detail: "Menunggu persetujuan" };
}

/** PERIKSA KESIAPAN manual (tombol di halaman Eksekusi): jalankan ulang
 *  audit penuh — varian Aneka, label resmi (diunduh ulang bila kosong/rusak),
 *  saldo — lalu simpan hasilnya ke payload.audit. Blocker lama yang sudah
 *  beres otomatis hilang karena audit dibangun dari nol. */
export async function auditKesiapanBlibli(
  packageId: string,
): Promise<ExecAudit> {
  const row = await getBlibliOrderExec(packageId);
  if (!row) {
    return susunAudit({
      blockers: [{ kode: "varian", teks: "Antrean eksekusi tidak ditemukan" }],
    });
  }
  let payload: BlibliExecPayload;
  try {
    payload = JSON.parse(row.payload) as BlibliExecPayload;
  } catch {
    return susunAudit({
      blockers: [{ kode: "varian", teks: "Payload eksekusi rusak — perbaiki manual" }],
    });
  }
  const blockers: AuditBlocker[] = [];

  // Varian: cocokkan ulang semua item yang belum punya variant_id; hasil
  // terpilih disimpan ke payload supaya eksekusi melewati pencarian ulang.
  const va = await auditVarianAneka(
    payload.items.map((it) => ({
      aneka_product_id: it.aneka_product_id,
      variant_hint: petunjukVarianBlibli(it),
      nama: it.item_name,
      aneka_variant_id: it.aneka_variant_id,
    })),
  );
  va.hasil.forEach((h, i) => {
    if (h.variantId) payload.items[i].aneka_variant_id = h.variantId;
    if (h.label) payload.items[i].aneka_variant_label = h.label;
  });
  blockers.push(...va.blockers);

  // Label: verifikasi PDF tersimpan valid; kalau kosong/rusak, usahakan
  // unduh ulang lewat API Blibli (shippingLabel).
  const labelValid = (() => {
    if (!payload.label_pdf_base64) return false;
    const buf = Buffer.from(payload.label_pdf_base64, "base64");
    return (
      buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-"
    );
  })();
  if (!labelValid) {
    const lb = await getBlibliShippingLabel(packageId);
    if (lb.ok) {
      payload.label_pdf_base64 = lb.data.shippingLabel;
    } else {
      blockers.push({
        kode: "label",
        teks: `Label resmi belum tersedia (${lb.detail})`,
      });
    }
  }

  // Saldo: blocker hanya bila cache segar dan saldo kurang dari kebutuhan.
  const saldoAudit = await ambilSaldoAuditAneka();
  blockers.push(
    ...blockerSaldo({
      saldo: saldoAudit.saldo,
      segar: saldoAudit.segar,
      kebutuhan: payload.total_modal + ONGKOS_PACKING_AUDIT,
    }),
  );

  const audit = susunAudit({ blockers, saldo: saldoAudit.saldo });
  payload.audit = audit;
  await saveBlibliOrderExec({
    package_id: packageId,
    status: row.status,
    payload: JSON.stringify(payload),
    aneka_payment_id: row.aneka_payment_id ?? "",
    aneka_order_id: row.aneka_order_id ?? "",
    detail: row.detail ?? "",
    executed_at: row.executed_at ?? "",
  });
  await appendBlibliOrderExecLog(
    packageId,
    `[${Date.now()}] | audit | ${
      audit.ok
        ? "ok — semua siap"
        : blockers.map((b) => `${b.kode}: ${b.teks}`).join(" | ")
    }`,
  );
  return audit;
}

/** Batal (dari tombol Batalkan atau deteksi paket dibatalkan pembeli). */
export async function cancelBlibliExec(packageId: string): Promise<void> {
  const row = await getBlibliOrderExec(packageId);
  if (!row || row.status !== "menunggu") return;
  await appendBlibliOrderExecLog(packageId, "Dibatalkan — tombol Batalkan");
  await saveBlibliOrderExec({
    package_id: packageId,
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

/** Pastikan SEMUA item paket belum dibatalkan pembeli — dipanggil TEPAT
 *  sebelum rantai pembayaran supaya saldo Aneka tidak terpakai untuk paket
 *  yang batal di tengah antrean. Verifikasi gagal = hentikan (lebih aman
 *  menunda daripada membayar paket yang mungkin sudah batal).
 *  batal=true hanya untuk pembatalan SUNGGAHAN (dari pihak pembeli) —
 *  kegagalan teknis (kuota API habis, jaringan) batal=false supaya baris
 *  antrean TIDAK ditutup, cukup dicoba lagi nanti. */
async function blibliOrderStillActive(
  orderItemIds: string[],
): Promise<{ ok: boolean; detail: string; awbNumber?: string; batal?: boolean }> {
  if (orderItemIds.length === 0) {
    return {
      ok: false,
      batal: false,
      detail:
        "Daftar item paket kosong — status pesanan tidak bisa diverifikasi, eksekusi dihentikan",
    };
  }
  let gagal: string | null = null;
  let batal = 0;
  let statusTerakhir = "";
  // AWB riil dari detail (shipment.airwayBill) — untuk paket PICKUP baru
  // tersedia setelah fulfill; dipakai sebagai pengganti payload.awb_number
  // yang mungkin kosong (diambil dari daftar SEBELUM fulfill).
  let awbNumber = "";
  for (const id of orderItemIds) {
    const d = await getBlibliOrderDetail(id);
    if (!d.ok) {
      gagal = d.detail;
      continue;
    }
    const st = String(d.data.status ?? "");
    if (st === "X" || /cancel/i.test(st)) {
      batal++;
    } else {
      statusTerakhir = st;
    }
    if (!awbNumber) {
      const shipment = d.data.shipment as
        | { airwayBill?: { number?: string | number } }
        | undefined;
      awbNumber = String(shipment?.airwayBill?.number ?? "").trim();
    }
  }
  if (gagal) {
    // Bila penyebabnya kuota habis (LIMIT_EXCEEDED), sertakan perkiraan
    // waktu WIB kapan boleh dicoba lagi — pesan API memuat detik tersisa.
    const tunggu = /Try again after (\d+) seconds/.exec(gagal);
    const petunjuk = tunggu
      ? `\nKira-kira bisa dicoba lagi pukul ${utcKeWibJam(
          new Date(Date.now() + Number(tunggu[1]) * 1000)
            .toISOString()
            .slice(0, 19)
            .replace("T", " "),
        )} WIB.`
      : "";
    return {
      ok: false,
      batal: false,
      detail: `Status pesanan Blibli tidak bisa diverifikasi (${gagal}) — eksekusi dihentikan demi keamanan, coba lagi nanti${petunjuk}`,
    };
  }
  if (batal === orderItemIds.length) {
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
  return { ok: true, detail: statusTerakhir || "aktif", awbNumber };
}

/** Nomor resi dari payload baris eksekusi (tahan payload rusak). */
function resiDariPayload(payload: string): string {
  try {
    const p = JSON.parse(payload) as BlibliExecPayload;
    return p.awb_number ?? "";
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

/** Bukti paket SUDAH terbayar di Aneka (ditemukan lewat riwayat). */
type BuktiTerbayar = {
  paymentId: string;
  orderCode: string;
  keterangan: string;
};

/** Cari bukti paket ini SUDAH terbayar di Aneka — dan terbayar untuk ISI
 *  paket INI, bukan sekadar payment dengan id sama. Peristiwa 28 Okt 2026:
 *  payment 243290 (berisi produk TikTok) dianggap bukti pembayaran paket
 *  Blibli karena kode ORDER memuat payment_id — padahal isinya tidak ada
 *  sandalnya. Sejak itu bukti wajib lolos verifikasi ISI: semua nama produk
 *  harapan muncul di halaman finish (token ≥60%) ATAU total rupiahnya cocok.
 *  Resi unik per paket — penanda paling andal, tetap dipakai terakhir. */
async function cariBuktiTerbayar(
  session: AnekaSession,
  anekaPaymentId: string,
  log: string,
  resi: string,
  harapan: string[],
  totalHarapan: number,
  catat?: (teks: string) => void,
): Promise<BuktiTerbayar | null> {
  const kandidat = new Set<string>();
  if (anekaPaymentId) kandidat.add(anekaPaymentId);
  for (const m of log.matchAll(/payment_id (\d+)/g)) kandidat.add(m[1]);

  const isiOke = (html: string): boolean => {
    const namaOke =
      harapan.length > 0 && harapan.every((h) => anekaNamaMuatDiHtml(h, html));
    const totalOke =
      totalHarapan > 0 && html.includes(anekaFormatRp(totalHarapan));
    return namaOke || totalOke;
  };

  for (const id of kandidat) {
    const found = await anekaFindOrderByPayment(session, id);
    if (
      found.ok &&
      found.orderCode &&
      new RegExp(`ORDER-${id}-\\d{6,}`).test(found.orderCode)
    ) {
      if (isiOke(found.html)) {
        return {
          paymentId: id,
          orderCode: found.orderCode,
          keterangan: `kode pesanan ${found.orderCode} memuat payment ${id} dan isinya cocok dengan paket ini`,
        };
      }
      catat?.(
        `payment ${id} punya kode ORDER ${found.orderCode} tetapi ISINYA bukan paket ini — dilewati`,
      );
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

/** Nama produk harapan + total rupiah dari payload tersimpan — bahan
 *  verifikasi ISI bukti pembayaran (halaman finish Aneka). */
function harapanDariPayload(payloadStr: string): {
  nama: string[];
  total: number;
} {
  try {
    const p = JSON.parse(payloadStr) as BlibliExecPayload;
    return {
      nama: (p.items ?? [])
        .map((it) => (it.aneka_product_name || it.item_name).trim())
        .filter(Boolean),
      total: p.total_modal + ONGKOS_PACKING_AUDIT,
    };
  } catch {
    return { nama: [], total: 0 };
  }
}

/** Tandai baris selesai dari bukti pembayaran sebelumnya (tanpa membayar
 *  ulang) + kabari WA. */
async function pulihkanSelesai(
  packageId: string,
  payload: string,
  bukti: BuktiTerbayar,
): Promise<{ ok: boolean; detail: string }> {
  await releaseAnekaAkun(`blibli:${packageId}`);
  const nowUtc = new Date().toISOString().slice(0, 19).replace("T", " ");
  await saveBlibliOrderExec({
    package_id: packageId,
    status: "selesai",
    payload,
    aneka_payment_id: bukti.paymentId,
    aneka_order_id: bukti.orderCode,
    detail: "",
    executed_at: nowUtc,
  });
  await appendBlibliOrderExecLog(
    packageId,
    `${nowUtc} | pemulihan | pembayaran sebelumnya terverifikasi — ${bukti.keterangan}`,
  );
  await sendExecNotice(
    `Eksekusi Aneka BERHASIL untuk paket Blibli ${packageId} (dipulihkan dari percobaan sebelumnya).\n${bukti.keterangan}${bukti.paymentId ? `\nID pembayaran Aneka: ${bukti.paymentId}` : ""}${bukti.orderCode ? ` (kode pesanan: ${bukti.orderCode})` : ""}\nDetail: https://anekadropship.id/payment-history`,
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
  packageId: string,
  payload: string,
  log: string,
  detail: string,
): Promise<{ ok: false; detail: string }> {
  await releaseAnekaAkun(`blibli:${packageId}`);
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
  await saveBlibliOrderExec({
    package_id: packageId,
    status: "gagal",
    payload,
    detail: `[PERLU CEK MANUAL] ${detail}${tunggu}`,
  });
  await sendExecNotice(
    `Eksekusi Aneka DITAHAN untuk paket Blibli ${packageId}: ${detail}${tunggu}\nPeriksa riwayat pembayaran Aneka (https://anekadropship.id/payment-history) — bila paket ini BELUM terbayar di sana, gunakan tombol "Sudah dicek manual — bayar ulang" di halaman Eksekusi.`,
  );
  return { ok: false, detail: `[PERLU CEK MANUAL] ${detail}${tunggu}` };
}

/** Jalankan rantai checkout Aneka penuh untuk satu antrean "menunggu"
 *  (atau coba ulang baris "gagal"). Sukses → status "selesai" + ID pesanan
 *  Aneka dikirim ke WA; gagal → status "gagal" + keterangan (bisa dicoba
 *  lagi). Sebelum membayar, pengaman anti-dobel memverifikasi riwayat Aneka
 *  (payment_id tersimpan + nomor resi); opts.force melewati pengaman itu —
 *  hanya boleh dipakai setelah pemilik memeriksa riwayat manual. */
export async function executeBlibliOrder(
  packageId: string,
  opts: { force?: boolean } = {},
): Promise<{ ok: boolean; detail: string }> {
  const row = await getBlibliOrderExec(packageId);
  if (!row)
    return { ok: false, detail: "Paket ini belum disiapkan untuk eksekusi" };
  if (row.status === "selesai") {
    return { ok: false, detail: "Paket ini sudah dieksekusi" };
  }
  if (row.status === "batal") {
    return { ok: false, detail: "Paket ini dibatalkan" };
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
          packageId,
          row.payload,
          row.log,
          `percobaan sebelumnya sampai langkah pembayaran, tetapi login Aneka untuk verifikasi gagal (${login.detail})`,
        );
      }
      const hp = harapanDariPayload(row.payload);
      const bukti = await cariBuktiTerbayar(
        login.session,
        row.aneka_payment_id,
        row.log,
        resiDariPayload(row.payload),
        hp.nama,
        hp.total,
        (t) => appendBlibliOrderExecLog(packageId, `${new Date().toISOString().slice(0, 19).replace("T", " ")} | anti-dobel | ${t}`),
      );
      if (bukti) return pulihkanSelesai(packageId, row.payload, bukti);
      return blokirCekManual(
        packageId,
        row.payload,
        row.log,
        stBayar === "berhasil"
          ? "percobaan sebelumnya mencatat pembayaran berhasil tetapi belum terbukti di riwayat — kemungkinan riwayat Aneka belum ter-update"
          : "percobaan sebelumnya terputus di langkah pembayaran dan belum terbukti belum terbayar",
      );
    }
    // Terputus SEBELUM pembayaran — aman diulang: kembalikan ke "gagal"
    // supaya klaim atomik di bawah bisa mengambil alih.
    await saveBlibliOrderExec({
      package_id: packageId,
      status: "gagal",
      payload: row.payload,
      detail: "Terputus di tengah — dicoba ulang",
    });
  }

  let payload: BlibliExecPayload;
  try {
    payload = JSON.parse(row.payload) as BlibliExecPayload;
  } catch {
    return {
      ok: false,
      detail: "Data eksekusi rusak — siapkan ulang paket ini",
    };
  }
  if (!payload.items?.length || !payload.label_pdf_base64) {
    return {
      ok: false,
      detail: "Data eksekusi tidak lengkap — siapkan ulang paket ini",
    };
  }

  // GERBANG AUDIT KESIAPAN: baris yang auditnya mencatat blocker (varian
  // tidak cocok / label belum tersedia / saldo kurang) DITOLAK — peristiwa
  // 28 Okt 2026 (gagal varian di Blibli) tidak boleh terulang lewat Setuju
  // biasa. Force (bayar ulang setelah cek manual) tetap melewati gerbang
  // ini karena tujuannya berbeda.
  if (!opts.force && payload.audit && !payload.audit.ok) {
    return {
      ok: false,
      detail: `Audit kesiapan menemukan blocker: ${payload.audit.blockers
        .map((b) => `[${b.kode}] ${b.teks}`)
        .join(" — ")}`,
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

  const akunPemilik = `blibli:${packageId}`;

  const gagal = async (detail: string) => {
    await releaseAnekaAkun(akunPemilik);
    await saveBlibliOrderExec({
      package_id: packageId,
      status: "gagal",
      payload: row.payload,
      detail,
    });
    await sendExecNotice(
      `Eksekusi Aneka GAGAL untuk paket Blibli ${packageId}: ${detail}\nCoba lagi: ${EKSEKUSI_URL}?order=${packageId}\nCatatan: periksa dulu riwayat pembayaran Aneka (https://anekadropship.id/payment-history) — pastikan saldo belum terpotong sebelum mencoba lagi.`,
    );
    return { ok: false, detail };
  };

  // 1. Klaim atomik: hanya SATU permintaan Setuju yang boleh menjalankan
  //    rantai — mencegah dua tab/klik bersamaan membayar dua kali. Tiap
  //    langkah berikutnya dicatat ke kolom log baris ini — ditulis langsung
  //    per langkah supaya bila proses serverless terputus (mis. batas
  //    waktu), jejak sampai langkah terakhir tetap tersimpan untuk diagnosa.
  const claimed = await claimBlibliOrderExecRunning(packageId);
  if (!claimed) {
    return {
      ok: false,
      detail:
        "Paket ini sedang dieksekusi atau sudah diproses — muat ulang halaman",
    };
  }
  // Jejak log TIDAK dihapus antar percobaan — log lama adalah bahan
  // pengaman anti-dobel (statusPembayaranSebelumnya + payment_id tercatat).
  // Beri pemisah supaya jejak tiap percobaan tetap mudah dibaca.
  await appendBlibliOrderExecLog(
    packageId,
    "---------- percobaan baru ----------",
  );
  const logStep = async (langkah: string, pesan: string) => {
    const t = new Date().toISOString().slice(0, 19).replace("T", " ");
    await appendBlibliOrderExecLog(packageId, `${t} | ${langkah} | ${pesan}`);
  };

  await logStep("mulai", "rantai checkout Aneka dijalankan");

  // KUNCI AKUN GLOBAL: satu akun Aneka = satu rantai checkout pada satu
  // waktu — payment/create Aneka MEMANFAATKAN ULANG payment terbuka akun
  // (terbukti 28 Okt 2026: eksekusi Blibli dan TikTok berbagi payment
  // 243290 dan berakhir dengan pembayaran yang salah di-claim). Kunci ini
  // menyelaraskan eksekusi lintas marketplace supaya rantai checkout tidak
  // pernah tumpang tindih.
  const akunClaimed = await claimAnekaAkun(akunPemilik);
  if (!akunClaimed) {
    await logStep(
      "kunci-akun",
      "GAGAL — akun Aneka sedang dipakai eksekusi lain",
    );
    return gagal(
      "Akun Aneka sedang dipakai eksekusi lain — tunggu sebentar lalu coba lagi",
    );
  }
  await logStep("kunci-akun", "akun Aneka dikunci untuk rantai ini");

  // 2. Pastikan item paket masih aktif (belum dibatalkan pembeli) SEBELUM
  //    memindahkan saldo — mencegah bayar paket yang batal.
  const aktif = await blibliOrderStillActive(payload.order_item_ids);
  if (!aktif.ok) {
    await logStep("cek-pesanan", `GAGAL — ${aktif.detail}`);
    const nowUtc = new Date().toISOString().slice(0, 19).replace("T", " ");
    if (!aktif.batal) {
      // Kegagalan TEKNIS (kuota API habis, jaringan, dll.) — bukan
      // pembatalan. Baris jangan ditutup: kembalikan ke "gagal" supaya
      // pemilik bisa menekan Setuju lagi saat gangguan lewat.
      await saveBlibliOrderExec({
        package_id: packageId,
        status: "gagal",
        payload: row.payload,
        detail: aktif.detail,
      });
      await sendExecNotice(
        `Eksekusi Aneka DITUNDA untuk paket Blibli ${packageId}: ${aktif.detail}\nCoba lagi: ${EKSEKUSI_URL}?order=${packageId}`,
      );
      await releaseAnekaAkun(akunPemilik);
      return { ok: false, detail: aktif.detail };
    }
    await saveBlibliOrderExec({
      package_id: packageId,
      status: "batal",
      payload: row.payload,
      detail: aktif.detail,
      executed_at: nowUtc,
    });
    await sendExecNotice(
      `Eksekusi Aneka DIBATALKAN untuk paket Blibli ${packageId}: ${aktif.detail}`,
    );
    await releaseAnekaAkun(akunPemilik);
    return { ok: false, detail: aktif.detail };
  }
  await logStep("cek-pesanan", `pesanan masih aktif (status ${aktif.detail})`);

  // Nomor resi paket PICKUP baru tersedia setelah fulfill — payload.awb_number
  // bisa kosong (diambil dari daftar sebelum fulfill). Pakai AWB terbaru dari
  // detail dan simpan ke payload supaya langkah pembayaran, anti-dobel, dan
  // percobaan berikutnya memakai nomor yang benar.
  const awbFinal = (payload.awb_number ?? "").trim() || (aktif.awbNumber ?? "");
  if (awbFinal && awbFinal !== (payload.awb_number ?? "").trim()) {
    payload = { ...payload, awb_number: awbFinal };
    await saveBlibliOrderExec({
      package_id: packageId,
      status: "berjalan",
      payload: JSON.stringify(payload),
    });
    await logStep("cek-pesanan", `nomor resi diambil dari detail Blibli — ${awbFinal}`);
  }

  // PENGAMAN ANTI-DOBEL: sebelum membayar, pastikan percobaan-percobaan
  // sebelumnya belum benar-benar membayar paket ini di Aneka — cek riwayat
  // berdasarkan payment_id tersimpan/tercatat dan nomor resi (unik per
  // paket Blibli). Hanya boleh dilewati lewat tombol paksa eksplisit
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
            packageId,
            row.payload,
            row.log,
            `ada jejak pembayaran sebelumnya tetapi login Aneka untuk verifikasi gagal (${loginG.detail})`,
          );
        }
      } else {
        login = { ok: true as const, session: loginG.session };
        const hp = harapanDariPayload(row.payload);
        const bukti = await cariBuktiTerbayar(
          loginG.session,
          row.aneka_payment_id,
          row.log,
          awbFinal,
          hp.nama,
          hp.total,
          (t) => logStep("anti-dobel", t),
        );
        if (bukti) {
          await logStep(
            "anti-dobel",
            `terbukti sudah terbayar — ${bukti.keterangan}`,
          );
          return pulihkanSelesai(packageId, row.payload, bukti);
        }
        if (stBayar === "berhasil" || stBayar === "ambigu") {
          await logStep(
            "anti-dobel",
            `DITAHAN — ${stBayar} tetapi belum terbukti di riwayat`,
          );
          return blokirCekManual(
            packageId,
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
  await setBlibliOrderExecPayment(packageId, pay.paymentId);

  // PENGAMAN KERANJANG (lapis 2): payment/create bisa saja mengembalikan
  // payment lama yang masih berisi barang eksekusi lain (Aneka memakai
  // ulang payment terbuka). Keranjang wajib kosong ATAU hanya berisi barang
  // paket ini dari percobaan sebelumnya — bila ada nama produk asing,
  // jangan menumpang: hentikan.
  const keranjang = await anekaKeranjangCheck(login.session, pay.paymentId);
  if (!keranjang.ok) {
    await logStep("cek-keranjang", `GAGAL — ${keranjang.detail}`);
    return gagal(
      `Keranjang payment ${pay.paymentId} tidak terbaca (${keranjang.detail}) — coba lagi`,
    );
  }
  const namaHarapan = payload.items
    .map((it) => (it.aneka_product_name || it.item_name).trim())
    .filter(Boolean);
  const asing = keranjang.nama.filter(
    (n) => !namaHarapan.some((h) => anekaNamaCocok(n, h)),
  );
  if (asing.length > 0) {
    await logStep(
      "cek-keranjang",
      `DITOLAK — payment ${pay.paymentId} berisi barang eksekusi lain: ${asing
        .slice(0, 3)
        .join("; ")}`,
    );
    return gagal(
      `Payment ${pay.paymentId} adalah payment lama yang masih berisi barang pesanan lain (${asing[0]}) — periksa https://anekadropship.id/payment-history lalu coba lagi`,
    );
  }
  await logStep(
    "cek-keranjang",
    keranjang.jumlah > 0
      ? `payment ${pay.paymentId} sudah berisi barang paket ini (percobaan sebelumnya) — lanjut`
      : `payment ${pay.paymentId} kosong — lanjut`,
  );

  // 1b. Tentukan varian produk ber-varian yang belum dipetakan manual
  //     (data varian diambil dari halaman produk Aneka; variant_name dari
  //     detail order item jadi petunjuk pencocokan, fallback ke nama item).
  for (const it of payload.items) {
    if (it.aneka_variant_id) continue;
    const langkah = `varian:${it.aneka_product_id}`;
    await logStep(
      langkah,
      `mencari varian untuk "${petunjukVarianBlibli(it) || it.item_name}"`,
    );
    const v = await anekaResolveVariant(
      login.session,
      it.aneka_product_id,
      petunjukVarianBlibli(it) || it.item_name,
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
      tiktok_product_id: it.blibli_sku,
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
      number: awbFinal,
      pdf: Buffer.from(payload.label_pdf_base64, "base64"),
    },
  );
  if (!process.ok) {
    await logStep("pembayaran/process", `GAGAL — ${process.detail}`);
    return gagal(process.detail);
  }
  await logStep(
    "pembayaran/process",
    `berhasil — bayar saldo wallet + upload label ${awbFinal}`,
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
  await saveBlibliOrderExec({
    package_id: packageId,
    status: "selesai",
    // Payload terkini (varian ter-resolve + awb_number yang diperkaya dari
    // detail) — bukan payload awal, supaya baris selesai menampilkan resi
    // dan varian yang benar-benar dipakai.
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
    `Eksekusi Aneka BERHASIL untuk paket Blibli ${packageId}.\nID pembayaran Aneka: ${pay.paymentId}${anekaId ? ` (kode pesanan: ${anekaId})` : ""}\nDetail: https://anekadropship.id/payment-history/finish?payment_id=${pay.paymentId}&status=success`,
  );
  await releaseAnekaAkun(akunPemilik);
  return {
    ok: true,
    detail: `Selesai — ID pembayaran Aneka: ${pay.paymentId}${anekaId ? ` (${anekaId})` : ""}`,
  };
}
