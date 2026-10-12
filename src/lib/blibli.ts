// Klien API Blibli Seller API untuk KTD Hub (toko KTD STORE, KTS-70007).
// Auth: Basic Auth (API Client ID : API Client Key) + header Api-Seller-Key.
// Semua panggilan menyertakan query params storeCode, username, storeId,
// channelId, dan requestId; body POST hanya berisi payload operasional.
// Referensi: seller-api.blibli.com (docs service 66) — spek disimpan di
// _blibli-specs/RINGKASAN-SPEK.md pada repo induk.

import { randomUUID } from "crypto";

export const BLIBLI_API_BASE = "https://api.blibli.com/v2";

// Nilai tetap untuk KTD STORE (dari pendaftaran integrator KUSTORO).
export const BLIBLI_STORE_ID = 10001;
export const BLIBLI_CHANNEL_ID = "KUSTORO";
export const BLIBLI_USERNAME = "info@kustoro2026.com";

/** Kredensial Seller API dari env Vercel/.env.local. */
export function blibliEnv(): {
  storeCode: string;
  clientId: string;
  clientKey: string;
  sellerKey: string;
  ready: boolean;
} {
  const storeCode = process.env.BLIBLI_STORE_CODE ?? "";
  const clientId = process.env.BLIBLI_API_CLIENT_ID ?? "";
  const clientKey = process.env.BLIBLI_API_CLIENT_KEY ?? "";
  const sellerKey = process.env.BLIBLI_API_SELLER_KEY ?? "";
  return {
    storeCode,
    clientId,
    clientKey,
    sellerKey,
    ready:
      storeCode !== "" && clientId !== "" && clientKey !== "" && sellerKey !== "",
  };
}

// ---------- Tipe data pesanan ----------

/** Ambil productSku ("KTS-70007-00811") dari itemSku Blibli
 *  ("KTS-70007-00811-00001" = productSku + indeks varian). Dipakai sebagai
 *  kunci pemetaan — tingkat produk seperti product_id TikTok, sehingga SATU
 *  baris pemetaan menaungi semua varian (warna/ukuran) produk itu. Bila
 *  format tidak dikenali, kembalikan apa adanya. */
export function blibliProductSku(blibliSku: string): string {
  const s = String(blibliSku ?? "").trim();
  // Hanya buang akhiran -XXXXX bila sisanya tetap berbentuk productSku
  // (merchantCode-productCode), mis. KTS-70007-00811-00001 → KTS-70007-00811.
  const m = /^(KTS-\d{5}-\d{5})-\d{5}$/.exec(s);
  return m ? m[1] : s;
}

/** Status item pesanan Blibli:
 *  C = dibuat/bayar, FP = Fraud Pass (pesanan baru utk seller),
 *  PU = Picked Up (menunggu kurir), PF = partial fulfilled,
 *  CR = pembeli minta batal, CX = dalam pengiriman (kirim sendiri),
 *  OS = out of stock, BP = Big Product/BOPIS siap, D = terkirim, X = batal. */
export type BlibliItemStatus =
  | "C"
  | "FP"
  | "PU"
  | "PF"
  | "CR"
  | "CX"
  | "OS"
  | "BP"
  | "D"
  | "X";

export type BlibliOrderItem = {
  createdDate: number; // epoch ms
  order: {
    /** Id ORDER Blibli — satu nomor per pembayaran, SAMA untuk semua item
     *  dalam satu checkout. BUKAN kunci path API detail/pembatalan. */
    id: string;
    /** Id ORDER ITEM Blibli ("Order item number") — unik per baris item;
     *  inilah nilai yang dipakai path API Order Detail V2 & pembatalan.
     *  Terbukti 12 Okt 2026: detail dengan order.id → 500 ERR-PA500023,
     *  dengan order.itemId → 200. */
    itemId: string;
    customerFullName: string;
    type: string; // B2C_RETAIL, OFF2ON, dll.
    quantity: number;
    itemStatus: BlibliItemStatus;
    autoCancelTimestamp?: number;
    statusFPUpdatedTimestamp?: number;
    date: number;
    recipientConfirmationStatus?: string;
  };
  product: {
    sellerSku: string; // kunci pemetaan ke Aneka (satu-satunya yang dikelola seller)
    itemName: string;
    price: number;
    finalPrice: number;
    blibliSku?: string;
    type: number;
  };
  logistic?: {
    productCode: string;
    productName: string;
    awbNumber?: string; // untuk Dropship Cashless, AWB dibuat Blibli (prefix IDB)
    awbValidityStatus?: string;
    optionCode?: string;
    optionName?: string;
    shippingInstruction?: string;
  };
  pickupPoint?: { code: string; name: string };
  flag?: {
    packageCreated?: boolean;
    cashlessHandover?: boolean;
    lateFulfillment?: boolean;
    instantPickup?: boolean;
    sellerPaid?: boolean;
    supportingDocumentExist?: boolean;
    [k: string]: unknown;
  };
  storeCode?: string;
  sellerDeliveryType?: "PICKUP" | "DROPSHIP";
  cashlessStatusUpdateSla?: number;
};

export type BlibliOrderPackage = {
  packageId: string;
  orderItems: BlibliOrderItem[];
  pickupSlaDeadlineTimestamp?: number;
  pendingPickupTimestamp?: number;
};

export type BlibliOrdersFilter = {
  orderItemStatuses?: BlibliItemStatus[];
  statusFPDateRange?: { start: number; end: number }; // epoch ms
  packageCreated?: boolean;
  sellerSku?: string;
  orderOrOrderItemIds?: string[];
  sorting?: {
    by: "statusFPUpdatedTimestamp" | "autoCancelTimestamp";
    direction: "ASC" | "DESC";
  };
  paging?: { page: number; size: number };
};

export type BlibliOrderDetail = {
  id: string; // order item id
  itemId: string;
  packageId?: string;
  quantity: number;
  status: string;
  type?: string;
  product: {
    blibliSku?: string;
    name: string;
    sellerSku?: string;
    notes?: string;
    variantName?: string; // varian yang dipilih pembeli (padanan sku_name TikTok)
    [k: string]: unknown;
  };
  recipient: {
    name: string;
    phoneNumber?: number | string;
    streetAddress?: string;
    city?: string;
    district?: string;
    subdistrict?: string;
    state?: string;
    zipCode?: string;
    email?: string;
    confirmationStatus?: string;
    [k: string]: unknown;
  };
  amount?: {
    item?: number;
    itemBeforePromo?: number;
    itemTotal?: number;
    seller?: number;
    paymentFee?: number;
    shipping?: { cost?: number; insuranceCost?: number };
    [k: string]: unknown;
  };
  flag?: Record<string, unknown>;
  histories?: { actor?: string; status: string; timestamp: number }[];
  timestamp?: { autocancel?: number; statusUpdatedToFP?: number };
  logistic?: Record<string, unknown>;
  shipment?: Record<string, unknown>;
  [k: string]: unknown;
};

export type BlibliResult<T> = { ok: true; data: T } | { ok: false; detail: string };

// ---------- Bantuan HTTP ----------

/** Headers wajib semua panggilan Seller API (Signature opsional, tidak
 *  dipakai karena Signature Key belum diaktifkan di Seller Center). */
function blibliHeaders(): Record<string, string> {
  const env = blibliEnv();
  return {
    Authorization:
      "Basic " +
      Buffer.from(`${env.clientId}:${env.clientKey}`).toString("base64"),
    Accept: "application/json",
    "Content-Type": "application/json",
    "Api-Seller-Key": env.sellerKey,
  };
}

/** Query params standar (storeCode, username, storeId, channelId,
 *  requestId) untuk endpoint proxy seller. */
function blibliQuery(extra: Record<string, string> = {}): string {
  const env = blibliEnv();
  const qs = new URLSearchParams({
    storeCode: env.storeCode,
    username: BLIBLI_USERNAME,
    storeId: String(BLIBLI_STORE_ID),
    channelId: BLIBLI_CHANNEL_ID,
    requestId: `ktd-hub-${randomUUID()}`,
    ...extra,
  });
  return qs.toString();
}

/** Parse body respons; kembalikan pesan error yang bisa ditampilkan. */
async function parseBody(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (text === "") return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { _raw: text.slice(0, 300) };
  }
}

function errorDetail(
  label: string,
  res: Response,
  body: Record<string, unknown>,
): string {
  const msg = String(body.errorMessage ?? body._raw ?? "");
  const code = String(body.errorCode ?? "");
  return `${label}: ${code ? code + " " : ""}${msg || res.status}`;
}

// ---------- Operasi pesanan ----------

/** Order List V2 — POST /proxy/seller/v1/orders/packages/filter.
 *  Respons dikelompokkan per paket; maksimal size 50 dan 100 request/30 menit
 *  per store code. Data tersedia hingga 1 tahun ke belakang. */
export async function listBlibliOrders(
  filter: BlibliOrdersFilter = {},
): Promise<BlibliResult<{ packages: BlibliOrderPackage[]; totalRecord: number }>> {
  const env = blibliEnv();
  if (!env.ready) {
    return {
      ok: false,
      detail: "Kredensial Blibli belum diatur (env BLIBLI_*).",
    };
  }

  try {
    const url = `${BLIBLI_API_BASE}/proxy/seller/v1/orders/packages/filter?${blibliQuery()}`;
    const res = await fetch(url, {
      method: "POST",
      headers: blibliHeaders(),
      cache: "no-store",
      body: JSON.stringify({
        ...(Object.keys(filter).length > 0 ? { ...filter } : {}),
        paging: filter.paging ?? { page: 0, size: 50 },
      }),
    });
    const body = await parseBody(res);
    if (!res.ok) {
      return { ok: false, detail: errorDetail("Gagal ambil daftar pesanan", res, body) };
    }
    const packages = (body.content ?? []) as BlibliOrderPackage[];
    const paging = (body.paging ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      data: { packages, totalRecord: Number(paging.totalRecord ?? packages.length) },
    };
  } catch (e) {
    return {
      ok: false,
      detail: `Gagal menghubungi server Blibli: ${
        e instanceof Error ? e.message : "kesalahan tidak dikenal"
      }`,
    };
  }
}

/** Order Detail V2 — GET /proxy/seller/v1/orders/items/{order-item-id}.
 *  Path memakai order.itemId (Order item number), BUKAN order.id. Per
 *  order item; menyertakan variantName, alamat penerima, riwayat status.
 *  Berlaku untuk SEMUA status (FP, PU, PF, CX, D, X). */
export async function getBlibliOrderDetail(
  orderItemId: string,
): Promise<BlibliResult<BlibliOrderDetail>> {
  const env = blibliEnv();
  if (!env.ready) {
    return { ok: false, detail: "Kredensial Blibli belum diatur (env BLIBLI_*)." };
  }

  try {
    const url = `${BLIBLI_API_BASE}/proxy/seller/v1/orders/items/${encodeURIComponent(
      orderItemId,
    )}?${blibliQuery()}`;
    const res = await fetch(url, {
      method: "GET",
      headers: blibliHeaders(),
      cache: "no-store",
    });
    const body = await parseBody(res);
    if (!res.ok) {
      return { ok: false, detail: errorDetail("Gagal ambil detail pesanan", res, body) };
    }
    const content = (body.content ?? {}) as Record<string, unknown>;
    return { ok: true, data: content as unknown as BlibliOrderDetail };
  } catch (e) {
    return {
      ok: false,
      detail: `Gagal menghubungi server Blibli: ${
        e instanceof Error ? e.message : "kesalahan tidak dikenal"
      }`,
    };
  }
}

/** Download Shipping Label V2 — GET /proxy/seller/v1/orders/{package-id}/shippingLabel.
 *  Label resmi (PDF base64). Untuk DROPSHIP tersedia saat paket dibuat dan
 *  status FP/PU/CX. Maksimal 5 request per packageId per hari. */
export async function getBlibliShippingLabel(
  packageId: string,
): Promise<BlibliResult<{ shippingLabel: string }>> {
  const env = blibliEnv();
  if (!env.ready) {
    return { ok: false, detail: "Kredensial Blibli belum diatur (env BLIBLI_*)." };
  }

  try {
    const url = `${BLIBLI_API_BASE}/proxy/seller/v1/orders/${encodeURIComponent(
      packageId,
    )}/shippingLabel?${blibliQuery()}`;
    const res = await fetch(url, {
      method: "GET",
      headers: blibliHeaders(),
      cache: "no-store",
    });
    const body = await parseBody(res);
    if (!res.ok) {
      return { ok: false, detail: errorDetail("Gagal unduh label pengiriman", res, body) };
    }
    const content = (body.content ?? {}) as Record<string, unknown>;
    const shippingLabel = String(content.shippingLabel ?? "");
    if (shippingLabel === "") {
      return {
        ok: false,
        detail:
          "Label pengiriman kosong — pastikan paket sudah dibuat dan status FP/PU/CX.",
      };
    }
    return { ok: true, data: { shippingLabel } };
  } catch (e) {
    return {
      ok: false,
      detail: `Gagal menghubungi server Blibli: ${
        e instanceof Error ? e.message : "kesalahan tidak dikenal"
      }`,
    };
  }
}

/** Fulfill Regular Order V2 — POST /proxy/seller/v1/orders/regular/{package-id}/fulfill.
 *  Tandai pesanan siap dikirim. Seller DROPSHIP wajib mengisi awbNo (untuk
 *  Dropship Cashless AWB sudah dibuat Blibli di logistic.awbNumber), PICKUP
 *  boleh kosong. Sukses = HTTP 204 tanpa body. Maksimal 5 request/hari per
 *  packageId; DROPSHIP hanya bisa fulfill dalam 12 jam sebelum autocancel. */
export async function fulfillBlibliPackage(
  packageId: string,
  awbNo?: string,
): Promise<BlibliResult<null>> {
  const env = blibliEnv();
  if (!env.ready) {
    return { ok: false, detail: "Kredensial Blibli belum diatur (env BLIBLI_*)." };
  }

  try {
    const url = `${BLIBLI_API_BASE}/proxy/seller/v1/orders/regular/${encodeURIComponent(
      packageId,
    )}/fulfill?${blibliQuery()}`;
    const res = await fetch(url, {
      method: "POST",
      headers: blibliHeaders(),
      cache: "no-store",
      body: JSON.stringify(awbNo && awbNo !== "" ? { awbNo } : {}),
    });
    if (!res.ok) {
      const body = await parseBody(res);
      return { ok: false, detail: errorDetail("Gagal fulfill pesanan", res, body) };
    }
    return { ok: true, data: null };
  } catch (e) {
    return {
      ok: false,
      detail: `Gagal menghubungi server Blibli: ${
        e instanceof Error ? e.message : "kesalahan tidak dikenal"
      }`,
    };
  }
}

/** Update Dropship AWB V2 — PUT /proxy/seller/v1/orders/dropship/{package-id}.
 *  Perbarui nomor AWB semua item dalam satu paket (bila AWB perlu diganti
 *  setelah fulfill). Maksimal 10 request/hari per packageId. */
export async function updateBlibliDropshipAwb(
  packageId: string,
  awbNo: string,
): Promise<BlibliResult<null>> {
  const env = blibliEnv();
  if (!env.ready) {
    return { ok: false, detail: "Kredensial Blibli belum diatur (env BLIBLI_*)." };
  }

  try {
    const url = `${BLIBLI_API_BASE}/proxy/seller/v1/orders/dropship/${encodeURIComponent(
      packageId,
    )}?${blibliQuery()}`;
    const res = await fetch(url, {
      method: "PUT",
      headers: blibliHeaders(),
      cache: "no-store",
      body: JSON.stringify({ awbNo }),
    });
    if (!res.ok) {
      const body = await parseBody(res);
      return { ok: false, detail: errorDetail("Gagal perbarui AWB", res, body) };
    }
    return { ok: true, data: null };
  } catch (e) {
    return {
      ok: false,
      detail: `Gagal menghubungi server Blibli: ${
        e instanceof Error ? e.message : "kesalahan tidak dikenal"
      }`,
    };
  }
}

/** Create Package V1 — POST /proxy/mta/api/businesspartner/v1/order/createPackage.
 *  Gabungkan order item (status FP) menjadi satu paket. Endpoint ini memakai
 *  query businessPartnerCode (bukan storeCode/username) dan dikelola Blibli
 *  sebagai layanan MTA terpisah. */
export async function createBlibliPackage(
  orderItemIds: string[],
): Promise<BlibliResult<{ packageId: string }>> {
  const env = blibliEnv();
  if (!env.ready) {
    return { ok: false, detail: "Kredensial Blibli belum diatur (env BLIBLI_*)." };
  }

  try {
    const qs = new URLSearchParams({
      businessPartnerCode: env.storeCode,
      storeId: String(BLIBLI_STORE_ID),
      channelId: BLIBLI_CHANNEL_ID,
      requestId: `ktd-hub-${randomUUID()}`,
    });
    const url = `${BLIBLI_API_BASE}/proxy/mta/api/businesspartner/v1/order/createPackage?${qs.toString()}`;
    const res = await fetch(url, {
      method: "POST",
      headers: blibliHeaders(),
      cache: "no-store",
      body: JSON.stringify({ orderItemIds }),
    });
    const body = await parseBody(res);
    if (!res.ok) {
      return { ok: false, detail: errorDetail("Gagal buat paket", res, body) };
    }
    const value = (body.value ?? {}) as Record<string, unknown>;
    const packageId = String(value.packageId ?? "");
    if (packageId === "") {
      return { ok: false, detail: "Paket dibuat tetapi packageId tidak dikembalikan." };
    }
    return { ok: true, data: { packageId } };
  } catch (e) {
    return {
      ok: false,
      detail: `Gagal menghubungi server Blibli: ${
        e instanceof Error ? e.message : "kesalahan tidak dikenal"
      }`,
    };
  }
}

/** Order Cancellation Reason V1 — daftar alasan pembatalan resmi Blibli.
 *  Alasan OUT-OF-STOCK/Wrong price/Wrong shipping type/Wrong weight otomatis
 *  membuat stok produk jadi 0. */
export async function getBlibliCancellationReasons(): Promise<
  BlibliResult<{ code: string; description: string }[]>
> {
  const env = blibliEnv();
  if (!env.ready) {
    return { ok: false, detail: "Kredensial Blibli belum diatur (env BLIBLI_*)." };
  }

  try {
    const url = `${BLIBLI_API_BASE}/proxy/seller/v1/orders/items/cancellations/reasons?${blibliQuery()}`;
    const res = await fetch(url, {
      method: "GET",
      headers: blibliHeaders(),
      cache: "no-store",
    });
    const body = await parseBody(res);
    if (!res.ok) {
      return { ok: false, detail: errorDetail("Gagal ambil alasan pembatalan", res, body) };
    }
    return { ok: true, data: (body.content ?? []) as { code: string; description: string }[] };
  } catch (e) {
    return {
      ok: false,
      detail: `Gagal menghubungi server Blibli: ${
        e instanceof Error ? e.message : "kesalahan tidak dikenal"
      }`,
    };
  }
}

/** Cancel and Partial Cancel Order V2 — POST
 *  /proxy/seller/v1/orders/items/{order-item-id}/cancellations.
 *  reason dari API alasan = batal penuh (cancellationQuantity diabaikan);
 *  alasan lain + cancellationQuantity = batal sebagian. */
export async function cancelBlibliOrderItem(
  orderItemId: string,
  reason: string,
  cancellationQuantity?: number,
): Promise<BlibliResult<null>> {
  const env = blibliEnv();
  if (!env.ready) {
    return { ok: false, detail: "Kredensial Blibli belum diatur (env BLIBLI_*)." };
  }

  try {
    const url = `${BLIBLI_API_BASE}/proxy/seller/v1/orders/items/${encodeURIComponent(
      orderItemId,
    )}/cancellations?${blibliQuery()}`;
    const res = await fetch(url, {
      method: "POST",
      headers: blibliHeaders(),
      cache: "no-store",
      body: JSON.stringify({
        reason,
        ...(cancellationQuantity !== undefined && cancellationQuantity > 0
          ? { cancellationQuantity }
          : {}),
      }),
    });
    if (!res.ok) {
      const body = await parseBody(res);
      return { ok: false, detail: errorDetail("Gagal batalkan pesanan", res, body) };
    }
    return { ok: true, data: null };
  } catch (e) {
    return {
      ok: false,
      detail: `Gagal menghubungi server Blibli: ${
        e instanceof Error ? e.message : "kesalahan tidak dikenal"
      }`,
    };
  }
}

/** Delay Fulfillment V1 — POST /proxy/seller/v1/orders/delay-fulfillment.
 *  Perpanjang waktu fulfill +15 menit (alasan: "High traffic order" atau
 *  "Weather conditions"). Setiap packageId hanya bisa ditunda sekali. */
export async function delayBlibliFulfillment(
  packageId: string,
  pickupPointCode: string,
  reason: "High traffic order" | "Weather conditions",
): Promise<BlibliResult<Record<string, unknown>>> {
  const env = blibliEnv();
  if (!env.ready) {
    return { ok: false, detail: "Kredensial Blibli belum diatur (env BLIBLI_*)." };
  }

  try {
    const url = `${BLIBLI_API_BASE}/proxy/seller/v1/orders/delay-fulfillment?${blibliQuery()}`;
    const res = await fetch(url, {
      method: "POST",
      headers: blibliHeaders(),
      cache: "no-store",
      body: JSON.stringify({ packageId, pickupPointCode, reason }),
    });
    const body = await parseBody(res);
    if (!res.ok) {
      return { ok: false, detail: errorDetail("Gagal tunda fulfill", res, body) };
    }
    return { ok: true, data: (body.content ?? {}) as Record<string, unknown> };
  } catch (e) {
    return {
      ok: false,
      detail: `Gagal menghubungi server Blibli: ${
        e instanceof Error ? e.message : "kesalahan tidak dikenal"
      }`,
    };
  }
}
