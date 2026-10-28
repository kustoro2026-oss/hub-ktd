// Mesin dokumen cetak resmi TikTok Shop — dipisah dari tiktok-resi.ts
// supaya aneka-exec.ts bisa mengimpor tanpa siklus impor.
import { PDFDocument } from "pdf-lib";
import { listTiktokShopTokens } from "@/lib/db";
import { prepareShop } from "@/lib/tiktok-orders";
import {
  downloadShippingDocument,
  getPackageDetail,
  getPackageHandoverTimeSlots,
  getPackageShippingDocument,
  getTiktokOrderDetail,
  searchPackages,
  shipPackage,
} from "@/lib/tiktok";

/** UTC "YYYY-MM-DD HH:MM:SS" → epoch ms. */
export function parseUtcMs(s: string): number {
  const t = Date.parse(s.replace(" ", "T") + "Z");
  return Number.isFinite(t) ? t : 0;
}

export type ResiDocInfo = {
  type: string;
  label: string;
  size: string;
  reason?: string;
};

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

export type ResiPdfResult =
  | {
      ok: true;
      pdf: Buffer;
      tracking_number: string;
      docs: ResiDocInfo[];
      skipped: ResiDocInfo[];
    }
  | { ok: false; detail: string };

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

async function mergePdfBuffers(buffers: Buffer[]): Promise<Buffer> {
  const out = await PDFDocument.create();
  for (const buf of buffers) {
    const src = await PDFDocument.load(buf, { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const page of pages) out.addPage(page);
  }
  return Buffer.from(await out.save());
}

export async function findPackageIdForOrder(
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

  let pdf = buffers[0];
  if (buffers.length > 1) {
    try {
      pdf = await mergePdfBuffers(buffers);
    } catch {
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

/** Epoch detik (UTC) → "Sen, 05/10 09.00–12.00 WIB". */
export function formatSlotWib(start: number, end: number): string {
  const HARI = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
  const s = new Date((start + 7 * 3600) * 1000);
  const e = new Date((end + 7 * 3600) * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${HARI[s.getUTCDay()]}, ${p(s.getUTCDate())}/${p(s.getUTCMonth() + 1)} ${p(s.getUTCHours())}.${p(s.getUTCMinutes())}–${p(e.getUTCHours())}.${p(e.getUTCMinutes())} WIB`;
}

/** Atur pengiriman untuk satu pesanan (inti, tanpa loop toko). */
async function arrangeShipment(
  cred: { cipher: string; access_token: string },
  orderId: string,
): Promise<{ ok: boolean; result: string }> {
  const pkgId = await findPackageIdForOrder(cred, orderId);
  if (!pkgId.ok) return { ok: false, result: pkgId.detail };
  const packageId = pkgId.packageId;

  const slots = await getPackageHandoverTimeSlots(cred, packageId);
  if (!slots.ok) return { ok: false, result: slots.detail };

  // Alasan slot penjemputan tidak bisa dipakai — dipakai pada pesan
  // kegagalan akhir bila drop-off juga gagal/tidak tersedia.
  let pickupBuntu: string | null = null;

  if (slots.can_pickup) {
    const now = Math.floor(Date.now() / 1000);
    const slot = slots.pickup_slots
      .filter((s) => s.available && s.start_time >= now)
      .sort((a, b) => a.start_time - b.start_time)[0];
    if (slot) {
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
    // Slot penjemputan TIDAK tersedia (penuh/belum rilis) — JANGAN menyerah
    // di sini: jalur drop-off masih mungkin. Peristiwa 28 Okt 2026: order
    // AWAITING_SHIPMENT gagal eksekusi karena slot penjemputan penuh padahal
    // drop-off belum pernah dicoba.
    const next = slots.pickup_slots
      .filter((s) => s.start_time >= now)
      .sort((a, b) => a.start_time - b.start_time)[0];
    pickupBuntu = next
      ? `Tidak ada slot penjemputan tersedia saat ini — slot terdekat ${formatSlotWib(
          next.start_time,
          next.end_time,
        )}`
      : "Tidak ada slot penjemputan yang tersedia saat ini";
  }

  if (slots.can_drop_off) {
    const ship = await shipPackage(cred, packageId, {
      handover_method: "DROP_OFF",
    });
    if (!ship.ok) {
      return {
        ok: false,
        result: pickupBuntu
          ? `${pickupBuntu} — dan drop-off gagal: ${ship.detail}`
          : `Drop-off gagal: ${ship.detail}`,
      };
    }
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
    result:
      pickupBuntu ??
      "Paket ini tidak mendukung pickup maupun drop-off lewat API",
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

/** Ambil dokumen cetak RESMI untuk satu pesanan — persis alur aplikasi:
 *  label belum tersedia + status AWAITING_SHIPMENT → atur pengiriman dulu
 *  (slot tercepat), lalu ambil dokumennya. */
export async function getOfficialResiForCred(
  cred: { cipher: string; access_token: string },
  orderId: string,
): Promise<OfficialResiResult> {
  const direct = await fetchOfficialResiPdf(cred, orderId);
  if (direct.ok) return { ...direct, arranged: false };

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
  if (after.ok) return { ...after, arranged: true };
  // TikTok butuh waktu menyiapkan label SETELAH pengiriman diatur — coba
  // sekali lagi setelah jeda (peristiwa 28 Okt 2026: cetak manual di
  // aplikasi langsung berhasil setelah atur pengiriman, API butuh propagasi).
  await new Promise((r) => setTimeout(r, 15000));
  const after2 = await fetchOfficialResiPdf(cred, orderId);
  if (!after2.ok) return { ok: false, detail: after2.detail };
  return { ...after2, arranged: true };
}

/** Ambil dokumen cetak resmi untuk satu pesanan (loop toko terotorisasi). */
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
