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
  appendTiktokOrderExecLog,
  countSeenTiktokOrders,
  getTiktokOrderExec,
  listSeenTiktokOrders,
  listTiktokOrderExecs,
  listTiktokShopTokens,
  markTiktokOrderSeen,
  recordTiktokOrderFailure,
  saveTiktokOrderExec,
} from "@/lib/db";
import {
  cancelAnekaExec,
  checkAnekaExecutable,
  notifSiapEksekusiTikTok,
  prepareAnekaExec,
  type AnekaExecPayload,
} from "@/lib/aneka-exec";
import {
  getPackageDetail,
  getTiktokOrderDetail,
  getTiktokOrders,
  resolveLineQty,
  type TiktokOrderDetail,
} from "@/lib/tiktok";
import { prepareShop } from "@/lib/tiktok-orders";
import {
  findPackageIdForOrder,
  getOfficialResiForCred,
  parseUtcMs,
  type ResiDocInfo,
} from "@/lib/tiktok-label";
import { buildResiPdf } from "@/lib/resi";

// Mesin label resmi pindah ke tiktok-label.ts (dipakai juga aneka-exec).
// Ekspor ulang supaya route API tetap bisa mengimpor dari modul ini.
export { arrangeShipmentForOrder, getOfficialResiForOrder } from "@/lib/tiktok-label";
import {
  NOTIF_TEMPLATE,
  ownerNumber,
  nowWib,
  sendDocument,
  sendDocumentTemplate,
  sendTemplateParams,
  sendText,
} from "@/lib/wa";

/** Batas percobaan KIRIM CEPAT untuk pesanan yang resinya gagal terkirim.
 *  Dengan jeda RETRY_COOLDOWN_MS antar percobaan, batas ini mencakup
 *  sekitar 6 jam pemulihan (label belum tersedia, situs sibuk, dll.).
 *  Setelah batas ini tercapai pesanan TIDAK berhenti — percobaan berlanjut
 *  dengan jeda panjang EXHAUSTED_RETRY_MS sampai berhasil. */
const MAX_SEND_ATTEMPTS = 12;

/** Jeda panjang antar percobaan SETELAH batas percobaan cepat habis —
 *  pesanan tidak pernah mati senyap: kegagalan sementara (mis. slot
 *  penjemputan TikTok habis untuk hari ini) pulih sendiri begitu slot
 *  tersedia lagi. 4 jam ≈ cukup untuk slot hari berikutnya dirilis. */
const EXHAUSTED_RETRY_MS = 4 * 60 * 60 * 1000;

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

/** Jeda minimal antar percobaan pengisian label di baris eksekusi yang
 *  labelnya masih kosong — label biasanya hanya hilang sementara (slot
 *  penjemputan TikTok penuh, API sibuk); diisi ulang berkala sampai
 *  tersedia atau sampai antrean dieksekusi/disetujui. */
const ISILABEL_RETRY_MS = 30 * 60 * 1000;

/** Isi label resmi ke baris eksekusi "menunggu" bila labelnya belum sempat
 *  terisi saat persiapan (mis. slot penjemputan TikTok penuh). Dipanggil
 *  tiap ronde pengecekan — antrean eksekusi TIDAK lagi tertahan oleh label:
 *  pemilik tetap menerima notif Setuju, label menyusul begitu tersedia.
 *  Idempoten: baris yang labelnya sudah terisi dilewati. */
async function isiLabelEksekusi(
  cred: { cipher: string; access_token: string },
  orderId: string,
): Promise<void> {
  const row = await getTiktokOrderExec(orderId);
  if (!row || row.status !== "menunggu") return;
  let payload: AnekaExecPayload;
  try {
    payload = JSON.parse(row.payload) as AnekaExecPayload;
  } catch {
    return; // payload rusak — perbaiki manual
  }
  if (payload.label_pdf_base64) return; // sudah terisi

  // Coba isi paling banyak tiap ISILABEL_RETRY_MS — jejak "isi-label" di
  // log jadi penanda kapan percobaan terakhir dijalankan.
  const garis = (row.log ?? "").split("\n").filter(Boolean);
  const terakhir = garis.filter((g) => g.includes("| isi-label |")).pop();
  if (terakhir) {
    const m = terakhir.match(/\[(\d+)\]/);
    const t = m ? Number(m[1]) : 0;
    if (Date.now() - t < ISILABEL_RETRY_MS) return; // belum waktunya
  }

  const official = await getOfficialResiForCred(cred, orderId);
  let stempel = `[${Date.now()}] | isi-label | ${
    official.ok ? "ok" : `gagal: ${official.detail}`
  }`;
  if (official.ok) {
    payload.tracking_number = official.tracking_number;
    payload.label_pdf_base64 = official.pdf.toString("base64");
    await saveTiktokOrderExec({
      order_id: orderId,
      status: "menunggu",
      payload: JSON.stringify(payload),
    });
    // Label baru terisi — kirim ulang notif Setuju dengan format lengkap
    // (termasuk nomor resi) supaya pesan terbaru sama seperti pesanan yang
    // labelnya tersedia sejak persiapan.
    const notice = await sendOwnerNotice(notifSiapEksekusiTikTok(payload));
    stempel += ` | notif ulang: ${
      notice.startsWith("ok") ? "ok" : `GAGAL — ${notice}`
    }`;
  }
  await appendTiktokOrderExecLog(orderId, stempel);
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

  // Baris eksekusi Aneka per pesanan — dipakai untuk notifikasi refund.
  const execByOrder = new Map(
    (await listTiktokOrderExecs()).map((e) => [e.order_id, e]),
  );

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

      /** Catat kegagalan pemrosesan pesanan + kabari pemilik SEKALI saat
       *  batas percobaan cepat tercapai — supaya kegagalan berkepanjangan
       *  tidak berjalan senyap. Percobaan panjang tetap berlanjut. */
      async function recordFailure(shopName: string, alasan: string) {
        const akanHabis =
          prev != null && prev.attempts + 1 === MAX_SEND_ATTEMPTS;
        await recordTiktokOrderFailure(o.order_id, shop.shop_id, alasan);
        if (akanHabis) {
          const notice = await sendOwnerNotice(
            `Pesanan TikTok Shop ${o.order_id} belum bisa diproses otomatis setelah ${MAX_SEND_ATTEMPTS} percobaan — ${alasan}. Sistem akan terus mencoba ulang setiap ${EXHAUSTED_RETRY_MS / 3600000} jam; untuk mempercepat, silakan atur pengiriman manual di aplikasi TikTok Shop (Pesanan → Atur Pengiriman).`,
          );
          if (!notice.startsWith("ok")) {
            errors.push(
              `${shopName}: ${o.order_id}: notif eskalasi gagal: ${notice}`,
            );
          }
        }
      }

      // Gerbang status: hanya pesanan berbayar yang belum selesai yang
      // dianggap "baru". UNPAID belum dibayar — bila nanti dibayar,
      // statusnya berubah dan diproses saat itu. COMPLETED adalah pesanan
      // LAMA yang baru saja berubah status: update_time-nya ikut berubah
      // sehingga muncul lagi di jendela pencarian 7 hari — tanpa gerbang
      // ini, order lama diumumkan sebagai "pesanan baru" dan berisiko
      // dieksekusi ulang (bayar dobel). Kasus nyata: 586148585295545791
      // (dibuat 19 Sep, baru selesai 10 Okt, sempat diumumkan jam 01:15).
      if (o.order_status === "UNPAID" || o.order_status === "COMPLETED") {
        continue;
      }

      // Sudah pernah dikabari pembatalan/pengembaliannya — lewati.
      if (
        prev &&
        (prev.notify.startsWith("batal") || prev.notify.startsWith("refund"))
      )
        continue;

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
        // Pesanan yang SUDAH diproses (resi terkirim, eksekusi disiapkan,
        // atau sudah ada pembayaran Aneka) lalu dibatalkan = uang sudah
        // keluar ke Aneka — ingatkan admin untuk minta refund ke CS Aneka.
        const exec = execByOrder.get(o.order_id);
        const terlanjurBayar =
          resiTerlanjur ||
          prev?.notify.startsWith("eksekusi") ||
          (exec?.aneka_payment_id ?? "") !== "";
        const msg = terlanjurBayar
          ? `Pesanan TikTok Shop dibatalkan SETELAH diproses: ${o.order_id}${itemsTxt}.${refundAnekaInfo(exec)} Resi yang sempat terkirim mohon diabaikan.`
          : `Pesanan TikTok Shop dibatalkan: ${o.order_id}${itemsTxt}. Tidak perlu disiapkan/dikirim.`;
        const res = await sendOwnerNotice(msg);
        if (res.startsWith("ok")) {
          const mark = `batal: ${res}${
            terlanjurBayar ? " (minta refund Aneka)" : ""
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

      // Deteksi paket dikembalikan / gagal antar untuk pesanan yang SUDAH
      // diproses (resi terkirim atau eksekusi Aneka disiapkan). Status
      // order tidak selalu berubah saat paket kembali — status paket
      // fulfilment-lah sumber yang pasti. Hanya dicek untuk pesanan dalam
      // pengiriman; bila API gagal, cek ulang pada tick berikutnya.
      if (
        prev &&
        (prev.notify.startsWith("ok") || prev.notify.startsWith("eksekusi")) &&
        (o.order_status === "PARTIALLY_SHIPPING" ||
          o.order_status === "AWAITING_COLLECTION" ||
          o.order_status === "IN_TRANSIT")
      ) {
        const pkgFind = await findPackageIdForOrder(cred, o.order_id);
        if (pkgFind.ok) {
          const pkg = await getPackageDetail(cred, pkgFind.packageId);
          if (
            pkg.ok &&
            /return|failed|logistic/i.test(
              `${pkg.package_status} ${pkg.package_sub_status}`,
            )
          ) {
            const itemsTxt =
              o.items.length > 0
                ? ` — ${o.items[0].product_name}${
                    o.items.length > 1
                      ? ` (+${o.items.length - 1} produk lain)`
                      : ""
                  }`
                : "";
            const exec = execByOrder.get(o.order_id);
            const msg = `Paket pesanan TikTok Shop dikembalikan/gagal antar: ${o.order_id}${itemsTxt} (status paket: ${pkg.package_status}${
              pkg.package_sub_status ? ` / ${pkg.package_sub_status}` : ""
            }).${refundAnekaInfo(exec)}`;
            const res = await sendOwnerNotice(msg);
            if (res.startsWith("ok")) {
              await markTiktokOrderSeen(
                o.order_id,
                shop.shop_id,
                `refund: ${res}`,
              );
              sent.push(`${shop.shop_name} ${o.order_id} → refund: ${res}`);
            } else {
              errors.push(`${shop.shop_name}: ${o.order_id}: ${res}`);
              await recordTiktokOrderFailure(
                o.order_id,
                shop.shop_id,
                `gagal refund: ${res}`,
              );
            }
            continue;
          }
        }
      }

      // Antrean eksekusi sudah disiapkan (notif Setuju terkirim): isi label
      // resminya secara berkala bila masih kosong — tanpa mengganggu alur
      // persetujuan. Bila belum waktunya, isiLabelEksekusi langsung lewat.
      if (prev && prev.notify.startsWith("eksekusi")) {
        await isiLabelEksekusi(cred, o.order_id);
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

      // Sudah gagal berkali-kali — jangan berhenti total: percobaan cepat
      // habis bukan berarti menyerah. Lanjutkan dengan jeda panjang
      // EXHAUSTED_RETRY_MS sampai berhasil (mis. slot penjemputan TikTok
      // habis hari ini → pulih sendiri saat slot hari berikutnya dirilis).
      if (
        prev.attempts >= MAX_SEND_ATTEMPTS &&
        prev.last_attempt_at &&
        Date.now() - parseUtcMs(prev.last_attempt_at) < EXHAUSTED_RETRY_MS
      ) {
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
        await recordFailure(shop.shop_name, alasan);
        continue;
      }
      const det = detail.orders.find((d) => d.id === o.order_id);
      const pkgs = det?.package_list ?? [];
      // Satu slot resi Aneka per pesanan (satu paket = satu label).
      // Pesanan multi-paket tidak bisa diwakili satu label — proses manual.
      if (pkgs.length > 1) {
        const alasan = `gagal: pesanan multi-paket (${pkgs.length} paket) — eksekusi Aneka hanya satu slot resi, proses manual`;
        errors.push(`${shop.shop_name}: ${o.order_id}: ${alasan}`);
        await recordFailure(shop.shop_name, alasan);
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
        // Label resmi DIUSAHAKAN dulu, tetapi kegagalan TIDAK lagi menahan
        // antrean eksekusi — slot penjemputan TikTok yang penuh sebelumnya
        // membuat pesanan macet senyap tanpa notif Setuju. Bila label gagal,
        // antrean tetap disiapkan; label menyusul lewat isiLabelEksekusi
        // atau diambil ulang saat eksekusi dijalankan.
        const official = await getOfficialResiForCred(cred, o.order_id);
        if (!official.ok) {
          errors.push(
            `${shop.shop_name}: ${o.order_id}: label belum tersedia (${official.detail}) — antrean eksekusi tetap disiapkan`,
          );
        }
        const prep = await prepareAnekaExec(
          shop,
          o,
          official.ok
            ? {
                pdf: official.pdf,
                tracking_number: official.tracking_number,
              }
            : null,
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
          await recordFailure(shop.shop_name, `gagal: ${prep.detail}`);
        }
        continue;
      }

      // Produk belum terpetakan ke Aneka — jalur lama: kirim label ke WA.
      const official = await getOfficialResiForCred(cred, o.order_id);
      if (!official.ok) {
        errors.push(`${shop.shop_name}: ${o.order_id}: ${official.detail}`);
        await recordFailure(shop.shop_name, `gagal: ${official.detail}`);
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
        await recordFailure(shop.shop_name, result);
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
