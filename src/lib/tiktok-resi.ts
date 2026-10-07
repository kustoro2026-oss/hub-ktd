// Deteksi pesanan TikTok baru → ambil label kirim RESMI TikTok Shop → kirim
// ke WhatsApp pemilik toko (085171157938 / env OWNER_WA_NUMBER). Alur:
//
//  1. Siapkan kredensial tiap toko (refresh token + isi ulang shop_cipher).
//  2. Tarik pesanan terbaru (7 hari) dan bandingkan dengan tabel
//     tiktok_order_seen.
//  3. Mode baseline: bila tabel masih kosong (pertama kali), semua pesanan
//     lama hanya DITANDAI tanpa kirim resi — mencegah banjir 20 PDF sekaligus.
//  4. Pesanan dibatalkan (CANCELLED): kabari admin lewat WA sekali, tandai
//     "batal: ..." — resi tidak pernah dikirim untuk pesanan batal.
//  5. Pesanan baru: ditahan NEW_ORDER_WAIT_MS (default 15 menit) sebelum resi
//     dikirim — memberi kesempatan pembeli membatalkan. Selama menunggu
//     statusnya "menunggu:<epoch_ms>"; kalau dibatalkan di tengah tunggu,
//     notifikasi pembatalan menggantikan kirim resi.
//  6. Setelah masa tunggu: ambil dokumen cetak resmi dari API TikTok Shop —
//     satu panggilan SHIPPING_LABEL_AND_PACKING_SLIP (label kirim + daftar
//     pengemasan, A6) persis dua centang di dialog "Cetak halaman" aplikasi,
//     plus percobaan daftar pengambilan barang (PICKUP_LIST, A4 — belum ada
//     di API publik, dilewati bila ditolak) — lalu kirim ke WA admin lewat
//     rantai: dokumen bebas (window 24 jam) → template dokumen resi_pesanan
//     (bebas window, menunggu review Meta) → template teks order_alert_ktd2
//     berisi tautan halaman Pesanan.
//  7. Kirim gagal ditandai + hitungan percobaan naik — dicoba ulang pada
//     pengecekan berikutnya sampai batas, lalu dihentikan (label tetap bisa
//     dibuka manual dari halaman Pesanan).
import {
  countSeenTiktokOrders,
  listSeenTiktokOrders,
  listTiktokShopTokens,
  markTiktokOrderSeen,
  recordTiktokOrderFailure,
} from "@/lib/db";
import {
  cancelAnekaExec,
  checkAnekaExecutable,
  prepareAnekaExec,
} from "@/lib/aneka-exec";
import {
  downloadShippingDocument,
  getPackageDetail,
  getPackageHandoverTimeSlots,
  getPackageShippingDocument,
  getTiktokOrderDetail,
  getTiktokOrders,
  resolveLineQty,
  searchPackages,
  shipPackage,
  type TiktokOrderDetail,
} from "@/lib/tiktok";
import { prepareShop } from "@/lib/tiktok-orders";
import { buildResiPdf } from "@/lib/resi";
import { PDFDocument } from "pdf-lib";
import {
  NOTIF_TEMPLATE,
  ownerNumber,
  nowWib,
  sendDocument,
  sendDocumentTemplate,
  sendTemplateParams,
  sendText,
} from "@/lib/wa";

/** Batas percobaan kirim ulang untuk pesanan yang resinya gagal terkirim.
 *  Dengan jeda RETRY_COOLDOWN_MS antar percobaan, batas ini mencakup
 *  sekitar 6 jam pemulihan (label belum tersedia, situs sibuk, dll.). */
const MAX_SEND_ATTEMPTS = 12;

/** Jeda minimal antar percobaan ulang pesanan yang gagal. Penting karena
 *  pengecekan bisa berjalan tiap menit (tab admin terbuka) — tanpa jeda,
 *  kegagalan sementara menghabiskan seluruh kuota percobaan dalam beberapa
 *  menit lalu pesanan diam selamanya. */
const RETRY_COOLDOWN_MS = 30 * 60 * 1000;

/** Lama pesanan baru ditahan sebelum resi dikirim (env
 *  TIKTOK_RESI_DELAY_MINUTES, default 15 menit) — memberi kesempatan
 *  pembeli membatalkan supaya resi tidak terkirim percuma. */
const NEW_ORDER_WAIT_MS =
  (Number(process.env.TIKTOK_RESI_DELAY_MINUTES) || 15) * 60 * 1000;

/** UTC "YYYY-MM-DD HH:MM:SS" → epoch ms. */
function parseUtcMs(s: string): number {
  const t = Date.parse(s.replace(" ", "T") + "Z");
  return Number.isFinite(t) ? t : 0;
}

/** Satu jenis dokumen yang diminta saat "Cetak Resi" — urutan sesuai dialog
 *  "Cetak halaman" aplikasi TikTok Shop. `reason` diisi saat dokumen
 *  dilewati (alasannya dari API/unduhan). */
export type ResiDocInfo = {
  type: string;
  label: string;
  size: string;
  reason?: string;
};

/** Dokumen cetak resi lengkap — urutan sesuai dialog "Cetak halaman":
 *  label kirim (A6) + daftar pengemasan (A6) + daftar pengambilan barang
 *  (A4). Label + daftar pengemasan diambil SEKALIGUS lewat tipe
 *  SHIPPING_LABEL_AND_PACKING_SLIP (satu PDF resmi dari TikTok). */
const LABEL_DOC: ResiDocInfo = {
  type: "SHIPPING_LABEL",
  label: "Label pengiriman",
  size: "A6",
};
const PACKING_DOC: ResiDocInfo = {
  type: "PACKING_SLIP",
  label: "Daftar pengemasan",
  size: "A6",
};
const PICKUP_DOC: ResiDocInfo = {
  type: "PICKUP_LIST",
  label: "Daftar pengambilan barang",
  size: "A4",
};

/** Hasil cetak resi resmi: PDF gabungan + daftar dokumen ikut/dilewati. */
export type ResiPdfResult =
  | {
      ok: true;
      pdf: Buffer;
      tracking_number: string;
      docs: ResiDocInfo[];
      skipped: ResiDocInfo[];
    }
  | { ok: false; detail: string };

/** Hasil cetak resi resmi + info penjadwalan (arranged = penjemputan baru
 *  saja dijadwalkan otomatis karena pesanan masih menunggu kirim). */
export type OfficialResiResult =
  | {
      ok: true;
      pdf: Buffer;
      tracking_number: string;
      docs: ResiDocInfo[];
      skipped: ResiDocInfo[];
      arranged: boolean;
    }
  | { ok: false; detail: string };

/** Gabung beberapa PDF resmi (boleh beda ukuran halaman) menjadi satu file. */
async function mergePdfBuffers(buffers: Buffer[]): Promise<Buffer> {
  const out = await PDFDocument.create();
  for (const buf of buffers) {
    const src = await PDFDocument.load(buf, { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const page of pages) out.addPage(page);
  }
  return Buffer.from(await out.save());
}

/** Keterangan singkat isi PDF resi untuk caption WA/riwayat. */
function resiDocsLabel(r: {
  docs: ResiDocInfo[];
  skipped: ResiDocInfo[];
  arranged: boolean;
}): string {
  const extra =
    r.docs.length === 2
      ? ` + ${r.docs[1].label.toLowerCase()}`
      : r.docs.length > 2
        ? ` + ${r.docs.length - 1} dokumen`
        : "";
  const skip =
    r.skipped.length > 0
      ? ` (tanpa: ${r.skipped.map((d) => d.label.toLowerCase()).join(", ")})`
      : "";
  return `label resmi${extra}${r.arranged ? " + penjemputan dijadwalkan" : ""}${skip}`;
}

export type ResiCheckResult = {
  ok: boolean;
  baseline?: boolean;
  newOrders?: number;
  sent?: string[];
  errors?: string[];
  detail?: string;
};

/** Cari package_id milik satu pesanan: mulai dari daftar paket pada detail
 *  pesanan (field `packages`), lalu jatuh ke API Search Package dengan
 *  mencocokkan orders[].id. */
async function findPackageIdForOrder(
  cred: { cipher: string; access_token: string },
  orderId: string,
): Promise<{ ok: true; packageId: string } | { ok: false; detail: string }> {
  const detail = await getTiktokOrderDetail(cred, [orderId]);
  if (detail.ok) {
    const order = detail.orders.find((o) => o.id === orderId);
    const pkg = order?.package_list[0]?.id;
    if (pkg) return { ok: true, packageId: pkg };
  }
  const now = Math.floor(Date.now() / 1000);
  const found = await searchPackages(cred, {
    update_time_ge: now - 60 * 86400,
    update_time_lt: now + 3600,
  });
  if (!found.ok) return { ok: false, detail: found.detail };
  const pkg = found.packages.find((p) => p.order_ids.includes(orderId));
  if (!pkg) {
    return { ok: false, detail: "Paket untuk pesanan ini tidak ditemukan" };
  }
  return { ok: true, packageId: pkg.id };
}

/** Ambil dokumen cetak RESMI TikTok Shop untuk satu pesanan lewat jalur
 *  fulfillment (per package_id) — sama seperti dialog "Cetak halaman"
 *  aplikasi. Strategi:
 *
 *  1. SHIPPING_LABEL_AND_PACKING_SLIP — satu panggilan yang mengembalikan
 *     label kirim + daftar pengemasan (A6) dalam SATU PDF resmi (persis dua
 *     centang atas di dialog "Cetak halaman").
 *  2. Bila gabungan ditolak: jatuh ke SHIPPING_LABEL (wajib — tanpa label,
 *     gagal) lalu PACKING_SLIP terpisah, digabung dengan pdf-lib.
 *  3. PICKUP_LIST (A4) dicoba — tipe ini belum ada di API publik TikTok,
 *     jadi biasanya tercatat di `skipped` dengan alasan dari API.
 *
 *  Dokumen tambahan yang ditolak tidak pernah membatalkan cetak label. */
async function fetchOfficialResiPdf(
  cred: { cipher: string; access_token: string },
  orderId: string,
): Promise<ResiPdfResult> {
  const pkgId = await findPackageIdForOrder(cred, orderId);
  if (!pkgId.ok) return { ok: false, detail: pkgId.detail };

  const buffers: Buffer[] = [];
  const docs: ResiDocInfo[] = [];
  const skipped: ResiDocInfo[] = [];
  let trackingNumber = "";
  let gabungFail: string | null = null;

  // 1. Label + daftar pengemasan sekaligus.
  const gabung = await getPackageShippingDocument(
    cred,
    pkgId.packageId,
    "SHIPPING_LABEL_AND_PACKING_SLIP",
    "A6",
  );
  if (gabung.ok) {
    const gabungDl = await downloadShippingDocument(gabung.doc_url);
    if (gabungDl.ok) {
      buffers.push(gabungDl.pdf);
      docs.push(LABEL_DOC, PACKING_DOC);
      trackingNumber = gabung.tracking_number;
    } else {
      gabungFail = gabungDl.detail;
    }
  } else {
    gabungFail = gabung.detail;
  }

  // 2. Cadangan: label saja (wajib), lalu daftar pengemasan terpisah.
  if (buffers.length === 0) {
    const label = await getPackageShippingDocument(
      cred,
      pkgId.packageId,
      "SHIPPING_LABEL",
      "A6",
    );
    if (!label.ok) return { ok: false, detail: label.detail };
    const labelDl = await downloadShippingDocument(label.doc_url);
    if (!labelDl.ok) return { ok: false, detail: labelDl.detail };
    buffers.push(labelDl.pdf);
    docs.push(LABEL_DOC);
    trackingNumber = label.tracking_number;

    const pack = await getPackageShippingDocument(
      cred,
      pkgId.packageId,
      "PACKING_SLIP",
      "A6",
    );
    if (pack.ok) {
      const packDl = await downloadShippingDocument(pack.doc_url);
      if (packDl.ok) {
        buffers.push(packDl.pdf);
        docs.push(PACKING_DOC);
      } else {
        skipped.push({ ...PACKING_DOC, reason: packDl.detail });
      }
    } else {
      skipped.push({ ...PACKING_DOC, reason: gabungFail ?? pack.detail });
    }
  }

  // 3. Daftar pengambilan barang (A4) — dicoba, biasanya ditolak API.
  const pickup = await getPackageShippingDocument(
    cred,
    pkgId.packageId,
    "PICKUP_LIST",
    "A4",
  );
  if (pickup.ok) {
    const pickupDl = await downloadShippingDocument(pickup.doc_url);
    if (pickupDl.ok) {
      buffers.push(pickupDl.pdf);
      docs.push(PICKUP_DOC);
    } else {
      skipped.push({ ...PICKUP_DOC, reason: pickupDl.detail });
    }
  } else {
    skipped.push({ ...PICKUP_DOC, reason: pickup.detail });
  }

  // 4. Gabung PDF bila lebih dari satu (gagal gabung → label saja).
  let pdf = buffers[0];
  if (buffers.length > 1) {
    try {
      pdf = await mergePdfBuffers(buffers);
    } catch {
      // PDF resmi memakai fitur yang tidak didukung library penggabung —
      // cetak label saja, dokumen tambahan dicatat sebagai dilewati.
      skipped.push(
        ...docs.slice(1).map((d) => ({ ...d, reason: "gagal digabung" })),
      );
      docs.splice(1);
    }
  }

  return {
    ok: true,
    pdf,
    tracking_number: trackingNumber,
    docs,
    skipped,
  };
}

/** Kirim resi satu pesanan ke nomor admin; kembalikan hasil untuk riwayat.
 *  Bila opts.pdf diberikan (label resmi), dokumen itu yang dikirim; tanpa
 *  PDF, resi buatan dibuat dari detail pesanan sebagai cadangan. */
export async function sendResiPdf(
  orderId: string,
  orderDetail: TiktokOrderDetail | null,
  shopName: string,
  opts: { pdf?: Buffer | null; label?: string } = {},
): Promise<string> {
  const owner = ownerNumber();
  if (!owner) return "gagal: OWNER_WA_NUMBER belum diatur";

  const slug =
    shopName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") ||
    "ktd-store";
  const filename = `resi-${slug}-${orderId}.pdf`;

  let pdf: Buffer;
  if (opts.pdf) {
    pdf = opts.pdf;
  } else if (orderDetail) {
    pdf = await buildResiPdf(orderDetail, {
      shopName,
      generatedAt: nowWib(),
    });
  } else {
    return "gagal: dokumen tidak tersedia";
  }

  const caption = opts.label
    ? `Resi resmi pesanan ${orderId} — ${shopName} (${opts.label})`
    : `Resi pesanan ${orderId} — ${shopName}`;
  const suffix = opts.label ? ` (${opts.label})` : "";

  // 1. Dokumen bebas — hanya sah dalam window 24 jam sejak pemilik chat ke
  //    nomor API. Bila aktif, ini jalur tercepat tanpa menunggu review.
  const free = await sendDocument(owner, pdf, filename, caption);
  if (free.ok) return `ok${suffix}`;

  // 2. Template utility ber-header DOKUMEN — bebas window 24 jam, tetapi
  //    menunggu status APPROVED dari review Meta.
  const doc = await sendDocumentTemplate(owner, pdf, filename, orderId);
  if (doc.ok) return `ok (template${suffix})`;

  // 3. Template teks biasa: kabari saja dengan tautan halaman Pesanan Hub
  //    supaya resi tetap bisa dibuka manual.
  const tpl = await sendTemplateParams(owner, NOTIF_TEMPLATE, [
    `Pesanan ${orderId} — resi PDF gagal terkirim otomatis. Buka halaman Pesanan untuk mencetaknya: https://admin.kustoro2026.com/marketplace/tiktok/pesanan`,
  ]);
  if (tpl.ok) return `ok (template teks${suffix})`;

  return `gagal: ${doc.error ?? "dokumen ditolak"} | template: ${tpl.error ?? "ditolak"}`;
}

/** Kirim resi pesanan tertentu ke WA admin (dipakai tombol manual di
 *  halaman Pesanan). Mengirim label RESMI TikTok Shop — tanpa label resmi
 *  yang tersedia, kiriman dibatalkan dengan alasan yang jelas. */
export async function sendResiForOrder(
  orderId: string,
): Promise<{ ok: boolean; result: string }> {
  const shops = await listTiktokShopTokens();
  for (const shop of shops) {
    const prep = await prepareShop(shop);
    if (!prep.ok) continue;
    const cred = { cipher: prep.cipher, access_token: prep.access_token };

    const official = await getOfficialResiForCred(cred, orderId);
    if (!official.ok) return { ok: false, result: official.detail };

    const result = await sendResiPdf(orderId, null, shop.shop_name, {
      pdf: official.pdf,
      label: resiDocsLabel(official),
    });
    if (result.startsWith("ok")) {
      await markTiktokOrderSeen(orderId, shop.shop_id, result);
    }
    return { ok: result.startsWith("ok"), result };
  }
  return { ok: false, result: "Pesanan tidak ditemukan di toko terotorisasi" };
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

/** Jalankan satu ronde pengecekan pesanan baru untuk semua toko terotorisasi.
 *  Idempoten — tabel tiktok_order_seen mencegah kirim ganda. */
export async function checkNewTiktokOrders(): Promise<ResiCheckResult> {
  const owner = ownerNumber();
  if (!owner) {
    return { ok: false, detail: "OWNER_WA_NUMBER belum diatur" };
  }

  const shops = await listTiktokShopTokens();
  if (shops.length === 0) {
    return {
      ok: false,
      detail: "Belum ada toko TikTok Shop yang diotorisasi",
    };
  }

  const baseline = (await countSeenTiktokOrders()) === 0;
  const seen = new Map(
    (await listSeenTiktokOrders()).map((s) => [
      s.order_id,
      {
        notify: s.notify,
        attempts: Number(s.attempts ?? 0),
        last_attempt_at: s.last_attempt_at,
      },
    ]),
  );

  const sent: string[] = [];
  const errors: string[] = [];
  let newOrders = 0;

  for (const shop of shops) {
    const prep = await prepareShop(shop);
    if (!prep.ok) {
      errors.push(`${shop.shop_name}: ${prep.detail}`);
      continue;
    }
    const cred = { cipher: prep.cipher, access_token: prep.access_token };
    const ord = await getTiktokOrders(cred, { daysBack: 7 });
    if (!ord.ok) {
      errors.push(`${shop.shop_name}: ${ord.detail}`);
      continue;
    }

    for (const o of ord.orders) {
      const prev = seen.get(o.order_id);
      const cancelled =
        o.order_status === "CANCELLED" || o.order_status === "CANCELED";

      // Sudah pernah dikabari pembatalannya — lewati.
      if (prev && prev.notify.startsWith("batal")) continue;

      // Pesanan dibatalkan: kabari admin (sekali) — resi tidak dikirim.
      if (cancelled) {
        // Batalkan juga antrean eksekusi Aneka bila sempat disiapkan.
        await cancelAnekaExec(o.order_id);
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
          await markTiktokOrderSeen(
            o.order_id,
            shop.shop_id,
            "batal (tanpa kirim)",
          );
          continue;
        }
        const itemsTxt =
          o.items.length > 0
            ? ` — ${o.items[0].product_name}${
                o.items.length > 1 ? ` (+${o.items.length - 1} produk lain)` : ""
              }`
            : "";
        const resiTerlanjur = prev && prev.notify.startsWith("ok");
        const msg = `Pesanan TikTok Shop dibatalkan: ${o.order_id}${itemsTxt}.${
          resiTerlanjur
            ? " Resi yang sudah terkirim mohon diabaikan."
            : " Tidak perlu disiapkan/dikirim."
        }`;
        const res = await sendOwnerNotice(msg);
        if (res.startsWith("ok")) {
          const mark = `batal: ${res}${
            resiTerlanjur ? " (resi sempat terkirim)" : ""
          }`;
          await markTiktokOrderSeen(o.order_id, shop.shop_id, mark);
          sent.push(`${shop.shop_name} ${o.order_id} → ${mark}`);
        } else {
          errors.push(`${shop.shop_name}: ${o.order_id}: ${res}`);
          await recordTiktokOrderFailure(
            o.order_id,
            shop.shop_id,
            `gagal batal: ${res}`,
          );
        }
        continue;
      }

      // Mode baseline: tandai saja pesanan lama, jangan kirim resi.
      if (!prev && baseline) {
        await markTiktokOrderSeen(o.order_id, shop.shop_id, "skip");
        continue;
      }

      // Pesanan baru: tunda kirim resi (baris "menunggu" menyimpan epoch
      // saat pertama kali terlihat) — beri kesempatan pembeli membatalkan.
      if (!prev) {
        await markTiktokOrderSeen(
          o.order_id,
          shop.shop_id,
          `menunggu:${Date.now()}`,
        );
        newOrders++;
        // Kabari admin bahwa pesanan terdeteksi — informasi saja, tidak
        // memengaruhi alur (masa tunggu tetap berjalan).
        const itemsTxt =
          o.items.length > 0
            ? ` — ${o.items[0].product_name}${o.items[0].sku_name ? ` (${o.items[0].sku_name})` : ""}${
                o.items.length > 1 ? ` (+${o.items.length - 1} produk lain)` : ""
              }`
            : "";
        const notice = await sendOwnerNotice(
          `Pesanan TikTok Shop baru: ${o.order_id}${itemsTxt}. Akan diproses otomatis ±15 menit (memberi kesempatan pembeli membatalkan).`,
        );
        if (!notice.startsWith("ok")) {
          errors.push(
            `${shop.shop_name}: ${o.order_id}: notif pesanan baru gagal: ${notice}`,
          );
        }
        continue;
      }

      // Masih dalam masa tunggu sebelum resi boleh dikirim.
      if (prev.notify.startsWith("menunggu")) {
        const since = Number(prev.notify.split(":")[1] ?? 0);
        if (Date.now() - since < NEW_ORDER_WAIT_MS) continue;
      } else if (!prev.notify.startsWith("gagal")) {
        // Sudah pernah berhasil dikirim — lewati.
        continue;
      }

      // Sudah gagal berkali-kali — berhenti mencoba (resi tetap bisa
      // dibuka manual dari halaman Pesanan).
      if (prev.attempts >= MAX_SEND_ATTEMPTS) continue;

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

      // Masa tunggu selesai, atau percobaan ulang untuk kiriman yang gagal.
      newOrders++;

      // Detail pesanan diambil SEKALI di sini — SEBELUM keputusan jalur —
      // karena dialah sumber data yang benar: qty asli tiap baris
      // (sku_count), nama varian (sku_name), dan jumlah paket. Ringkasan
      // pencarian TikTok mengembalikan sku_count 0 untuk toko ini, jadi qty
      // TIDAK boleh ditebak dari ringkasan. Bila detail GAGAL diambil,
      // qty/paket/varian tidak bisa dipastikan — gagal tertutup: catat
      // kegagalan dan coba lagi siklus berikutnya.
      const detail = await getTiktokOrderDetail(cred, [o.order_id]);
      if (!detail.ok) {
        const alasan = `gagal: detail pesanan tidak bisa diambil (${detail.detail}) — paket & qty tidak bisa dipastikan, proses manual`;
        errors.push(`${shop.shop_name}: ${o.order_id}: ${alasan}`);
        await recordTiktokOrderFailure(o.order_id, shop.shop_id, alasan);
        continue;
      }
      const det = detail.orders.find((d) => d.id === o.order_id);
      const pkgs = det?.package_list ?? [];
      // Satu slot resi Aneka per pesanan (satu paket = satu label).
      // Pesanan multi-paket tidak bisa diwakili satu label — proses manual.
      if (pkgs.length > 1) {
        const alasan = `gagal: pesanan multi-paket (${pkgs.length} paket) — eksekusi Aneka hanya satu slot resi, proses manual`;
        errors.push(`${shop.shop_name}: ${o.order_id}: ${alasan}`);
        await recordTiktokOrderFailure(o.order_id, shop.shop_id, alasan);
        continue;
      }
      // Bangun ulang item pesanan dari detail (sumber qty/varian resmi).
      // Baca resolveLineQty: sku_count → gabungan combined_listing_skus →
      // 1 per baris (TikTok toko ini tidak pernah mengisi sku_count dan
      // menulis satu baris per unit — pesanan 2 botol = 2 baris kembar).
      if (det && det.line_items.length > 0) {
        o.items = det.line_items.map((li) => ({
          product_id: li.product_id,
          sku_id: li.sku_id,
          product_name: li.product_name,
          sku_count: resolveLineQty(li),
          sku_name: li.sku_name,
          seller_sku: li.seller_sku,
        }));
      }

      // Fase 2: bila SEMUA produk pesanan sudah dipetakan ke Aneka, jangan
      // kirim resi — siapkan eksekusi semi-otomatis (tunggu tombol Setuju
      // di halaman Eksekusi; rantai checkout Aneka baru dijalankan saat
      // disetujui supaya tidak menumpuk pembayaran mangkrak).
      const execCheck = await checkAnekaExecutable(o);
      if (execCheck.ok) {
        const official = await getOfficialResiForCred(cred, o.order_id);
        if (!official.ok) {
          errors.push(`${shop.shop_name}: ${o.order_id}: ${official.detail}`);
          await recordTiktokOrderFailure(
            o.order_id,
            shop.shop_id,
            `gagal: ${official.detail}`,
          );
          continue;
        }
        const prep = await prepareAnekaExec(
          shop,
          o,
          {
            pdf: official.pdf,
            tracking_number: official.tracking_number,
          },
          // Percobaan ulang setelah kegagalan: antrean "menunggu" mungkin
          // sudah tersimpan tetapi notif WA-nya gagal — kirim ulang.
          { resendNotice: prev.notify.startsWith("gagal") },
        );
        if (prep.ok) {
          await markTiktokOrderSeen(
            o.order_id,
            shop.shop_id,
            "eksekusi:menunggu",
          );
          sent.push(
            `${shop.shop_name} ${o.order_id} → menunggu persetujuan Aneka`,
          );
        } else {
          errors.push(`${shop.shop_name}: ${o.order_id}: ${prep.detail}`);
          await recordTiktokOrderFailure(
            o.order_id,
            shop.shop_id,
            `gagal: ${prep.detail}`,
          );
        }
        continue;
      }

      // Produk belum terpetakan ke Aneka — jalur lama: kirim label ke WA.
      const official = await getOfficialResiForCred(cred, o.order_id);
      if (!official.ok) {
        errors.push(`${shop.shop_name}: ${o.order_id}: ${official.detail}`);
        await recordTiktokOrderFailure(
          o.order_id,
          shop.shop_id,
          `gagal: ${official.detail}`,
        );
        continue;
      }

      const result = await sendResiPdf(o.order_id, null, shop.shop_name, {
        pdf: official.pdf,
        label: resiDocsLabel(official),
      });
      if (result.startsWith("ok")) {
        await markTiktokOrderSeen(o.order_id, shop.shop_id, result);
        sent.push(`${shop.shop_name} ${o.order_id} → ${result}`);
        // Jelaskan KENAPA tidak dieksekusi otomatis — jangan biarkan
        // pemilik mengira pesanan berjalan otomatis padahal manual.
        await sendOwnerNotice(
          `Catatan pesanan ${o.order_id}: eksekusi otomatis TIDAK dijalankan — ${execCheck.detail}. Pesanan ini diproses manual.`,
        );
      } else {
        errors.push(`${shop.shop_name}: ${o.order_id}: ${result}`);
        await recordTiktokOrderFailure(o.order_id, shop.shop_id, result);
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

/** Epoch detik (UTC) → "Sen, 05/10 09.00–12.00 WIB". */
function formatSlotWib(start: number, end: number): string {
  const HARI = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
  const s = new Date((start + 7 * 3600) * 1000);
  const e = new Date((end + 7 * 3600) * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${HARI[s.getUTCDay()]}, ${p(s.getUTCDate())}/${p(s.getUTCMonth() + 1)} ${p(s.getUTCHours())}.${p(s.getUTCMinutes())}–${p(e.getUTCHours())}.${p(e.getUTCMinutes())} WIB`;
}

/** Atur pengiriman untuk satu pesanan (inti, tanpa loop toko) — persis menu
 *  "Atur Pengiriman" di aplikasi TikTok Shop: ambil slot penjemputan
 *  tersedia, pilih yang tercepat, lalu jadwalkan PICKUP (atau DROP_OFF bila
 *  pickup tidak ada). Setelah berhasil, label kirim resmi bisa diambil. */
async function arrangeShipment(
  cred: { cipher: string; access_token: string },
  orderId: string,
): Promise<{ ok: boolean; result: string }> {
  const pkgId = await findPackageIdForOrder(cred, orderId);
  if (!pkgId.ok) return { ok: false, result: pkgId.detail };
  const packageId = pkgId.packageId;

  const slots = await getPackageHandoverTimeSlots(cred, packageId);
  if (!slots.ok) return { ok: false, result: slots.detail };

  if (slots.can_pickup) {
    const now = Math.floor(Date.now() / 1000);
    const slot = slots.pickup_slots
      .filter((s) => s.available && s.start_time >= now)
      .sort((a, b) => a.start_time - b.start_time)[0];
    if (!slot) {
      return {
        ok: false,
        result: "Tidak ada slot penjemputan yang tersedia saat ini",
      };
    }
    const ship = await shipPackage(cred, packageId, {
      handover_method: "PICKUP",
      pickup_slot: { start_time: slot.start_time, end_time: slot.end_time },
    });
    if (!ship.ok) return { ok: false, result: ship.detail };

    const pkg = await getPackageDetail(cred, packageId);
    const resi =
      pkg.ok && pkg.tracking_number
        ? ` · No resi ${pkg.tracking_number}`
        : "";
    return {
      ok: true,
      result: `Penjemputan dijadwalkan ${formatSlotWib(
        slot.start_time,
        slot.end_time,
      )}${resi}`,
    };
  }

  if (slots.can_drop_off) {
    const ship = await shipPackage(cred, packageId, {
      handover_method: "DROP_OFF",
    });
    if (!ship.ok) return { ok: false, result: ship.detail };
    const link = slots.drop_off_point_url
      ? ` Lokasi drop-off: ${slots.drop_off_point_url}`
      : "";
    return {
      ok: true,
      result: `Pengiriman diatur — silakan antar paket ke titik drop-off.${link}`,
    };
  }

  return {
    ok: false,
    result: "Paket ini tidak mendukung pickup maupun drop-off lewat API",
  };
}

/** Atur pengiriman untuk satu pesanan (loop semua toko terotorisasi). */
export async function arrangeShipmentForOrder(
  orderId: string,
): Promise<{ ok: boolean; result: string }> {
  const shops = await listTiktokShopTokens();
  for (const shop of shops) {
    const prep = await prepareShop(shop);
    if (!prep.ok) continue;
    const cred = { cipher: prep.cipher, access_token: prep.access_token };
    const res = await arrangeShipment(cred, orderId);
    return res;
  }
  return { ok: false, result: "Pesanan tidak ditemukan di toko terotorisasi" };
}

/** Ambil dokumen cetak RESMI untuk satu pesanan — meniru persis alur
 *  aplikasi TikTok Shop: bila label belum tersedia karena pesanan masih
 *  "Menunggu kirim" (AWAITING_SHIPMENT), jadwalkan penjemputan dulu (slot
 *  tercepat) lalu ambil dokumennya — status pesanan otomatis berubah jadi
 *  "Menunggu pickup", dan selanjutnya resi bisa dicetak ulang kapan saja. */
export async function getOfficialResiForCred(
  cred: { cipher: string; access_token: string },
  orderId: string,
): Promise<OfficialResiResult> {
  // 1. Coba label langsung (logistics → cadangan fulfillment).
  const direct = await fetchOfficialResiPdf(cred, orderId);
  if (direct.ok) return { ...direct, arranged: false };

  // 2. Label belum tersedia. Bila pesanan masih berstatus menunggu kirim,
  //    jalankan alur aplikasi: atur pengiriman dulu, baru ambil label.
  const detail = await getTiktokOrderDetail(cred, [orderId]);
  const order = detail.ok
    ? detail.orders.find((o) => o.id === orderId)
    : undefined;
  if (!order || order.status !== "AWAITING_SHIPMENT") {
    return { ok: false, detail: direct.detail };
  }
  const arranged = await arrangeShipment(cred, orderId);
  if (!arranged.ok) {
    return {
      ok: false,
      detail: `${direct.detail} — dan gagal mengatur pengiriman: ${arranged.result}`,
    };
  }
  const after = await fetchOfficialResiPdf(cred, orderId);
  if (!after.ok) return { ok: false, detail: after.detail };
  return { ...after, arranged: true };
}

/** Ambil dokumen cetak resmi untuk satu pesanan (loop semua toko
 *  terotorisasi). */
export async function getOfficialResiForOrder(
  orderId: string,
): Promise<OfficialResiResult> {
  const shops = await listTiktokShopTokens();
  for (const shop of shops) {
    const prep = await prepareShop(shop);
    if (!prep.ok) continue;
    const cred = { cipher: prep.cipher, access_token: prep.access_token };
    return await getOfficialResiForCred(cred, orderId);
  }
  return { ok: false, detail: "Pesanan tidak ditemukan di toko terotorisasi" };
}
