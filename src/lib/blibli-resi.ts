// Deteksi pesanan Blibli baru → cetak label resmi + kirim ke WhatsApp
// pemilik toko (085171157938 / env OWNER_WA_NUMBER), atau siapkan eksekusi
// semi-otomatis ke Aneka bila semua produk paket sudah dipetakan. Alur
// identik dengan modul TikTok (tiktok-resi.ts):
//
//  1. Tarik paket pesanan terbaru (7 hari) dan bandingkan per order item
//     dengan tabel blibli_order_seen.
//  2. Mode baseline: bila tabel masih kosong (pertama kali), semua item lama
//     hanya DITANDAI tanpa kirim resi — mencegah banjir PDF sekaligus.
//  3. Item dibatalkan (X): kabari admin lewat WA sekali, tandai "batal: ..."
//     — resi tidak pernah dikirim untuk item batal.
//  4. Item baru (FP = Fraud Pass): ditahan NEW_ORDER_WAIT_MS (default 15
//     menit) sebelum diproses — memberi kesempatan pembeli membatalkan.
//     Selama menunggu statusnya "menunggu:<epoch_ms>"; kalau dibatalkan di
//     tengah tunggu, notifikasi pembatalan menggantikan kirim resi.
//  5. Setelah masa tunggu (dipicu item FP pertama paket): detail semua item
//     diambil (qty + variantName resmi) → bila SEMUA terpetakan ke Aneka,
//     paket disiapkan sebagai antrean Setuju; bila tidak, label resmi dikirim
//     ke WA admin. Satu paket = SATU proses (label + slot resi), item
//     anggota lain ikut ditandai.
//  6. Label resmi = API downloadShippingLabelV2 (PDF base64). Paket yang
//     belum dibuat Blibli (flag packageCreated=false) dibuat dulu lewat
//     Create Package V1 — tanpa paket label tidak bisa diunduh. Fulfill
//     hanya untuk PICKUP (jadwalkan kurir); DROPSHIP tidak perlu fulfill —
//     setelah paket diserahkan ke kurir, 3PL memperbarui status otomatis.
//  7. Kirim gagal ditandai + hitungan percobaan naik — dicoba ulang pada
//     pengecekan berikutnya sampai batas, lalu dihentikan (label tetap bisa
//     dibuka manual dari halaman Pesanan).
import {
  countSeenBlibliOrders,
  getBlibliOrderExec,
  listSeenBlibliOrders,
  markBlibliOrderSeen,
  recordBlibliOrderFailure,
  touchBlibliOrderSeen,
  workerHeartbeatFresh,
} from "@/lib/db";
import {
  cancelBlibliExec,
  checkBlibliExecutable,
  prepareBlibliExec,
  type BlibliExecSourceItem,
} from "@/lib/blibli-exec";
import {
  blibliEnv,
  blibliProductSku,
  createBlibliPackage,
  fulfillBlibliPackage,
  getBlibliOrderDetail,
  getBlibliShippingLabel,
  listBlibliOrders,
  type BlibliItemStatus,
  type BlibliOrderItem,
  type BlibliOrderPackage,
} from "@/lib/blibli";
import { BLIBLI_STORE_NAME } from "@/lib/blibli-orders";
import {
  NOTIF_TEMPLATE,
  ownerNumber,
  sendDocument,
  sendDocumentTemplate,
  sendTemplateParams,
  sendText,
} from "@/lib/wa";

/** Batas percobaan kirim ulang untuk item yang resinya gagal terkirim.
 *  Dengan jeda RETRY_COOLDOWN_MS antar percobaan, batas ini mencakup
 *  sekitar 6 jam pemulihan (label belum tersedia, situs sibuk, dll.). */
const MAX_SEND_ATTEMPTS = 12;

/** Jeda minimal antar percobaan ulang item yang gagal. Penting karena
 *  pengecekan bisa berjalan tiap menit (tab admin terbuka) — tanpa jeda,
 *  kegagalan sementara menghabiskan seluruh kuota percobaan dalam beberapa
 *  menit lalu item diam selamanya. */
const RETRY_COOLDOWN_MS = 30 * 60 * 1000;

/** Lama item baru ditahan sebelum diproses (env BLIBLI_RESI_DELAY_MINUTES,
 *  default 15 menit) — memberi kesempatan pembeli membatalkan supaya label
 *  tidak dicetak/dikirim percuma. */
const NEW_ORDER_WAIT_MS =
  (Number(process.env.BLIBLI_RESI_DELAY_MINUTES) || 15) * 60 * 1000;

/** Jeda minimal antar cek "paket dikembalikan" untuk satu item (penanda
 *  waktu cek disimpan di last_attempt_at). Kuota API Blibli hanya
 *  100 request/30 menit — tanpa jeda, tick tiap menit akan menghabiskannya. */
const RETURN_CHECK_INTERVAL_MS = 30 * 60 * 1000;

/** Batas panggilan detail (cek retur) per ronde — kuota API Blibli
 *  100 req/30 menit dipakai bersama fitur lain (eksekusi, produk, probe);
 *  cap ini menjaga sweep retur tidak menghabiskan jatah satu tick.
 *  Item yang terlewat karena cap tetap dicek ronde berikutnya
 *  (last_attempt_at tidak disentuh bila belum sempat dicek). */
const MAX_RETURN_CHECKS_PER_TICK = 5;

/** Status item yang relevan dengan pipeline (tanpa C/D/OS/BP/CX — bukan
 *  urusan penjual aktif, atau sudah ditangani). */
const CHECK_STATUSES: BlibliItemStatus[] = [
  "FP",
  "PU",
  "PF",
  "CR",
  "CX",
  "BP",
  "D",
  "X",
];

const PESANAN_URL = "https://admin.kustoro2026.com/marketplace/blibli/pesanan";

/** UTC "YYYY-MM-DD HH:MM:SS" → epoch ms. */
function parseUtcMs(s: string): number {
  const t = Date.parse(s.replace(" ", "T") + "Z");
  return Number.isFinite(t) ? t : 0;
}

export type BlibliResiCheckResult = {
  ok: boolean;
  baseline?: boolean;
  newOrders?: number;
  sent?: string[];
  errors?: string[];
  detail?: string;
};

/** Dokumen label resmi satu paket — hasil "Cetak Resi" Blibli. */
export type BlibliOfficialResiResult =
  | {
      ok: true;
      pdf: Buffer;
      tracking_number: string;
      /** true = pengiriman baru saja dikonfirmasi (fulfill) otomatis
       *  karena paket masih berstatus Pesanan Baru (FP) — hanya untuk
       *  pengiriman PICKUP (kurir dijadwalkan menjemput). */
      arranged: boolean;
      /** Id paket final yang dipakai label — berbeda dari id masukan
       *  bila paketnya baru saja dibuat lewat Create Package V1. */
      packageId: string;
    }
  | { ok: false; detail: string; butuhAwb?: boolean };

/** Info paket yang menentukan strategi cetak label (dari item anggotanya). */
export type BlibliPackageInfo = {
  itemStatus?: BlibliItemStatus;
  awbNumber?: string;
  cashlessHandover?: boolean;
  sellerDeliveryType?: "PICKUP" | "DROPSHIP";
  /** false = paket belum dibuat Blibli (flag packageCreated) — pesanan FP
   *  dropship tidak dibuatkan paket otomatis, penjual/integrator yang
   *  memanggil Create Package V1 dulu sebelum label bisa diunduh. */
  packageCreated?: boolean;
  /** Order item id anggota paket — bahan Create Package V1. */
  orderItemIds?: string[];
};

/** Cari satu paket di pesanan terbaru (beberapa halaman pertama) — dipakai
 *  tombol manual (Kirim Resi / Atur Pengiriman) yang hanya tahu packageId. */
async function findBlibliPackage(
  packageId: string,
): Promise<{ ok: true; pkg: BlibliOrderPackage } | { ok: false; detail: string }> {
  for (let page = 0; page < 4; page++) {
    const r = await listBlibliOrders({
      orderItemStatuses: CHECK_STATUSES,
      sorting: { by: "statusFPUpdatedTimestamp", direction: "DESC" },
      paging: { page, size: 50 },
    });
    if (!r.ok) return { ok: false, detail: r.detail };
    const pkg = r.data.packages.find((p) => p.packageId === packageId);
    if (pkg) return { ok: true, pkg };
    if (r.data.packages.length === 0) break;
    if (r.data.totalRecord <= (page + 1) * 50) break;
  }
  return { ok: false, detail: "Paket tidak ditemukan di pesanan terbaru" };
}

/** Ambil label RESMI Blibli untuk satu paket. Alur yang benar (terbukti
 *  25 Okt 2026 lewat pesanan dropship cashless pertama):
 *
 *  1. Pesanan FP yang paketnya BELUM dibuat (flag packageCreated=false)
 *     harus dibuat dulu lewat Create Package V1 — Blibli TIDAK membuatkan
 *     paket otomatis; label hanya bisa diunduh setelah paket ada
 *     (ERR-PA422065 sebelum itu), dan AWB cashless (IDB…) baru terbit
 *     saat paket dibuat.
 *  2. Fulfill via API (padanan "Atur Pengiriman" TikTok) HANYA untuk
 *     PICKUP — menjadwalkan kurir menjemput. Untuk DROPSHIP, API menolak
 *     fulfill di luar jendela 12 jam sebelum autocancel (ERR-PA422056):
 *     setelah paket diserahkan ke kurir, 3PL memperbarui status otomatis
 *     (PU → CX → D). Tombol "Atur Pengiriman" manual tetap tersedia
 *     untuk jendela 12 jam itu bila diperlukan. */
export async function getOfficialResiForPackage(
  packageId: string,
  info: BlibliPackageInfo,
): Promise<BlibliOfficialResiResult> {
  const isFP = info.itemStatus === "FP";
  let finalPackageId = packageId;
  let arranged = false;
  let fulfillErr = "";

  // 1. Buat paket dulu bila belum dibuat Blibli. Bila pesanan sudah
  //    digabung sebagian (item batal), hanya item aktif yang dibawa —
  //    paket hanya boleh berisi item eligibel (Create Package V1).
  if (isFP && !info.packageCreated && (info.orderItemIds?.length ?? 0) > 0) {
    const created = await createBlibliPackage(info.orderItemIds!);
    if (!created.ok) {
      return {
        ok: false,
        detail: `Gagal buat paket pesanan: ${created.detail}`,
      };
    }
    finalPackageId = created.data.packageId;
  }

  if (isFP) {
    if (info.sellerDeliveryType === "PICKUP") {
      // PICKUP: konfirmasi pengiriman = jadwalkan kurir menjemput.
      // Nomor resi baru muncul SETELAH fulfill (shipment.airwayBill).
      const r = await fulfillBlibliPackage(finalPackageId, info.awbNumber);
      arranged = r.ok;
      fulfillErr = r.ok ? "" : r.detail;
      // Gagal fulfill (mis. sudah ter-fulfill sebelumnya) tidak
      // menghentikan cetak label — label tetap dicoba di bawah.
    } else {
      // DROPSHIP: tanpa fulfill otomatis (lihat komentar fungsi). Tetap
      // waspada paket non-cashless tanpa AWB — wajib diisi kurir.
      const butuhAwb = !info.cashlessHandover && !info.awbNumber;
      if (butuhAwb) {
        return {
          ok: false,
          detail: "Nomor AWB belum tersedia untuk paket ini",
          butuhAwb: true,
        };
      }
    }
  }

  const label = await getBlibliShippingLabel(finalPackageId);
  if (!label.ok) {
    const extra =
      isFP && !arranged && info.sellerDeliveryType === "PICKUP"
        ? ` — dan gagal mengatur pengiriman: ${fulfillErr}`
        : "";
    return { ok: false, detail: label.detail + extra };
  }

  try {
    const pdf = Buffer.from(label.data.shippingLabel, "base64");
    return {
      ok: true,
      pdf,
      tracking_number: info.awbNumber ?? "",
      arranged,
      packageId: finalPackageId,
    };
  } catch {
    return { ok: false, detail: "Label pengiriman rusak (bukan PDF base64 valid)" };
  }
}

/** Keterangan singkat isi PDF resi untuk caption WA/riwayat. */
function resiDocsLabel(r: { arranged: boolean }): string {
  return `label resmi${r.arranged ? " + pengiriman diatur" : ""}`;
}

/** Kirim label resmi satu paket ke nomor admin; kembalikan hasil untuk
 *  riwayat. Rantai: dokumen bebas (window 24 jam) → template dokumen resi
 *  (bebas window, menunggu review Meta) → template teks berisi tautan
 *  halaman Pesanan. */
export async function sendBlibliResiPdf(
  packageId: string,
  opts: { pdf: Buffer; label?: string },
): Promise<string> {
  const owner = ownerNumber();
  if (!owner) return "gagal: OWNER_WA_NUMBER belum diatur";

  const filename = `resi-kts-70007-${packageId}.pdf`;
  const caption = opts.label
    ? `Resi resmi paket ${packageId} — ${BLIBLI_STORE_NAME} (${opts.label})`
    : `Resi paket ${packageId} — ${BLIBLI_STORE_NAME}`;
  const suffix = opts.label ? ` (${opts.label})` : "";

  // 1. Dokumen bebas — hanya sah dalam window 24 jam sejak pemilik chat ke
  //    nomor API. Bila aktif, ini jalur tercepat tanpa menunggu review.
  const free = await sendDocument(owner, opts.pdf, filename, caption);
  if (free.ok) return `ok${suffix}`;

  // 2. Template utility ber-header DOKUMEN — bebas window 24 jam, tetapi
  //    menunggu status APPROVED dari review Meta.
  const doc = await sendDocumentTemplate(owner, opts.pdf, filename, packageId);
  if (doc.ok) return `ok (template${suffix})`;

  // 3. Template teks biasa: kabari saja dengan tautan halaman Pesanan Hub
  //    supaya resi tetap bisa dibuka manual.
  const tpl = await sendTemplateParams(owner, NOTIF_TEMPLATE, [
    `Paket ${packageId} — resi PDF gagal terkirim otomatis. Buka halaman Pesanan untuk mencetaknya: ${PESANAN_URL}`,
  ]);
  if (tpl.ok) return `ok (template teks${suffix})`;

  return `gagal: ${doc.error ?? "dokumen ditolak"} | template: ${tpl.error ?? "ditolak"}`;
}

/** Kirim notifikasi teks ke WA admin: teks bebas (window 24 jam) → template
 *  teks cadangan (bebas window, menunggu review Meta). */
async function sendOwnerNotice(msg: string): Promise<string> {
  const owner = ownerNumber();
  if (!owner) return "gagal: OWNER_WA_NUMBER belum diatur";
  const free = await sendText(owner, msg);
  if (free.ok) return "ok";
  const tpl = await sendTemplateParams(owner, NOTIF_TEMPLATE, [msg]);
  if (tpl.ok) return "ok (template)";
  return `gagal: ${free.error ?? "teks ditolak"} | template: ${tpl.error ?? "ditolak"}`;
}

/** Cari paket di pesanan terbaru lalu ambil label resmi + (bila FP)
 *  konfirmasi pengiriman — tanpa mengirim WA. Dipakai route cetak resi
 *  (dibuka di tab baru dari halaman Pesanan) dan tombol "Kirim Resi". */
export async function getBlibliResiPdf(
  packageId: string,
): Promise<BlibliOfficialResiResult> {
  const found = await findBlibliPackage(packageId);
  if (!found.ok) return { ok: false, detail: found.detail };
  const item = found.pkg.orderItems[0];
  return getOfficialResiForPackage(packageId, {
    itemStatus: item?.order.itemStatus,
    awbNumber: item?.logistic?.awbNumber,
    cashlessHandover: item?.flag?.cashlessHandover,
    sellerDeliveryType: item?.sellerDeliveryType,
    packageCreated: item?.flag?.packageCreated === true,
    orderItemIds: found.pkg.orderItems.map((x) => x.order.itemId),
  });
}

/** Kirim label resmi paket tertentu ke WA admin (dipakai tombol manual
 *  "Kirim Resi" di halaman Pesanan). */
export async function sendResiForBlibliPackage(
  packageId: string,
): Promise<{ ok: boolean; result: string }> {
  const official = await getBlibliResiPdf(packageId);
  if (!official.ok) return { ok: false, result: official.detail };

  // Paket bisa saja baru dibuat di dalam getOfficialResiForPackage —
  // pakai id paket FINAL (bukan id masukan yang mungkin placeholder).
  const finalPkg = official.packageId ?? packageId;
  const result = await sendBlibliResiPdf(finalPkg, {
    pdf: official.pdf,
    label: resiDocsLabel(official),
  });
  if (result.startsWith("ok")) {
    const found = await findBlibliPackage(finalPkg);
    if (found.ok) {
      for (const it of found.pkg.orderItems) {
        await markBlibliOrderSeen(it.order.itemId, blibliEnv().storeCode, result);
      }
    }
  }
  return { ok: result.startsWith("ok"), result };
}

/** Atur pengiriman (konfirmasi fulfill) untuk satu paket — padanan menu
 *  "Atur Pengiriman" aplikasi TikTok Shop. Untuk Dropship, AWB wajib;
 *  bila tidak diberikan, dicari dulu dari logistic.awbNumber paket, dan
 *  bila tetap kosong dikembalikan butuhAwb (tombol minta AWB ke pengguna). */
export async function fulfillBlibliPackageForOrder(
  packageId: string,
  awbNo?: string,
): Promise<{ ok: boolean; result: string; butuhAwb?: boolean }> {
  let awb = (awbNo ?? "").trim();
  if (awb === "") {
    const found = await findBlibliPackage(packageId);
    if (found.ok) {
      awb =
        found.pkg.orderItems.find((i) => i.logistic?.awbNumber)?.logistic
          ?.awbNumber ?? "";
    }
  }
  if (awb === "") {
    return {
      ok: false,
      result: "Nomor AWB (resi) wajib diisi untuk paket Dropship.",
      butuhAwb: true,
    };
  }
  const r = await fulfillBlibliPackage(packageId, awb);
  if (!r.ok) return { ok: false, result: r.detail };
  return { ok: true, result: `Pengiriman dikonfirmasi — AWB ${awb}` };
}

/** Jalankan satu ronde pengecekan item pesanan baru toko KTD STORE.
 *  Idempoten — tabel blibli_order_seen mencegah kirim ganda. Satu paket
 *  diproses SATU kali (dipicu item FP pertama yang melewati masa tunggu);
 *  item anggota lain ikut ditandai hasil yang sama. Bila `skipIfWorkerFresh`
 *  dan worker VPS baru saja menjalankan cek ini, ronde dilewati. */
export async function checkNewBlibliOrders(opts?: {
  skipIfWorkerFresh?: boolean;
}): Promise<BlibliResiCheckResult> {
  if (opts?.skipIfWorkerFresh && (await workerHeartbeatFresh("resi:blibli"))) {
    return { ok: true, detail: "dilewati: worker VPS baru saja menjalankan" };
  }
  const owner = ownerNumber();
  if (!owner) {
    return { ok: false, detail: "OWNER_WA_NUMBER belum diatur" };
  }
  const env = blibliEnv();
  if (!env.ready) {
    return { ok: false, detail: "Kredensial Blibli belum diatur (env BLIBLI_*)" };
  }

  const baseline = (await countSeenBlibliOrders()) === 0;
  const seen = new Map(
    (await listSeenBlibliOrders()).map((s) => [
      s.order_item_id,
      {
        notify: s.notify,
        attempts: Number(s.attempts ?? 0),
        last_attempt_at: s.last_attempt_at,
      },
    ]),
  );
  const markSeen = async (id: string, notify: string) => {
    await markBlibliOrderSeen(id, env.storeCode, notify);
    seen.set(id, { notify, attempts: 0, last_attempt_at: "" });
  };

  // Tarik paket 7 hari terakhir (status relevan, terbaru dulu).
  const now = Date.now();
  const ord = await listBlibliOrders({
    orderItemStatuses: CHECK_STATUSES,
    statusFPDateRange: { start: now - 7 * 86400 * 1000, end: now },
    sorting: { by: "statusFPUpdatedTimestamp", direction: "DESC" },
    paging: { page: 0, size: 50 },
  });
  if (!ord.ok) return { ok: false, detail: ord.detail };

  const packages = ord.data.packages;
  const pkgItems = new Map<string, BlibliOrderItem[]>();
  for (const p of packages) pkgItems.set(p.packageId, p.orderItems);

  const sent: string[] = [];
  const errors: string[] = [];
  let newOrders = 0;

  // Baris eksekusi Aneka per paket diambil LAZY lewat getBlibliOrderExec —
  // memuat semua baris (termasuk payload+log) tiap ronde menghabiskan kuota
  // egress database, padahal map hanya dipakai untuk kasus batal/refund.
  /** Potongan pesan "minta refund ke CS Aneka" berdasar baris eksekusi
   *  (bila ada) — sebutkan ID pembayaran, kode pesanan, dan total modal
   *  supaya admin tinggal membacakan datanya ke CS Aneka. */
  function refundAnekaInfo(
    exec:
      | { aneka_payment_id: string; aneka_order_id: string; payload: string }
      | undefined,
  ): string {
    if (!exec) {
      return " Bila sudah dibayar ke Aneka, SEGERA minta refund ke CS Aneka.";
    }
    const parts: string[] = [];
    if (exec.aneka_payment_id) {
      parts.push(`ID pembayaran ${exec.aneka_payment_id}`);
    }
    if (exec.aneka_order_id) {
      parts.push(`pesanan ${exec.aneka_order_id}`);
    }
    try {
      const t = Number(JSON.parse(exec.payload).total_modal ?? 0);
      if (t > 0) parts.push(`total ${"Rp" + t.toLocaleString("id-ID")}`);
    } catch {
      /* payload rusak — lewati total */
    }
    return parts.length > 0
      ? ` SEGERA minta refund ke CS Aneka (${parts.join(", ")}).`
      : " SEGERA minta refund ke CS Aneka.";
  }

  const noticedPkgs = new Set<string>(); // notif "pesanan baru" sekali per paket
  const handledPkgs = new Set<string>(); // proses label/eksekusi sekali per paket
  let returnChecks = 0; // hitungan cek detail retur ronde ini (lihat cap)

  for (const p of packages) {
    for (const it of p.orderItems) {
      // Kunci deteksi = order ITEM id Blibli (order.itemId) — nilai yang
      // dipakai path API detail/pembatalan. Baris seen lama (sebelum
      // perbaikan 12 Okt 2026) berkunci order.id — tetap dikenali lewat
      // fallback supaya tidak ada notif/penantian ganda.
      const itemId = it.order.itemId;
      const prev = seen.get(itemId) ?? seen.get(it.order.id);
      const cancelled = it.order.itemStatus === "X";
      const isNew = it.order.itemStatus === "FP";

      // Sudah pernah dikabari pembatalan/pengembaliannya — lewati.
      if (
        prev &&
        (prev.notify.startsWith("batal") || prev.notify.startsWith("refund"))
      )
        continue;

      // Item dibatalkan: kabari admin (sekali per paket) — resi tidak
      // dikirim untuk item batal.
      if (cancelled) {
        const items = pkgItems.get(p.packageId) ?? [];
        // Batalkan juga antrean eksekusi Aneka bila SELURUH item batal.
        if (items.length > 0 && items.every((x) => x.order.itemStatus === "X")) {
          await cancelBlibliExec(p.packageId);
        }
        // Percobaan ulang notifikasi pembatalan juga diberi jeda — tanpa
        // jeda, WA down beberapa menit menghabiskan kuota percobaan.
        if (
          prev &&
          prev.notify.startsWith("gagal") &&
          prev.last_attempt_at &&
          Date.now() - parseUtcMs(prev.last_attempt_at) < RETRY_COOLDOWN_MS
        ) {
          continue;
        }
        const silent =
          baseline ||
          prev?.notify === "skip" ||
          (prev && prev.attempts >= MAX_SEND_ATTEMPTS);
        if (silent) {
          await markSeen(itemId, "batal (tanpa kirim)");
          continue;
        }
        const itemsTxt = ` — ${it.product.itemName}`;
        const resiTerlanjur = prev && prev.notify.startsWith("ok");
        // Item yang SUDAH diproses (label terkirim, eksekusi disiapkan,
        // atau sudah ada pembayaran Aneka) lalu dibatalkan = uang sudah
        // keluar ke Aneka — ingatkan admin untuk minta refund ke CS Aneka.
        const exec = (await getBlibliOrderExec(p.packageId)) ?? undefined;
        const terlanjurBayar =
          resiTerlanjur ||
          prev?.notify.startsWith("eksekusi") ||
          (exec?.aneka_payment_id ?? "") !== "";
        const msg = terlanjurBayar
          ? `Pesanan Blibli dibatalkan SETELAH diproses: ${itemId}${itemsTxt}.${refundAnekaInfo(exec)} Label yang sempat terkirim mohon diabaikan.`
          : `Pesanan Blibli dibatalkan: ${itemId}${itemsTxt}. Tidak perlu disiapkan/dikirim.`;
        const res = await sendOwnerNotice(msg);
        if (res.startsWith("ok")) {
          const mark = `batal: ${res}${
            terlanjurBayar ? " (minta refund Aneka)" : ""
          }`;
          await markSeen(itemId, mark);
          sent.push(`${BLIBLI_STORE_NAME} ${itemId} → ${mark}`);
        } else {
          errors.push(`${BLIBLI_STORE_NAME}: ${itemId}: ${res}`);
          await recordBlibliOrderFailure(itemId, env.storeCode, `gagal batal: ${res}`);
        }
        continue;
      }

      // Deteksi paket dikembalikan / gagal antar untuk item yang SUDAH
      // diproses, baik sedang dikirim (PU/PF/CX) maupun sudah terkirim (D —
      // retur pembeli setelah diterima). API Blibli tidak punya endpoint
      // status paket — sumbernya riwayat status Order Detail V2 (histories)
      // yang memuat transisi berbahasa campur kode/prosa. Dijeda
      // RETURN_CHECK_INTERVAL_MS per item dan dibatasi cap per ronde supaya
      // kuota 100 req/30 menit tidak habis oleh tick tiap menit. Bila
      // detail gagal diambil, cek diulang pada jendela berikutnya.
      if (
        prev &&
        (prev.notify.startsWith("ok") || prev.notify.startsWith("eksekusi")) &&
        (it.order.itemStatus === "PU" ||
          it.order.itemStatus === "PF" ||
          it.order.itemStatus === "CX" ||
          it.order.itemStatus === "D")
      ) {
        const lastCheck = prev.last_attempt_at
          ? parseUtcMs(prev.last_attempt_at)
          : 0;
        if (Date.now() - lastCheck < RETURN_CHECK_INTERVAL_MS) continue;
        // Jatah cek detail ronde ini habis — item dicek ronde berikutnya.
        if (returnChecks >= MAX_RETURN_CHECKS_PER_TICK) continue;
        returnChecks++;
        const det = await getBlibliOrderDetail(itemId);
        let returnHit = "";
        if (det.ok) {
          const d = det.data as {
            status?: string;
            histories?: { status?: string }[];
          };
          const histTxt = (d.histories ?? [])
            .map((h) => h.status ?? "")
            .join(" ");
          const m = /return|retur|dikembalikan|undeliver|gagal antar|failed deliver/i.exec(
            `${d.status ?? ""} ${histTxt}`,
          );
          if (m) returnHit = m[0];
        }
        if (returnHit) {
          const exec = (await getBlibliOrderExec(p.packageId)) ?? undefined;
          const statusD = it.order.itemStatus === "D";
          const msg = statusD
            ? `Paket pesanan Blibli diretur pembeli SETELAH terkirim: ${itemId} — ${it.product.itemName} (riwayat: ${returnHit}).${refundAnekaInfo(exec)}`
            : `Paket pesanan Blibli dikembalikan/gagal antar: ${itemId} — ${it.product.itemName} (riwayat: ${returnHit}).${refundAnekaInfo(exec)}`;
          const res = await sendOwnerNotice(msg);
          if (res.startsWith("ok")) {
            await markSeen(itemId, `refund: ${res}`);
            sent.push(`${BLIBLI_STORE_NAME} ${itemId} → refund: ${res}`);
          } else {
            errors.push(`${BLIBLI_STORE_NAME}: ${itemId}: ${res}`);
            await recordBlibliOrderFailure(
              itemId,
              env.storeCode,
              `gagal refund: ${res}`,
            );
          }
          continue;
        }
        // Catat waktu cek terakhir (notify tidak diubah) supaya cek
        // berikutnya diberi jeda.
        const nowStr = new Date().toISOString().slice(0, 19).replace("T", " ");
        await touchBlibliOrderSeen(itemId, nowStr);
        seen.set(itemId, {
          ...(prev ?? { notify: "", attempts: 0, last_attempt_at: "" }),
          last_attempt_at: nowStr,
        });
        continue;
      }

      // Gerbang status: hanya item FP (pesanan baru penjual) yang diproses.
      // C belum lolos Fraud Pass (nanti berubah jadi FP), PU/PF/CX sudah
      // dikirim, D selesai, OS/BP/CR bukan alur pengiriman biasa.
      // PENGECUALIAN: paket yang gagal SETELAH fulfill (status PU/PF/CX dan
      // notify "gagal" — mis. label tak terunduh sesaat setelah pengiriman
      // dikonfirmasi) boleh diulang; fulfill TIDAK diulang karena
      // getOfficialResiForPackage hanya fulfill saat FP — tinggal label.
      // Begitu pula paket PU/PF/CX yang direset lewat "Siapkan ulang"
      // (notify "menunggu" dengan epoch lama) — persiapan ulang TIDAK
      // menyentuh status pesanan, hanya antrean eksekusi.
      const bisaUlangLabel =
        (prev?.notify.startsWith("gagal") ||
          prev?.notify.startsWith("menunggu")) &&
        (it.order.itemStatus === "PU" ||
          it.order.itemStatus === "PF" ||
          it.order.itemStatus === "CX");
      if (!isNew && !bisaUlangLabel) continue;

      // Mode baseline: tandai saja item lama, jangan kirim resi.
      if (!prev && baseline) {
        await markSeen(itemId, "skip");
        continue;
      }

      // Item baru: tunda pemrosesan (baris "menunggu" menyimpan epoch saat
      // pertama kali terlihat) — beri kesempatan pembeli membatalkan.
      if (!prev) {
        await markSeen(itemId, `menunggu:${Date.now()}`);
        newOrders++;
        // Kabari admin bahwa pesanan terdeteksi — informasi saja, tidak
        // memengaruhi alur (masa tunggu tetap berjalan). Sekali per paket.
        if (!noticedPkgs.has(p.packageId)) {
          noticedPkgs.add(p.packageId);
          const items = pkgItems.get(p.packageId) ?? [];
          const itemsTxt =
            items.length > 0
              ? ` — ${items[0].product.itemName}${
                  items.length > 1 ? ` (+${items.length - 1} produk lain)` : ""
                }`
              : "";
          const notice = await sendOwnerNotice(
            `Pesanan Blibli baru: ${p.packageId}${itemsTxt}. Akan diproses otomatis ±15 menit (memberi kesempatan pembeli membatalkan).`,
          );
          if (!notice.startsWith("ok")) {
            errors.push(
              `${BLIBLI_STORE_NAME}: ${p.packageId}: notif pesanan baru gagal: ${notice}`,
            );
          }
        }
        continue;
      }

      // Masih dalam masa tunggu sebelum item boleh diproses.
      if (prev.notify.startsWith("menunggu")) {
        const since = Number(prev.notify.split(":")[1] ?? 0);
        if (Date.now() - since < NEW_ORDER_WAIT_MS) continue;
      } else if (!prev.notify.startsWith("gagal")) {
        // Sudah pernah berhasil diproses — lewati.
        continue;
      }

      // Sudah gagal berkali-kali — berhenti mencoba otomatis. Kabari admin
      // SEKALI (bukan tiap tick) supaya kegagalan tidak diam senyap; label
      // tetap bisa dibuka manual dari halaman Pesanan / tombol Siapkan ulang.
      if (prev.attempts >= MAX_SEND_ATTEMPTS) {
        if (
          prev.notify.startsWith("gagal") &&
          !prev.notify.startsWith("gagal-berhenti")
        ) {
          const res = await sendOwnerNotice(
            `Pesanan Blibli ${itemId} gagal diproses otomatis setelah ${MAX_SEND_ATTEMPTS} percobaan: ${prev.notify}. Silakan proses manual di halaman Pesanan: ${PESANAN_URL}`,
          );
          const mark = `gagal-berhenti: ${res.startsWith("ok") ? "admin dikabari" : "tanpa notif"}`;
          await markBlibliOrderSeen(itemId, env.storeCode, mark);
          seen.set(itemId, {
            notify: mark,
            attempts: prev.attempts,
            last_attempt_at: prev.last_attempt_at,
          });
        }
        continue;
      }

      // Percobaan ulang diberi jeda — bila pengecekan berjalan tiap menit
      // (tab admin terbuka), tanpa jeda ini kegagalan sementara langsung
      // menghabiskan kuota percobaan dalam hitungan menit.
      if (
        prev.notify.startsWith("gagal") &&
        prev.last_attempt_at &&
        Date.now() - parseUtcMs(prev.last_attempt_at) < RETRY_COOLDOWN_MS
      ) {
        continue;
      }

      // Paket ini mungkin sudah diproses lewat item lain di ronde ini.
      if (handledPkgs.has(p.packageId)) continue;

      // Masa tunggu selesai, atau percobaan ulang untuk kiriman yang gagal.
      newOrders++;
      handledPkgs.add(p.packageId);

      const items = pkgItems.get(p.packageId) ?? [];

      // Detail SEMUA item paket diambil SEKALI di sini — SEBELUM keputusan
      // jalur — karena dialah sumber data yang benar: qty asli tiap item,
      // nama varian (variantName), dan status terbaru (item bisa saja
      // dibatalkan di tengah masa tunggu). Bila detail GAGAL diambil,
      // qty/varian tidak bisa dipastikan — gagal tertutup: catat kegagalan
      // dan coba lagi siklus berikutnya.
      type DetItem = {
        item: BlibliOrderItem;
        variantName: string;
        /** Catatan produk dari detail order item (product.notes) — sering
         *  dipakai pembeli menitip ukuran/warna (mis. "ukuran 40") untuk
         *  listing tanpa varian; bahan pelengkap variantName. */
        notes: string;
        qty: number;
        cancelled: boolean;
        customerName: string;
        /** itemSku dari detail (atau list) — bahan kunci productSku. */
        blibliSku: string;
        /** Nomor resi riil dari detail (shipment.airwayBill) — untuk paket
         *  PICKUP baru muncul setelah fulfill, jadi daftar tidak memuatnya. */
        awb: string;
      };
      const detItems: DetItem[] = [];
      let detailGagal = false;
      for (const x of items) {
        const d = await getBlibliOrderDetail(x.order.itemId);
        if (!d.ok) {
          detailGagal = true;
          errors.push(`${p.packageId}: detail item ${x.order.id}: ${d.detail}`);
          break;
        }
        const st = String(d.data.status ?? "");
        const shipment = d.data.shipment as
          | { airwayBill?: { number?: string | number } }
          | undefined;
        detItems.push({
          item: x,
          variantName: String(d.data.product?.variantName ?? ""),
          notes: String(d.data.product?.notes ?? "").trim(),
          qty: Number(d.data.quantity) > 0 ? Number(d.data.quantity) : 0,
          cancelled: st === "X" || /cancel/i.test(st),
          customerName: String(d.data.recipient?.name ?? x.order.customerFullName ?? ""),
          blibliSku: String(
            d.data.product?.blibliSku ?? x.product.blibliSku ?? "",
          ),
          awb: String(shipment?.airwayBill?.number ?? "").trim(),
        });
      }
      if (detailGagal) {
        const alasan = `gagal: detail item tidak bisa diambil — varian & qty tidak bisa dipastikan, proses manual`;
        errors.push(`${BLIBLI_STORE_NAME}: ${p.packageId}: ${alasan}`);
        await recordBlibliOrderFailure(itemId, env.storeCode, alasan);
        continue;
      }

      // Item dibatalkan di tengah masa tunggu → notifikasi pembatalan
      // menggantikan pemrosesan.
      const semuaBatal = detItems.every((d) => d.cancelled);
      const adaBatal = detItems.some((d) => d.cancelled);
      if (semuaBatal) {
        await cancelBlibliExec(p.packageId);
        const itemsTxt =
          detItems.length > 0 ? ` — ${detItems[0].item.product.itemName}` : "";
        const res = await sendOwnerNotice(
          `Pesanan Blibli dibatalkan: ${p.packageId}${itemsTxt}. Tidak perlu disiapkan/dikirim.`,
        );
        for (const d of detItems) {
          await markSeen(
            d.item.order.itemId,
            res.startsWith("ok") ? `batal: ${res}` : "batal (tanpa kirim)",
          );
        }
        if (!res.startsWith("ok")) {
          errors.push(`${BLIBLI_STORE_NAME}: ${p.packageId}: ${res}`);
        }
        continue;
      }

      const aktif = detItems.filter((d) => !d.cancelled);

      // Fase 2: bila SEMUA item paket sudah dipetakan ke Aneka, jangan kirim
      // resi — siapkan eksekusi semi-otomatis (tunggu tombol Setuju di
      // halaman Eksekusi; rantai checkout Aneka baru dijalankan saat
      // disetujui supaya tidak menumpuk pembayaran mangkrak). Paket dengan
      // item dibatalkan sebagian TIDAK dieksekusi otomatis (isi paket tidak
      // bisa dipastikan cocok dengan keranjang Aneka) — proses manual.
      const srcItems: BlibliExecSourceItem[] = aktif.map((d) => ({
        // Kunci pemetaan = productSku (dari itemSku); fallback sellerSku.
        blibli_sku: blibliProductSku(d.blibliSku || d.item.product.sellerSku),
        seller_sku: d.item.product.sellerSku,
        item_name: d.item.product.itemName,
        // Petunjuk varian = variantName + catatan pembeli. Untuk listing
        // tanpa varian variantName = nama produk (tanpa warna/ukuran) dan
        // ukuran/warna sering hanya ada di notes — 28 Okt 2026: "ukuran 40".
        variant_name: [d.variantName, d.notes]
          .filter((s) => s.trim() !== "")
          .join(" | "),
        qty: d.qty,
      }));
      const execCheck = adaBatal
        ? {
            ok: false as const,
            detail:
              "Sebagian item paket dibatalkan pembeli — proses manual",
          }
        : await checkBlibliExecutable(srcItems);

      const first = aktif[0]?.item ?? items[0];
      // AWB dari detail (shipment.airwayBill) lebih akurat daripada logistic
      // di daftar — paket PICKUP baru mendapat nomor resi setelah fulfill,
      // jadi detail yang diambil saat status PU memuatnya, daftar tidak.
      const awbDetail = detItems.map((d) => d.awb).find((a) => a !== "") ?? "";
      const pkgInfo: BlibliPackageInfo = {
        itemStatus: first?.order.itemStatus,
        awbNumber: awbDetail || first?.logistic?.awbNumber,
        cashlessHandover: first?.flag?.cashlessHandover,
        sellerDeliveryType: first?.sellerDeliveryType,
        packageCreated: first?.flag?.packageCreated === true,
        // Item aktif saja — Create Package V1 menolak item batal.
        orderItemIds: aktif.map((d) => d.item.order.itemId),
      };

      if (execCheck.ok) {
        const official = await getOfficialResiForPackage(p.packageId, pkgInfo);
        if (!official.ok) {
          errors.push(`${BLIBLI_STORE_NAME}: ${p.packageId}: ${official.detail}`);
          await recordBlibliOrderFailure(
            itemId,
            env.storeCode,
            `gagal: ${official.detail}`,
          );
          continue;
        }
        const pkgFinal = official.packageId ?? p.packageId;
        const prep = await prepareBlibliExec(
          {
            package_id: pkgFinal,
            order_item_ids: items.map((x) => x.order.itemId),
            store_name: BLIBLI_STORE_NAME,
            customer_name: detItems[0]?.customerName ?? "",
            items: srcItems,
          },
          { pdf: official.pdf, tracking_number: official.tracking_number },
          // Percobaan ulang setelah kegagalan: antrean "menunggu" mungkin
          // sudah tersimpan tetapi notif WA-nya gagal — kirim ulang.
          { resendNotice: prev.notify.startsWith("gagal") },
        );
        if (prep.ok) {
          for (const d of detItems) {
            await markSeen(d.item.order.itemId, "eksekusi:menunggu");
          }
          sent.push(
            `${BLIBLI_STORE_NAME} ${pkgFinal} → menunggu persetujuan Aneka`,
          );
        } else {
          errors.push(`${BLIBLI_STORE_NAME}: ${pkgFinal}: ${prep.detail}`);
          await recordBlibliOrderFailure(
            itemId,
            env.storeCode,
            `gagal: ${prep.detail}`,
          );
        }
        continue;
      }

      // Item belum terpetakan ke Aneka — jalur lama: kirim label ke WA.
      const official = await getOfficialResiForPackage(p.packageId, pkgInfo);
      if (!official.ok) {
        errors.push(`${BLIBLI_STORE_NAME}: ${p.packageId}: ${official.detail}`);
        await recordBlibliOrderFailure(
          itemId,
          env.storeCode,
          `gagal: ${official.detail}`,
        );
        continue;
      }
      const pkgFinal = official.packageId ?? p.packageId;

      const result = await sendBlibliResiPdf(pkgFinal, {
        pdf: official.pdf,
        label: resiDocsLabel(official),
      });
      if (result.startsWith("ok")) {
        for (const d of detItems) {
          await markSeen(d.item.order.itemId, result);
        }
        sent.push(`${BLIBLI_STORE_NAME} ${pkgFinal} → ${result}`);
        // Jelaskan KENAPA tidak dieksekusi otomatis — jangan biarkan
        // pemilik mengira paket berjalan otomatis padahal manual.
        await sendOwnerNotice(
          `Catatan paket ${pkgFinal}: eksekusi otomatis TIDAK dijalankan — ${execCheck.detail}. Paket ini diproses manual.`,
        );
      } else {
        errors.push(`${BLIBLI_STORE_NAME}: ${pkgFinal}: ${result}`);
        await recordBlibliOrderFailure(itemId, env.storeCode, result);
      }
    }
  }

  return {
    ok: true,
    baseline,
    newOrders,
    sent,
    errors,
  };
}
