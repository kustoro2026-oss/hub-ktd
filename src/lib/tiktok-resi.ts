// Deteksi pesanan TikTok baru → buat resi PDF → kirim ke WhatsApp pemilik
// toko (085171157938 / env OWNER_WA_NUMBER). Alur per pengecekan:
//
//  1. Siapkan kredensial tiap toko (refresh token + isi ulang shop_cipher).
//  2. Tarik pesanan terbaru (7 hari) dan bandingkan dengan tabel
//     tiktok_order_seen.
//  3. Mode baseline: bila tabel masih kosong (pertama kali), semua pesanan
//     lama hanya DITANDAI tanpa kirim resi — mencegah banjir 20 PDF sekaligus.
//  4. Pesanan baru: ambil detail, buat PDF, kirim ke WA admin lewat rantai:
//     dokumen bebas (window 24 jam) → template dokumen resi_pesanan (bebas
//     window, menunggu review Meta) → template teks order_alert_ktd2 berisi
//     tautan halaman Pesanan Hub.
//  5. Kirim gagal ditandai + hitungan percobaan naik — dicoba ulang pada
//     pengecekan berikutnya sampai batas, lalu dihentikan (resi tetap bisa
//     dibuka manual dari halaman Pesanan).
import {
  countSeenTiktokOrders,
  listSeenTiktokOrders,
  listTiktokShopTokens,
  markTiktokOrderSeen,
  recordTiktokOrderFailure,
} from "@/lib/db";
import {
  getTiktokOrderDetail,
  getTiktokOrders,
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

/** Kirim resi satu pesanan ke nomor admin; kembalikan hasil untuk riwayat. */
export async function sendResiPdf(
  orderId: string,
  orderDetail: TiktokOrderDetail,
  shopName: string,
): Promise<string> {
  const owner = ownerNumber();
  if (!owner) return "gagal: OWNER_WA_NUMBER belum diatur";

  const slug =
    shopName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") ||
    "ktd-store";
  const filename = `resi-${slug}-${orderId}.pdf`;
  const pdf = await buildResiPdf(orderDetail, {
    shopName,
    generatedAt: nowWib(),
  });
  const caption = `Resi pesanan ${orderId} — ${shopName}`;

  // 1. Dokumen bebas — hanya sah dalam window 24 jam sejak pemilik chat ke
  //    nomor API. Bila aktif, ini jalur tercepat tanpa menunggu review.
  const free = await sendDocument(owner, pdf, filename, caption);
  if (free.ok) return "ok";

  // 2. Template utility ber-header DOKUMEN — bebas window 24 jam, tetapi
  //    menunggu status APPROVED dari review Meta.
  const doc = await sendDocumentTemplate(owner, pdf, filename, orderId);
  if (doc.ok) return "ok (template)";

  // 3. Template teks biasa: kabari saja dengan tautan halaman Pesanan Hub
  //    supaya resi tetap bisa dibuka manual.
  const tpl = await sendTemplateParams(owner, NOTIF_TEMPLATE, [
    `Pesanan ${orderId} — resi PDF gagal terkirim otomatis. Buka halaman Pesanan untuk mencetaknya: https://admin.kustoro2026.com/marketplace/tiktok/pesanan`,
  ]);
  if (tpl.ok) return "ok (template teks)";

  return `gagal: ${doc.error ?? "dokumen ditolak"} | template: ${tpl.error ?? "ditolak"}`;
}

/** Kirim resi pesanan tertentu ke WA admin (dipakai tombol manual di
 *  halaman Pesanan). Kembalikan hasil kirim ('ok...' atau 'gagal: ...'). */
export async function sendResiForOrder(
  orderId: string,
): Promise<{ ok: boolean; result: string }> {
  const shops = await listTiktokShopTokens();
  for (const shop of shops) {
    const prep = await prepareShop(shop);
    if (!prep.ok) continue;
    const cred = { cipher: prep.cipher, access_token: prep.access_token };
    const detail = await getTiktokOrderDetail(cred, [orderId]);
    if (!detail.ok) continue;
    const order = detail.orders.find((o) => o.id === orderId);
    if (!order) continue;

    const result = await sendResiPdf(orderId, order, shop.shop_name);
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
      const detail = await getTiktokOrderDetail(cred, [o.order_id]);
      if (!detail.ok) {
        errors.push(`${shop.shop_name}: ${o.order_id}: ${detail.detail}`);
        await recordTiktokOrderFailure(o.order_id, shop.shop_id, `gagal: ${detail.detail}`);
        continue;
      }
      const order = detail.orders.find((d) => d.id === o.order_id);
      if (!order) {
        errors.push(`${shop.shop_name}: ${o.order_id}: detail tidak ditemukan`);
        await recordTiktokOrderFailure(o.order_id, shop.shop_id, "gagal: detail tidak ditemukan");
        continue;
      }

      const result = await sendResiPdf(o.order_id, order, shop.shop_name);
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
