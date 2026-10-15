// Operasi produk Blibli Seller API untuk KTD Hub (toko KTD STORE, KTS-70007).
// Endpoint yang dipakai (service 66; spek lengkap di _blibli-specs/_op-*.json
// pada repo induk):
//  - Product List V3                     POST /proxy/seller/v1/products/filter
//  - Product Variant Pickup Point List V1 POST /proxy/seller/v1/products/{product-sku}/variants/filter
//  - Update Bulk Product V1 (antrian)    POST /proxy/mta/api/businesspartner/v1/product/updateProduct
// Batas: list 25 req/menit, varian 25 req/menit per produk, bulk 25 req/menit
// dan maksimal 100 gdnSku per request. Update bulk ASINKRON — respons hanya
// berisi queueFeedId (permintaan masuk antrian), bukan hasil akhir.
import { randomUUID } from "crypto";
import {
  BLIBLI_API_BASE,
  BLIBLI_CHANNEL_ID,
  BLIBLI_STORE_ID,
  blibliEnv,
  blibliHeaders,
  blibliQuery,
  errorDetail,
  parseBody,
  type BlibliResult,
} from "./blibli";

// ---------- Tipe data produk ----------

/** Status produk untuk filter.state. ACTIVE = aktif & masih ada stok;
 *  OOS = aktif tapi stok habis (tidak ikut bila filter ACTIVE). */
export type BlibliProductState =
  | "ACTIVE"
  | "OOS"
  | "ARCHIVED"
  | "SUSPENDED"
  | "IN_PROGRESS"
  | "NEED_CORRECTION"
  | "REJECTED";

/** Satu produk (tingkat main product) dari Product List V3. */
export type BlibliProductRow = {
  product: {
    code: string; // kode produk Blibli (L1)
    name: string;
    sku: string; // product SKU penjual (L3, "KTS-70007-XXXXX") — kunci varian
    state: string;
    url?: { blibli?: string };
  };
  pickupPointCodes: string[];
  counter: { stock: number; variant: number };
  price: { normal: { min: number; max: number }; sale: { min: number; max: number } };
  category: { code: string; name: string };
  flags: {
    archived?: boolean;
    review?: boolean;
    suspended?: boolean;
    includedInPromoBlibli?: boolean;
    [k: string]: unknown;
  };
  images: { path: string; main?: boolean }[];
  updatedDate: number;
  rejection?: { reason?: string };
  revision?: { notes?: string };
  suspension?: { reason?: string };
};

/** Satu varian (gdnSku) dari Product Variant Pickup Point List V1. */
export type BlibliVariantRow = {
  variant: {
    blibliSku: string; // gdnSku 4 seksi ("KTS-70007-XXXXX-YYYYY") — kunci operasi update
    code: string;
    name: string;
    sellerSku?: string;
    url?: { blibli?: string };
  };
  pickupPoint: { code: string; name: string };
  price: { regular: number; sale: number; notUpdatableReason?: string };
  stock: { seller: { available: number; reserved: number; minimum: number } };
  flags: {
    buyable?: boolean;
    updatable?: boolean;
    priceUpdatable?: boolean;
    [k: string]: unknown;
  };
  product: { code: string; sku: string; type?: number };
  promo?: { blibli?: { price?: { current?: number; min?: number; max?: number } } };
  discount?: { amount?: number; name?: string; percentage?: number };
};

/** Satu baris permintaan update bulk — kirim hanya field yang ingin diubah.
 *  stock = DELTA (+2/-3 relatif stok sekarang); exactStock = nilai persis.
 *  price wajib berpasangan dengan salePrice. */
export type BlibliBulkItemUpdate = {
  gdnSku: string;
  pickupPointCode: string;
  price?: number;
  salePrice?: number;
  stock?: number;
  exactStock?: number;
  buyable?: boolean;
};

export type BlibliProductsFilter = {
  state?: BlibliProductState;
  productName?: string;
  productSku?: string;
  page?: number;
  size?: number;
};

// ---------- Operasi produk ----------

/** Product List V3 — daftar produk tingkat main product (bukan varian).
 *  filter.productName cocok sebagian (contains). size maksimal 50. */
export async function listBlibliProducts(
  filter: BlibliProductsFilter = {},
): Promise<BlibliResult<{ items: BlibliProductRow[]; totalRecord: number }>> {
  const env = blibliEnv();
  if (!env.ready) {
    return { ok: false, detail: "Kredensial Blibli belum diatur (env BLIBLI_*)." };
  }

  try {
    const url = `${BLIBLI_API_BASE}/proxy/seller/v1/products/filter?${blibliQuery()}`;
    const bodyFilter: Record<string, unknown> = {};
    if (filter.state) bodyFilter.state = filter.state;
    if (filter.productName) bodyFilter.productName = filter.productName;
    if (filter.productSku) bodyFilter.productSku = filter.productSku;
    const res = await fetch(url, {
      method: "POST",
      headers: blibliHeaders(),
      cache: "no-store",
      body: JSON.stringify({
        ...(Object.keys(bodyFilter).length > 0 ? { filter: bodyFilter } : {}),
        paging: { page: filter.page ?? 0, size: Math.min(filter.size ?? 50, 50) },
      }),
    });
    const body = await parseBody(res);
    if (!res.ok) {
      return { ok: false, detail: errorDetail("Gagal ambil daftar produk", res, body) };
    }
    const items = (body.content ?? []) as BlibliProductRow[];
    const paging = (body.paging ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      data: { items, totalRecord: Number(paging.totalRecord ?? items.length) },
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

/** Product Variant Pickup Point List V1 — varian produk lengkap dengan harga,
 *  stok, dan pickup point per gdnSku. Ambil semua halaman (maks 5 × 50). */
export async function getBlibliProductVariants(
  productSku: string,
): Promise<BlibliResult<BlibliVariantRow[]>> {
  const env = blibliEnv();
  if (!env.ready) {
    return { ok: false, detail: "Kredensial Blibli belum diatur (env BLIBLI_*)." };
  }

  try {
    const url = `${BLIBLI_API_BASE}/proxy/seller/v1/products/${encodeURIComponent(
      productSku,
    )}/variants/filter?${blibliQuery()}`;
    const items: BlibliVariantRow[] = [];
    for (let page = 0; page < 5; page++) {
      const res = await fetch(url, {
        method: "POST",
        headers: blibliHeaders(),
        cache: "no-store",
        body: JSON.stringify({ paging: { page, size: 50 } }),
      });
      const body = await parseBody(res);
      if (!res.ok) {
        return { ok: false, detail: errorDetail("Gagal ambil varian produk", res, body) };
      }
      const content = (body.content ?? []) as BlibliVariantRow[];
      items.push(...content);
      const paging = (body.paging ?? {}) as Record<string, unknown>;
      const total = Number(paging.totalRecord ?? 0);
      if (items.length >= total) break;
    }
    return { ok: true, data: items };
  } catch (e) {
    return {
      ok: false,
      detail: `Gagal menghubungi server Blibli: ${
        e instanceof Error ? e.message : "kesalahan tidak dikenal"
      }`,
    };
  }
}

/** Update Bulk Product V1 — update massal harga/stok lewat antrian Blibli.
 *  ASINKRON: sukses hanya berarti permintaan masuk antrian; hasil akhir cek
 *  beberapa menit kemudian lewat daftar produk. Maksimal 100 gdnSku. */
export async function updateBlibliProductsBulk(
  requests: BlibliBulkItemUpdate[],
): Promise<BlibliResult<{ queueFeedId: string; total: number; warnings: string[] }>> {
  const env = blibliEnv();
  if (!env.ready) {
    return { ok: false, detail: "Kredensial Blibli belum diatur (env BLIBLI_*)." };
  }
  if (requests.length === 0) {
    return { ok: false, detail: "Tidak ada varian yang dikirim untuk diperbarui." };
  }
  if (requests.length > 100) {
    return { ok: false, detail: "Maksimal 100 varian per permintaan update." };
  }

  try {
    // Endpoint MTA memakai query businessPartnerCode (seperti createPackage)
    // dan kode toko juga dikirim ulang di body merchantCode.
    const qs = new URLSearchParams({
      businessPartnerCode: env.storeCode,
      storeId: String(BLIBLI_STORE_ID),
      channelId: BLIBLI_CHANNEL_ID,
      requestId: `ktd-hub-${randomUUID()}`,
    });
    const url = `${BLIBLI_API_BASE}/proxy/mta/api/businesspartner/v1/product/updateProduct?${qs.toString()}`;
    const res = await fetch(url, {
      method: "POST",
      headers: blibliHeaders(),
      cache: "no-store",
      body: JSON.stringify({
        merchantCode: env.storeCode,
        productRequests: requests,
      }),
    });
    const body = await parseBody(res);
    if (!res.ok) {
      return { ok: false, detail: errorDetail("Gagal perbarui produk", res, body) };
    }
    const value = (body.value ?? {}) as Record<string, unknown>;
    const queueFeedId = String(value.queueFeedId ?? "");
    const warnings = ((body.warningMessage ?? []) as { message?: string }[])
      .map((w) => String(w.message ?? ""))
      .filter((m) => m !== "");
    if (queueFeedId === "") {
      return {
        ok: false,
        detail:
          "Permintaan diterima tetapi queueFeedId tidak dikembalikan — periksa daftar produk beberapa menit lagi.",
      };
    }
    return {
      ok: true,
      data: { queueFeedId, total: Number(value.total ?? requests.length), warnings },
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
