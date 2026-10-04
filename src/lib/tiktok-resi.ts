// Deteksi pesanan TikTok baru → ambil label kirim RESMI TikTok Shop → kirim
// ke WhatsApp pemilik toko (085171157938 / env OWNER_WA_NUMBER). Alur:
//
//  1. Siapkan kredensial tiap toko (refresh token + isi ulang shop_cipher).
//  2. Tarik pesanan terbaru (7 hari) dan bandingkan dengan tabel
//     tiktok_order_seen.
//  3. Mode baseline: bila tabel masih kosong (pertama kali), semua pesanan
//     lama hanya DITANDAI tanpa kirim resi — mencegah banjir 20 PDF sekaligus.
//  4. Pesanan baru: ambil dokumen pengiriman resmi (SHIPPING_LABEL) dari
//     API TikTok Shop — label kirim PDF persis seperti menu "Cetak Resi"
//     aplikasi — lalu kirim ke WA admin lewat rantai: dokumen bebas (window
//     24 jam) → template dokumen resi_pesanan (bebas window, menunggu review
//     Meta) → template teks order_alert_ktd2 berisi tautan halaman Pesanan.
//  5. Kirim gagal ditandai + hitungan percobaan naik — dicoba ulang pada
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
  downloadShippingDocument,
  getPackageDetail,
  getPackageHandoverTimeSlots,
  getPackageShippingDocument,
  getShippingDocument,
  getTiktokOrderDetail,
  getTiktokOrders,
  shipPackage,
  type TiktokOrderDetail,
} from "@/lib/tiktok";
import { prepareShop } from "@/lib/tiktok-orders";
import { buildResiPdf } from "@/lib/resi";
import {
  NOTIF_TEMPLATE,
  ownerNumber,
  nowWib,
  sendDocument,
  sendDocumentTemplate,
  sendTemplateParams,
} from "@/lib/wa";

/** Batas percobaan kirim ulang untuk pesanan yang resinya gagal terkirim. */
const MAX_SEND_ATTEMPTS = 3;

export type ResiCheckResult = {
  ok: boolean;
  baseline?: boolean;
  newOrders?: number;
  sent?: string[];
  errors?: string[];
  detail?: string;
};

/** Ambil PDF label kirim RESMI TikTok Shop untuk satu pesanan. Coba dulu
 *  jalur logistics (per order_id, persis menu Cetak Resi aplikasi); bila
 *  gagal, coba jalur fulfillment lewat package_id dari detail pesanan. */
async function fetchOfficialResiPdf(
  cred: { cipher: string; access_token: string },
  orderId: string,
): Promise<
  | { ok: true; pdf: Buffer; tracking_number: string }
  | { ok: false; detail: string }
> {
  const doc = await getShippingDocument(cred, orderId, "SHIPPING_LABEL");
  if (doc.ok) {
    const dl = await downloadShippingDocument(doc.doc_url);
    if (dl.ok) {
      return { ok: true, pdf: dl.pdf, tracking_number: doc.tracking_number };
    }
    return { ok: false, detail: dl.detail };
  }

  // Jalur cadangan: cari package_id lewat detail pesanan.
  const detail = await getTiktokOrderDetail(cred, [orderId]);
  if (detail.ok) {
    const order = detail.orders.find((o) => o.id === orderId);
    const packageId = order?.package_list[0]?.id;
    if (packageId) {
      const pkg = await getPackageShippingDocument(cred, packageId);
      if (pkg.ok) {
        const dl = await downloadShippingDocument(pkg.doc_url);
        if (dl.ok) {
          return {
            ok: true,
            pdf: dl.pdf,
            tracking_number: pkg.tracking_number,
          };
        }
        return { ok: false, detail: dl.detail };
      }
      return {
        ok: false,
        detail: `Label resmi tidak tersedia (logistics: ${doc.detail}; fulfillment: ${pkg.detail})`,
      };
    }
    return {
      ok: false,
      detail: `${doc.detail} (paket belum dibuat)`,
    };
  }
  return { ok: false, detail: `${doc.detail} (detail: ${detail.detail})` };
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
      label: official.arranged
        ? "label resmi + penjemputan dijadwalkan"
        : "label resmi",
    });
    if (result.startsWith("ok")) {
      await markTiktokOrderSeen(orderId, shop.shop_id, result);
    }
    return { ok: result.startsWith("ok"), result };
  }
  return { ok: false, result: "Pesanan tidak ditemukan di toko terotorisasi" };
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
      { notify: s.notify, attempts: Number(s.attempts ?? 0) },
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
    const ord = await getTiktokOrders(cred, 7);
    if (!ord.ok) {
      errors.push(`${shop.shop_name}: ${ord.detail}`);
      continue;
    }

    for (const o of ord.orders) {
      const prev = seen.get(o.order_id);

      // Mode baseline: tandai saja pesanan lama, jangan kirim resi.
      if (!prev && baseline) {
        await markTiktokOrderSeen(o.order_id, shop.shop_id, "skip");
        continue;
      }

      // Sudah pernah berhasil dikirim — lewati.
      if (prev && !prev.notify.startsWith("gagal")) continue;

      // Sudah gagal berkali-kali — berhenti mencoba (resi tetap bisa
      // dibuka manual dari halaman Pesanan).
      if (prev && prev.attempts >= MAX_SEND_ATTEMPTS) continue;

      // Pesanan baru, atau percobaan ulang untuk kiriman yang gagal.
      newOrders++;
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
        label: official.arranged
          ? "label resmi + penjemputan dijadwalkan"
          : "label resmi",
      });
      if (result.startsWith("ok")) {
        await markTiktokOrderSeen(o.order_id, shop.shop_id, result);
        sent.push(`${shop.shop_name} ${o.order_id} → ${result}`);
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
  const detail = await getTiktokOrderDetail(cred, [orderId]);
  if (!detail.ok) return { ok: false, result: detail.detail };
  const order = detail.orders.find((o) => o.id === orderId);
  const packageId = order?.package_list[0]?.id;
  if (!packageId) {
    return { ok: false, result: "Paket belum tersedia untuk pesanan ini" };
  }

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

/** Ambil label kirim RESMI untuk satu pesanan — meniru persis alur aplikasi
 *  TikTok Shop: bila label belum tersedia karena pesanan masih "Menunggu
 *  kirim" (AWAITING_SHIPMENT), jadwalkan penjemputan dulu (slot tercepat)
 *  lalu ambil labelnya — status pesanan otomatis berubah jadi "Menunggu
 *  pickup", dan selanjutnya resi bisa dicetak ulang kapan saja. */
export async function getOfficialResiForCred(
  cred: { cipher: string; access_token: string },
  orderId: string,
): Promise<
  | { ok: true; pdf: Buffer; tracking_number: string; arranged: boolean }
  | { ok: false; detail: string }
> {
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

/** Ambil label kirim resmi untuk satu pesanan (loop semua toko terotorisasi). */
export async function getOfficialResiForOrder(
  orderId: string,
): Promise<
  | { ok: true; pdf: Buffer; tracking_number: string; arranged: boolean }
  | { ok: false; detail: string }
> {
  const shops = await listTiktokShopTokens();
  for (const shop of shops) {
    const prep = await prepareShop(shop);
    if (!prep.ok) continue;
    const cred = { cipher: prep.cipher, access_token: prep.access_token };
    return await getOfficialResiForCred(cred, orderId);
  }
  return { ok: false, detail: "Pesanan tidak ditemukan di toko terotorisasi" };
}
