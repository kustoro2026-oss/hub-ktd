// Klien OAuth & API TikTok Shop (Open API, pasar Indonesia) untuk KTD Hub.
// Satu platform API mengelola TikTok Shop dan Tokopedia (pasca-merger);
// referensi: partner.tiktokshop.com/docv2 (ID market).

import { createHmac } from "crypto";

const AUTH_URL = "https://auth.tiktok-shops.com/api/v2/token/get";
const REFRESH_URL = "https://auth.tiktok-shops.com/api/v2/token/refresh";
const API_HOST = "https://open-api.tiktokglobalshop.com";

export type TiktokTokenResult =
  | {
      ok: true;
      access_token: string;
      refresh_token: string;
      expires_at: string;
      open_id: string;
      shop_id: string;
      shop_name: string;
    }
  | { ok: false; detail: string };

/** Kredensial aplikasi "KTD Hub Pesanan" dari env Vercel/.env.local. */
export function tiktokEnv(): {
  appKey: string;
  appSecret: string;
  ready: boolean;
} {
  const appKey = process.env.TIKTOK_APP_KEY ?? "";
  const appSecret = process.env.TIKTOK_APP_SECRET ?? "";
  return { appKey, appSecret, ready: appKey !== "" && appSecret !== "" };
}

/** Tukar auth_code hasil redirect OAuth menjadi access token.
 *  token/get adalah GET dengan query params (tanpa signature);
 *  grant_type harus persis "authorized_code" dan kode hanya sekali pakai. */
export async function exchangeTiktokAuthCode(
  code: string,
): Promise<TiktokTokenResult> {
  const { appKey, appSecret, ready } = tiktokEnv();
  if (!ready) {
    return {
      ok: false,
      detail:
        "Kredensial aplikasi belum diatur (env TIKTOK_APP_KEY dan TIKTOK_APP_SECRET).",
    };
  }

  const qs = new URLSearchParams({
    app_key: appKey,
    app_secret: appSecret,
    auth_code: code,
    grant_type: "authorized_code",
  });

  try {
    const res = await fetch(`${AUTH_URL}?${qs.toString()}`, {
      method: "GET",
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const d = (data.data ?? {}) as Record<string, unknown>;
    const accessToken = String(d.access_token ?? "");
    if (!res.ok || accessToken === "") {
      return {
        ok: false,
        detail: `Gagal menukar kode otorisasi: ${String(
          data.message ?? res.status,
        )}`,
      };
    }
    // access_token_expire_in = timestamp Unix (detik) kapan token habis;
    // bila nilainya kecil (durasi detik), hitung dari sekarang.
    const expireRaw = Number(d.access_token_expire_in ?? 0);
    const expiresMs =
      expireRaw >= 1e9 ? expireRaw * 1000 : Date.now() + expireRaw * 1000;
    return {
      ok: true,
      access_token: accessToken,
      refresh_token: String(d.refresh_token ?? ""),
      expires_at: new Date(expiresMs || Date.now() + 7 * 86400 * 1000)
        .toISOString()
        .slice(0, 19)
        .replace("T", " "),
      open_id: String(d.open_id ?? ""),
      // token/get tidak mengembalikan shop_id — diisi lewat Get Authorized Shops.
      shop_id: "",
      shop_name: String(d.seller_name ?? ""),
    };
  } catch (e) {
    return {
      ok: false,
      detail: `Gagal menghubungi server TikTok: ${
        e instanceof Error ? e.message : "kesalahan tidak dikenal"
      }`,
    };
  }
}

// ---------- Panggilan business API (butuh signature HMAC-SHA256) ----------

/** Hitung sign request per dokumen "Sign your API request":
 *  input = app_secret + path + (kunci tersortir {key}{value}, tanpa sign &
 *  access_token) + body mentah (bila bukan multipart) + app_secret,
 *  lalu HMAC-SHA256 key=app_secret, output hex huruf kecil. */
function signRequest(
  appSecret: string,
  path: string,
  params: Record<string, string>,
  body = "",
): string {
  const keys = Object.keys(params)
    .filter((k) => k !== "sign" && k !== "access_token")
    .sort();
  const concat = keys.map((k) => `${k}${params[k]}`).join("");
  const input = appSecret + path + concat + body + appSecret;
  return createHmac("sha256", appSecret).update(input).digest("hex");
}

export type TiktokShop = {
  id: string;
  name: string;
  region: string;
  cipher: string;
  code: string;
};

/** GET /authorization/202309/shops — daftar toko yang diotorisasi penjual
 *  untuk aplikasi ini. Butuh scope seller.authorization.info. */
export async function getAuthorizedTiktokShops(
  accessToken: string,
): Promise<{ ok: true; shops: TiktokShop[] } | { ok: false; detail: string }> {
  const { appKey, appSecret, ready } = tiktokEnv();
  if (!ready) {
    return {
      ok: false,
      detail:
        "Kredensial aplikasi belum diatur (env TIKTOK_APP_KEY dan TIKTOK_APP_SECRET).",
    };
  }
  const path = "/authorization/202309/shops";
  const params: Record<string, string> = {
    app_key: appKey,
    timestamp: Math.floor(Date.now() / 1000).toString(),
  };
  const sign = signRequest(appSecret, path, params);
  const qs = new URLSearchParams({ ...params, sign });
  try {
    const res = await fetch(`${API_HOST}${path}?${qs.toString()}`, {
      method: "GET",
      headers: {
        "content-type": "application/json",
        "x-tts-access-token": accessToken,
      },
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as {
      code?: number;
      message?: string;
      data?: { shops?: TiktokShop[] };
    };
    if (!res.ok || (data.code ?? 1) !== 0 || !Array.isArray(data.data?.shops)) {
      return {
        ok: false,
        detail: `Gagal mengambil daftar toko: ${String(
          data.message ?? res.status,
        )}`,
      };
    }
    return { ok: true, shops: data.data?.shops ?? [] };
  } catch (e) {
    return {
      ok: false,
      detail: `Gagal menghubungi server TikTok: ${
        e instanceof Error ? e.message : "kesalahan tidak dikenal"
      }`,
    };
  }
}

export type TiktokRefreshResult =
  | {
      ok: true;
      access_token: string;
      refresh_token: string;
      expires_at: string;
    }
  | { ok: false; detail: string };

/** Perbarui access token dengan refresh token (GET token/refresh). */
export async function refreshTiktokToken(
  refreshToken: string,
): Promise<TiktokRefreshResult> {
  const { appKey, appSecret, ready } = tiktokEnv();
  if (!ready) {
    return {
      ok: false,
      detail:
        "Kredensial aplikasi belum diatur (env TIKTOK_APP_KEY dan TIKTOK_APP_SECRET).",
    };
  }
  const qs = new URLSearchParams({
    app_key: appKey,
    app_secret: appSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  try {
    const res = await fetch(`${REFRESH_URL}?${qs.toString()}`, {
      method: "GET",
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const d = (data.data ?? {}) as Record<string, unknown>;
    const accessToken = String(d.access_token ?? "");
    if (!res.ok || accessToken === "") {
      return {
        ok: false,
        detail: `Gagal memperbarui token: ${String(
          data.message ?? res.status,
        )}`,
      };
    }
    const expireRaw = Number(d.access_token_expire_in ?? 0);
    const expiresMs =
      expireRaw >= 1e9 ? expireRaw * 1000 : Date.now() + expireRaw * 1000;
    return {
      ok: true,
      access_token: accessToken,
      refresh_token: String(d.refresh_token ?? refreshToken),
      expires_at: new Date(expiresMs || Date.now() + 7 * 86400 * 1000)
        .toISOString()
        .slice(0, 19)
        .replace("T", " "),
    };
  } catch (e) {
    return {
      ok: false,
      detail: `Gagal menghubungi server TikTok: ${
        e instanceof Error ? e.message : "kesalahan tidak dikenal"
      }`,
    };
  }
}

export type TiktokOrderSummary = {
  order_id: string;
  order_status: string;
  create_time: number;
  update_time: number;
  items: {
    product_id: string;
    sku_id: string;
    product_name: string;
    sku_count: number;
  }[];
};

/** POST /order/202309/orders/search — daftar pesanan terbaru toko.
 *  page_size/sort_field/sort_order ada di QUERY; filter waktu di body. */
export async function getTiktokOrders(
  shop: { cipher: string; access_token: string },
  daysBack = 7,
): Promise<
  { ok: true; orders: TiktokOrderSummary[]; total_count: number } | { ok: false; detail: string }
> {
  const { appKey, appSecret, ready } = tiktokEnv();
  if (!ready) {
    return {
      ok: false,
      detail:
        "Kredensial aplikasi belum diatur (env TIKTOK_APP_KEY dan TIKTOK_APP_SECRET).",
    };
  }
  if (shop.cipher === "") {
    return {
      ok: false,
      detail: "shop_cipher belum tersimpan — coba otorisasi ulang aplikasi.",
    };
  }
  const path = "/order/202309/orders/search";
  const now = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({
    update_time_ge: now - daysBack * 86400,
    update_time_lt: now,
  });
  const params: Record<string, string> = {
    app_key: appKey,
    shop_cipher: shop.cipher,
    timestamp: now.toString(),
    page_size: "20",
    sort_field: "update_time",
    sort_order: "DESC",
  };
  const sign = signRequest(appSecret, path, params, body);
  const qs = new URLSearchParams({ ...params, sign });
  try {
    const res = await fetch(`${API_HOST}${path}?${qs.toString()}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tts-access-token": shop.access_token,
      },
      body,
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as {
      code?: number;
      message?: string;
      data?: { orders?: unknown[]; total_count?: number };
    };
    if (!res.ok || (data.code ?? 1) !== 0) {
      return {
        ok: false,
        detail: `Gagal mengambil pesanan: ${String(
          data.message ?? res.status,
        )}`,
      };
    }
    const orders: TiktokOrderSummary[] = (data.data?.orders ?? []).map(
      (o) => {
        const r = o as Record<string, unknown>;
        const lines = (r.line_items as unknown[] | undefined) ?? [];
        return {
          order_id: String(r.id ?? ""),
          order_status: String(r.status ?? ""),
          create_time: Number(r.create_time ?? 0),
          update_time: Number(r.update_time ?? 0),
          items: lines.map((it) => {
            const i = it as Record<string, unknown>;
            const combos =
              (i.combined_listing_skus as Record<string, unknown>[] |
                undefined) ?? [];
            let qty = Number(i.sku_count ?? 0);
            if (!qty && combos.length > 0) {
              qty = combos.reduce(
                (acc, c) =>
                  acc + Number((c as Record<string, unknown>).sku_count ?? 0),
                0,
              );
            }
            if (!qty) qty = 1;
            return {
              product_id: String(i.product_id ?? ""),
              sku_id: String(i.sku_id ?? ""),
              product_name: String(i.product_name ?? ""),
              sku_count: qty,
            };
          }),
        };
      },
    );
    return {
      ok: true,
      orders,
      total_count: Number(data.data?.total_count ?? orders.length),
    };
  } catch (e) {
    return {
      ok: false,
      detail: `Gagal menghubungi server TikTok: ${
        e instanceof Error ? e.message : "kesalahan tidak dikenal"
      }`,
    };
  }
}

// ---------- Detail pesanan (untuk cetak resi) ----------

export type TiktokOrderDetail = {
  id: string;
  status: string;
  create_time: number;
  paid_time: number;
  update_time: number;
  commerce_platform: string;
  fulfillment_type: string;
  shipping_type: string;
  delivery_type: string;
  shipping_provider: string;
  tracking_number: string;
  payment_method_name: string;
  is_cod: boolean;
  buyer_message: string;
  user_id: string;
  buyer_nickname: string;
  payment: {
    currency: string;
    sub_total: string;
    shipping_fee: string;
    seller_discount: string;
    platform_discount: string;
    total_amount: string;
    buyer_service_fee: string;
    shipping_insurance_fee: string;
    distance_shipping_fee: string;
  };
  recipient_address: {
    full_address: string;
    name: string;
    phone_number: string;
    region_code: string;
    postal_code: string;
    address_detail: string;
    district_info: { address_level_name: string; address_name: string }[];
  } | null;
  line_items: {
    id: string;
    product_id: string;
    sku_id: string;
    product_name: string;
    sku_name: string;
    seller_sku: string;
    original_price: string;
    sale_price: string;
    seller_discount: string;
    platform_discount: string;
    currency: string;
    tracking_number: string;
    shipping_provider_name: string;
    combined_listing_skus: { sku_count: number }[];
  }[];
  /** Paket yang sudah dibuat untuk pesanan ini (id + nomor resi kurir). */
  package_list: { id: string; tracking_number: string }[];
};

function str(v: unknown): string {
  return String(v ?? "");
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function parseDetailItem(
  r: Record<string, unknown>,
): TiktokOrderDetail["line_items"][number] {
  const combos =
    (r.combined_listing_skus as Record<string, unknown>[] | undefined) ?? [];
  return {
    id: str(r.id),
    product_id: str(r.product_id),
    sku_id: str(r.sku_id),
    product_name: str(r.product_name),
    sku_name: str(r.sku_name),
    seller_sku: str(r.seller_sku),
    original_price: str(r.original_price),
    sale_price: str(r.sale_price),
    seller_discount: str(r.seller_discount),
    platform_discount: str(r.platform_discount),
    currency: str(r.currency),
    tracking_number: str(r.tracking_number),
    shipping_provider_name: str(r.shipping_provider_name),
    combined_listing_skus: combos.map((c) => ({
      sku_count: num((c as Record<string, unknown>).sku_count),
    })),
  };
}

function parseDetail(o: Record<string, unknown>): TiktokOrderDetail {
  const p = (o.payment ?? {}) as Record<string, unknown>;
  const addr = (o.recipient_address ?? null) as Record<string, unknown> | null;
  const dist =
    (addr?.district_info as Record<string, unknown>[] | undefined) ?? [];
  const lines = (o.line_items as unknown[] | undefined) ?? [];
  // Nama field paket di respons Get Order Detail adalah `packages` (bukan
  // package_list — salah membaca ini pernah membuat "paket belum dibuat").
  const pkgs = ((o.packages ?? o.package_list) as
    | Record<string, unknown>[]
    | undefined) ?? [];
  return {
    id: str(o.id),
    status: str(o.status),
    create_time: num(o.create_time),
    paid_time: num(o.paid_time),
    update_time: num(o.update_time),
    commerce_platform: str(o.commerce_platform),
    fulfillment_type: str(o.fulfillment_type),
    shipping_type: str(o.shipping_type),
    delivery_type: str(o.delivery_type),
    shipping_provider: str(o.shipping_provider),
    tracking_number: str(o.tracking_number),
    payment_method_name: str(o.payment_method_name),
    is_cod: Boolean(o.is_cod),
    buyer_message: str(o.buyer_message),
    user_id: str(o.user_id),
    buyer_nickname: str(o.buyer_nickname),
    payment: {
      currency: str(p.currency),
      sub_total: str(p.sub_total),
      shipping_fee: str(p.shipping_fee),
      seller_discount: str(p.seller_discount),
      platform_discount: str(p.platform_discount),
      total_amount: str(p.total_amount),
      buyer_service_fee: str(p.buyer_service_fee),
      shipping_insurance_fee: str(p.shipping_insurance_fee),
      distance_shipping_fee: str(p.distance_shipping_fee),
    },
    recipient_address: addr
      ? {
          full_address: str(addr.full_address),
          name: str(addr.name),
          phone_number: str(addr.phone_number),
          region_code: str(addr.region_code),
          postal_code: str(addr.postal_code),
          address_detail: str(addr.address_detail),
          district_info: dist.map((d) => ({
            address_level_name: str(
              (d as Record<string, unknown>).address_level_name,
            ),
            address_name: str((d as Record<string, unknown>).address_name),
          })),
        }
      : null,
    line_items: lines.map((it) =>
      parseDetailItem(it as Record<string, unknown>),
    ),
    package_list: pkgs.map((pk) => ({
      id: str(pk.id),
      tracking_number: str(pk.tracking_number),
    })),
  };
}

/** GET /order/202309/orders?ids=... — detail lengkap satu/beberapa pesanan
 *  (alamat penerima, pembayaran, item + harga). Maks. 50 ID per panggilan. */
export async function getTiktokOrderDetail(
  shop: { cipher: string; access_token: string },
  orderIds: string[],
): Promise<
  { ok: true; orders: TiktokOrderDetail[] } | { ok: false; detail: string }
> {
  const { appKey, appSecret, ready } = tiktokEnv();
  if (!ready) {
    return {
      ok: false,
      detail:
        "Kredensial aplikasi belum diatur (env TIKTOK_APP_KEY dan TIKTOK_APP_SECRET).",
    };
  }
  if (shop.cipher === "") {
    return {
      ok: false,
      detail: "shop_cipher belum tersimpan — coba otorisasi ulang aplikasi.",
    };
  }
  const path = "/order/202309/orders";
  const now = Math.floor(Date.now() / 1000);
  const params: Record<string, string> = {
    app_key: appKey,
    shop_cipher: shop.cipher,
    timestamp: now.toString(),
    ids: orderIds.slice(0, 50).join(","),
  };
  const sign = signRequest(appSecret, path, params);
  const qs = new URLSearchParams({ ...params, sign });
  try {
    const res = await fetch(`${API_HOST}${path}?${qs.toString()}`, {
      method: "GET",
      headers: {
        "content-type": "application/json",
        "x-tts-access-token": shop.access_token,
      },
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as {
      code?: number;
      message?: string;
      data?: { orders?: unknown[] };
    };
    if (!res.ok || (data.code ?? 1) !== 0) {
      return {
        ok: false,
        detail: `Gagal mengambil detail pesanan: ${String(
          data.message ?? res.status,
        )}`,
      };
    }
    const orders = (data.data?.orders ?? []).map((o) =>
      parseDetail(o as Record<string, unknown>),
    );
    return { ok: true, orders };
  } catch (e) {
    return {
      ok: false,
      detail: `Gagal menghubungi server TikTok: ${
        e instanceof Error ? e.message : "kesalahan tidak dikenal"
      }`,
    };
  }
}

// ---------- Dokumen pengiriman resmi (label kirim "Cetak Resi") ----------

export type TiktokShippingDocumentResult =
  | { ok: true; doc_url: string; tracking_number: string }
  | { ok: false; detail: string };

/** GET /fulfillment/202309/packages/{package_id}/shipping_documents — jalur
 *  cadangan dokumen resmi per paket (butuh paket sudah diatur kirimnya).
 *  documentType: SHIPPING_LABEL / PACKING_SLIP / PICKUP_LIST / ...
 *  documentSize: A6 / A5 (ukuran kertas hasil cetak). */
export async function getPackageShippingDocument(
  shop: { cipher: string; access_token: string },
  packageId: string,
  documentType = "SHIPPING_LABEL",
  documentSize = "A6",
): Promise<TiktokShippingDocumentResult> {
  const { appKey, appSecret, ready } = tiktokEnv();
  if (!ready || shop.cipher === "") {
    return {
      ok: false,
      detail: "Kredensial aplikasi atau shop_cipher belum lengkap",
    };
  }
  const path = `/fulfillment/202309/packages/${packageId}/shipping_documents`;
  const params: Record<string, string> = {
    app_key: appKey,
    shop_cipher: shop.cipher,
    timestamp: Math.floor(Date.now() / 1000).toString(),
    document_type: documentType,
    document_size: documentSize,
  };
  const sign = signRequest(appSecret, path, params);
  const qs = new URLSearchParams({ ...params, sign });
  try {
    const res = await fetch(`${API_HOST}${path}?${qs.toString()}`, {
      method: "GET",
      headers: {
        "content-type": "application/json",
        "x-tts-access-token": shop.access_token,
      },
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as {
      code?: number;
      message?: string;
      data?: { doc_url?: string; tracking_number?: string };
    };
    if (!res.ok || (data.code ?? 1) !== 0) {
      return {
        ok: false,
        detail: `Gagal mengambil dokumen paket: ${String(
          data.message ?? res.status,
        )}`,
      };
    }
    const docUrl = String(data.data?.doc_url ?? "");
    if (docUrl === "") {
      return { ok: false, detail: "Dokumen paket belum tersedia" };
    }
    return {
      ok: true,
      doc_url: docUrl,
      tracking_number: String(data.data?.tracking_number ?? ""),
    };
  } catch (e) {
    return {
      ok: false,
      detail: `Gagal menghubungi server TikTok: ${
        e instanceof Error ? e.message : "kesalahan tidak dikenal"
      }`,
    };
  }
}

/** Unduh isi PDF dokumen pengiriman resmi dari doc_url (berlaku 24 jam). */
export async function downloadShippingDocument(
  docUrl: string,
): Promise<{ ok: true; pdf: Buffer } | { ok: false; detail: string }> {
  try {
    const res = await fetch(docUrl, { cache: "no-store" });
    if (!res.ok) {
      return {
        ok: false,
        detail: `Gagal mengunduh dokumen (HTTP ${res.status})`,
      };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) {
      return { ok: false, detail: "Dokumen yang diunduh kosong/rusak" };
    }
    return { ok: true, pdf: buf };
  } catch (e) {
    return {
      ok: false,
      detail: `Gagal mengunduh dokumen: ${
        e instanceof Error ? e.message : "kesalahan tidak dikenal"
      }`,
    };
  }
}

/** Satu slot waktu penjemputan (Unix detik). */
export type TiktokPickupSlot = {
  start_time: number;
  end_time: number;
  available: boolean;
};

/** GET /fulfillment/202309/packages/{package_id}/handover_time_slots — daftar
 *  slot penjemputan/drop-off yang tersedia untuk satu paket (persis daftar jam
 *  di menu "Atur Pengiriman" aplikasi TikTok Shop). */
export async function getPackageHandoverTimeSlots(
  shop: { cipher: string; access_token: string },
  packageId: string,
): Promise<
  | {
      ok: true;
      can_pickup: boolean;
      can_drop_off: boolean;
      drop_off_point_url: string;
      pickup_slots: TiktokPickupSlot[];
    }
  | { ok: false; detail: string }
> {
  const { appKey, appSecret, ready } = tiktokEnv();
  if (!ready || shop.cipher === "") {
    return {
      ok: false,
      detail: "Kredensial aplikasi atau shop_cipher belum lengkap",
    };
  }
  const path = `/fulfillment/202309/packages/${packageId}/handover_time_slots`;
  const params: Record<string, string> = {
    app_key: appKey,
    shop_cipher: shop.cipher,
    timestamp: Math.floor(Date.now() / 1000).toString(),
  };
  const sign = signRequest(appSecret, path, params);
  const qs = new URLSearchParams({ ...params, sign });
  try {
    const res = await fetch(`${API_HOST}${path}?${qs.toString()}`, {
      method: "GET",
      headers: {
        "content-type": "application/json",
        "x-tts-access-token": shop.access_token,
      },
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as {
      code?: number;
      message?: string;
      data?: {
        can_pickup?: boolean;
        can_drop_off?: boolean;
        drop_off_point_url?: string;
        pickup_slots?: {
          start_time?: number;
          end_time?: number;
          avaliable?: boolean;
          available?: boolean;
        }[];
      };
    };
    if (!res.ok || (data.code ?? 1) !== 0) {
      return {
        ok: false,
        detail: `Gagal mengambil slot penjemputan: ${String(
          data.message ?? res.status,
        )}`,
      };
    }
    return {
      ok: true,
      can_pickup: Boolean(data.data?.can_pickup),
      can_drop_off: Boolean(data.data?.can_drop_off),
      drop_off_point_url: String(data.data?.drop_off_point_url ?? ""),
      pickup_slots: (data.data?.pickup_slots ?? []).map((s) => ({
        start_time: Number(s.start_time ?? 0),
        end_time: Number(s.end_time ?? 0),
        available: Boolean(s.avaliable ?? s.available ?? true),
      })),
    };
  } catch (e) {
    return {
      ok: false,
      detail: `Gagal menghubungi server TikTok: ${
        e instanceof Error ? e.message : "kesalahan tidak dikenal"
      }`,
    };
  }
}

/** POST /fulfillment/202309/packages/{package_id}/ship — atur pengiriman
 *  paket (jadwalkan penjemputan PICKUP atau DROP_OFF), sama seperti tombol
 *  "Atur Pengiriman" di aplikasi TikTok Shop. */
export async function shipPackage(
  shop: { cipher: string; access_token: string },
  packageId: string,
  opts: {
    handover_method: "PICKUP" | "DROP_OFF";
    pickup_slot?: { start_time: number; end_time: number };
  },
): Promise<{ ok: boolean; detail: string }> {
  const { appKey, appSecret, ready } = tiktokEnv();
  if (!ready || shop.cipher === "") {
    return {
      ok: false,
      detail: "Kredensial aplikasi atau shop_cipher belum lengkap",
    };
  }
  const path = `/fulfillment/202309/packages/${packageId}/ship`;
  const body = JSON.stringify({
    handover_method: opts.handover_method,
    pickup_slot: opts.pickup_slot,
  });
  const params: Record<string, string> = {
    app_key: appKey,
    shop_cipher: shop.cipher,
    timestamp: Math.floor(Date.now() / 1000).toString(),
  };
  const sign = signRequest(appSecret, path, params, body);
  const qs = new URLSearchParams({ ...params, sign });
  try {
    const res = await fetch(`${API_HOST}${path}?${qs.toString()}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tts-access-token": shop.access_token,
      },
      body,
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as {
      code?: number;
      message?: string;
    };
    if (!res.ok || (data.code ?? 1) !== 0) {
      return {
        ok: false,
        detail: `Gagal mengatur pengiriman: ${String(
          data.message ?? res.status,
        )}`,
      };
    }
    return { ok: true, detail: String(data.message ?? "Success") };
  } catch (e) {
    return {
      ok: false,
      detail: `Gagal menghubungi server TikTok: ${
        e instanceof Error ? e.message : "kesalahan tidak dikenal"
      }`,
    };
  }
}

/** GET /fulfillment/202309/packages/{package_id} — detail paket: status,
 *  nomor resi, dan slot penjemputan yang sudah dijadwalkan. */
export async function getPackageDetail(
  shop: { cipher: string; access_token: string },
  packageId: string,
): Promise<
  | {
      ok: true;
      package_status: string;
      package_sub_status: string;
      shipping_type: string;
      tracking_number: string;
      handover_method: string;
      pickup_slot: TiktokPickupSlot | null;
    }
  | { ok: false; detail: string }
> {
  const { appKey, appSecret, ready } = tiktokEnv();
  if (!ready || shop.cipher === "") {
    return {
      ok: false,
      detail: "Kredensial aplikasi atau shop_cipher belum lengkap",
    };
  }
  const path = `/fulfillment/202309/packages/${packageId}`;
  const params: Record<string, string> = {
    app_key: appKey,
    shop_cipher: shop.cipher,
    timestamp: Math.floor(Date.now() / 1000).toString(),
  };
  const sign = signRequest(appSecret, path, params);
  const qs = new URLSearchParams({ ...params, sign });
  try {
    const res = await fetch(`${API_HOST}${path}?${qs.toString()}`, {
      method: "GET",
      headers: {
        "content-type": "application/json",
        "x-tts-access-token": shop.access_token,
      },
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as {
      code?: number;
      message?: string;
      data?: {
        package_status?: string;
        package_sub_status?: string;
        shipping_type?: string;
        tracking_number?: string;
        handover_method?: string;
        pickup_slot?: { start_time?: number; end_time?: number };
      };
    };
    if (!res.ok || (data.code ?? 1) !== 0) {
      return {
        ok: false,
        detail: `Gagal mengambil detail paket: ${String(
          data.message ?? res.status,
        )}`,
      };
    }
    const slot = data.data?.pickup_slot;
    return {
      ok: true,
      package_status: String(data.data?.package_status ?? ""),
      package_sub_status: String(data.data?.package_sub_status ?? ""),
      shipping_type: String(data.data?.shipping_type ?? ""),
      tracking_number: String(data.data?.tracking_number ?? ""),
      handover_method: String(data.data?.handover_method ?? ""),
      pickup_slot: slot
        ? {
            start_time: Number(slot.start_time ?? 0),
            end_time: Number(slot.end_time ?? 0),
            available: true,
          }
        : null,
    };
  } catch (e) {
    return {
      ok: false,
      detail: `Gagal menghubungi server TikTok: ${
        e instanceof Error ? e.message : "kesalahan tidak dikenal"
      }`,
    };
  }
}

/** Ringkasan satu paket hasil pencarian. */
export type TiktokPackageSummary = {
  id: string;
  order_ids: string[];
  status: string;
  tracking_number: string;
};

/** POST /fulfillment/202309/packages/search — cari paket berdasarkan jendela
 *  waktu dibuat/diperbarui (dan opsional status). Dipakai untuk menemukan
 *  package_id sebuah pesanan ketika detail pesanan tidak menyertakan daftar
 *  paket. */
export async function searchPackages(
  shop: { cipher: string; access_token: string },
  opts: {
    create_time_ge?: number;
    create_time_lt?: number;
    update_time_ge?: number;
    update_time_lt?: number;
    package_status?: string;
  },
): Promise<
  | { ok: true; packages: TiktokPackageSummary[]; total_count: number }
  | { ok: false; detail: string }
> {
  const { appKey, appSecret, ready } = tiktokEnv();
  if (!ready || shop.cipher === "") {
    return {
      ok: false,
      detail: "Kredensial aplikasi atau shop_cipher belum lengkap",
    };
  }
  const path = "/fulfillment/202309/packages/search";
  const body = JSON.stringify({
    ...(opts.create_time_ge !== undefined
      ? { create_time_ge: opts.create_time_ge }
      : {}),
    ...(opts.create_time_lt !== undefined
      ? { create_time_lt: opts.create_time_lt }
      : {}),
    ...(opts.update_time_ge !== undefined
      ? { update_time_ge: opts.update_time_ge }
      : {}),
    ...(opts.update_time_lt !== undefined
      ? { update_time_lt: opts.update_time_lt }
      : {}),
    ...(opts.package_status ? { package_status: opts.package_status } : {}),
  });
  const params: Record<string, string> = {
    app_key: appKey,
    shop_cipher: shop.cipher,
    timestamp: Math.floor(Date.now() / 1000).toString(),
    page_size: "50",
    sort_field: "update_time",
    sort_order: "DESC",
  };
  const sign = signRequest(appSecret, path, params, body);
  const qs = new URLSearchParams({ ...params, sign });
  try {
    const res = await fetch(`${API_HOST}${path}?${qs.toString()}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tts-access-token": shop.access_token,
      },
      body,
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as {
      code?: number;
      message?: string;
      data?: {
        packages?: {
          id?: string;
          orders?: { id?: string }[];
          status?: string;
          tracking_number?: string;
        }[];
        total_count?: number;
      };
    };
    if (!res.ok || (data.code ?? 1) !== 0) {
      return {
        ok: false,
        detail: `Gagal mencari paket: ${String(data.message ?? res.status)}`,
      };
    }
    return {
      ok: true,
      total_count: Number(data.data?.total_count ?? 0),
      packages: (data.data?.packages ?? []).map((p) => ({
        id: String(p.id ?? ""),
        order_ids: (p.orders ?? []).map((o) => String(o.id ?? "")),
        status: String(p.status ?? ""),
        tracking_number: String(p.tracking_number ?? ""),
      })),
    };
  } catch (e) {
    return {
      ok: false,
      detail: `Gagal menghubungi server TikTok: ${
        e instanceof Error ? e.message : "kesalahan tidak dikenal"
      }`,
    };
  }
}
