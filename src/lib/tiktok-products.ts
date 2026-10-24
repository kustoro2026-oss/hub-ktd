// Klien API produk TikTok Shop (Open API, pasar Indonesia) untuk KTD Hub.
// Endpoint diverifikasi dari dokumen resmi Partner Center (docv2):
//  - POST /product/202502/products/search          → daftar produk, scope
//    Product Basic (seller.product.basic). Versi 202309 tidak lagi
//    didokumentasikan.
//  - GET  /product/202309/products/{product_id}    → detail produk + SKU
//    (harga, stok, gudang), scope Product Basic.
//  - POST /product/202309/products/{id}/prices/update     → ubah harga
//    beberapa SKU sekaligus, scope Product Modify (seller.product.write).
//  - POST /product/202309/products/{id}/inventory/update  → ubah stok
//    (wajib kirim SEMUA gudang tiap SKU), scope Product Modify.
// Catatan pasar Indonesia: harga lokal satu nilai (price.amount IDR) tanpa
// sale_price; stok per gudang minimal 1 dan maksimal 99.999.
import { API_HOST, signRequest, tiktokEnv } from "@/lib/tiktok";

/** Konteks toko siap pakai: cipher + access token valid. */
export type TiktokShopCtx = { cipher: string; access_token: string };

// ---------- Tipe data ----------

export type TiktokSkuInventory = {
  warehouseId: string;
  quantity: number;
  backorderQuantity: number;
  handlingTime: number;
};

export type TiktokSkuRow = {
  id: string;
  sellerSku: string;
  price: {
    currency: string;
    /** Harga tampilan (sale_price bila > 0, selain itu tax_exclusive). */
    display: number;
    salePrice: number;
    taxExclusivePrice: number;
  };
  inventory: TiktokSkuInventory[];
  statusInfo: { status: string; deactivationSource: string };
};

export type TiktokProductRow = {
  id: string;
  title: string;
  /** Status gabungan produk+audit; untuk toko Indonesia bisa kosong —
   *  fallback ke productStatus. */
  status: string;
  productStatus: string;
  createTime: number;
  updateTime: number;
  hasDraft: boolean;
  isNotForSale: boolean;
  salesRegions: string[];
  auditStatus: string;
  skus: TiktokSkuRow[];
};

function str(v: unknown): string {
  return String(v ?? "");
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function parseSkuRow(r: Record<string, unknown>): TiktokSkuRow {
  const price = (r.price ?? {}) as Record<string, unknown>;
  const statusInfo = (r.status_info ?? {}) as Record<string, unknown>;
  const inventory = ((r.inventory ?? []) as Record<string, unknown>[]).map(
    (i) => ({
      warehouseId: str(i.warehouse_id),
      quantity: num(i.quantity),
      backorderQuantity: num(i.backorder_quantity),
      handlingTime: num(i.handling_time),
    }),
  );
  const salePrice = num(price.sale_price);
  const taxExclusivePrice = num(price.tax_exclusive_price);
  return {
    id: str(r.id),
    sellerSku: str(r.seller_sku),
    price: {
      currency: str(price.currency),
      display: salePrice > 0 ? salePrice : taxExclusivePrice,
      salePrice,
      taxExclusivePrice,
    },
    inventory,
    statusInfo: {
      status: str(statusInfo.status),
      deactivationSource: str(statusInfo.deactivation_source),
    },
  };
}

function parseProductRow(r: Record<string, unknown>): TiktokProductRow {
  const audit = (r.audit ?? {}) as Record<string, unknown>;
  return {
    id: str(r.id),
    title: str(r.title),
    status: str(r.status),
    productStatus: str(r.product_status),
    createTime: num(r.create_time),
    updateTime: num(r.update_time),
    hasDraft: Boolean(r.has_draft),
    isNotForSale: Boolean(r.is_not_for_sale),
    salesRegions: ((r.sales_regions ?? []) as unknown[]).map(str),
    auditStatus: str(audit.status),
    skus: ((r.skus ?? []) as Record<string, unknown>[]).map(parseSkuRow),
  };
}

// ---------- Daftar produk ----------

export type TiktokProductFilter = {
  status?: string;
  pageSize?: number;
  pageToken?: string;
};

export type TiktokSearchResult =
  | {
      ok: true;
      items: TiktokProductRow[];
      totalCount: number;
      nextPageToken: string;
    }
  | { ok: false; detail: string };

/** POST /product/202502/products/search — daftar produk toko. API produk
 *  TikTok tidak mendukung filter judul, jadi pencarian judul dilakukan
 *  dengan memindai halaman lalu menyaring di sisi KTD Hub. */
export async function searchTiktokProducts(
  shop: TiktokShopCtx,
  filter: TiktokProductFilter = {},
): Promise<TiktokSearchResult> {
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
  const path = "/product/202502/products/search";
  const body = JSON.stringify({
    status: filter.status ?? "ALL",
    locale: "id-ID",
  });
  const params: Record<string, string> = {
    app_key: appKey,
    shop_cipher: shop.cipher,
    timestamp: Math.floor(Date.now() / 1000).toString(),
    page_size: String(Math.min(Math.max(filter.pageSize ?? 50, 1), 100)),
    ...(filter.pageToken ? { page_token: filter.pageToken } : {}),
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
        total_count?: number;
        next_page_token?: string;
        products?: unknown[];
      };
    };
    if (!res.ok || (data.code ?? 1) !== 0) {
      return {
        ok: false,
        detail: `Gagal mengambil daftar produk: ${String(
          data.message ?? res.status,
        )}`,
      };
    }
    const items = ((data.data?.products ?? []) as Record<string, unknown>[]).map(
      parseProductRow,
    );
    return {
      ok: true,
      items,
      totalCount: Number(data.data?.total_count ?? items.length),
      nextPageToken: String(data.data?.next_page_token ?? ""),
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

// ---------- Saring produk aktif ----------

/** Hasil penyaringan produk terhadap daftar toko live. */
export type ActiveProductFilterResult =
  | { ok: true; valid: string[]; invalid: string[] }
  | { ok: false; detail: string };

/** Periksa ID produk terhadap daftar produk toko yang masih aktif
 *  (status ACTIVATE dan dijual). Dipakai pengundang otomatis supaya produk
 *  yang terhapus/ternonaktifkan tidak membuat TikTok membalas 200 tanpa
 *  membuat kolaborasi (kegagalan senyap). Berhenti lebih awal bila semua
 *  ID yang dicari sudah ditemukan. */
export async function filterActiveProductIds(
  ctx: TiktokShopCtx,
  ids: string[],
): Promise<ActiveProductFilterResult> {
  const wanted = [...new Set(ids.filter((s) => s !== ""))];
  if (wanted.length === 0) return { ok: true, valid: [], invalid: [] };
  const statusById = new Map<string, { active: boolean }>();
  let pageToken = "";
  for (let p = 0; p < 10; p += 1) {
    if (p > 0) await new Promise((r) => setTimeout(r, 2000));
    const res = await searchTiktokProducts(ctx, {
      pageSize: 100,
      pageToken: pageToken || undefined,
    });
    if (!res.ok) {
      // Halaman pertama gagal = daftar produk tidak bisa dibaca sama sekali.
      if (p === 0) return { ok: false, detail: res.detail };
      break; // halaman lanjutan gagal — lanjut dengan yang sudah terkumpul.
    }
    for (const it of res.items) {
      if (wanted.includes(it.id)) {
        statusById.set(it.id, {
          active: it.status === "ACTIVATE" && !it.isNotForSale,
        });
      }
    }
    if (statusById.size === wanted.length) break;
    if (!res.nextPageToken) break;
    pageToken = res.nextPageToken;
  }
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const id of wanted) {
    if (statusById.get(id)?.active) valid.push(id);
    else invalid.push(id);
  }
  return { ok: true, valid, invalid };
}

// ---------- Detail produk ----------

export type TiktokSkuDetail = TiktokSkuRow & {
  /** Nama varian gabungan sales_attributes (mis. "Merah, 100 ml"). */
  name: string;
  salesAttributes: { name: string; valueName: string }[];
};

export type TiktokProductDetail = {
  id: string;
  title: string;
  status: string;
  productStatus: string;
  description: string;
  mainImages: string[];
  categoryChains: string[];
  isNotForSale: boolean;
  auditFailedReasons: string[];
  skus: TiktokSkuDetail[];
};

export type TiktokProductResult =
  | { ok: true; product: TiktokProductDetail }
  | { ok: false; detail: string };

function parseSkuDetail(r: Record<string, unknown>): TiktokSkuDetail {
  const base = parseSkuRow(r);
  const attrs = ((r.sales_attributes ?? []) as Record<string, unknown>[]).map(
    (a) => ({
      name: str(a.name),
      valueName: str(a.value_name),
    }),
  );
  return {
    ...base,
    name: attrs
      .map((a) => a.valueName)
      .filter(Boolean)
      .join(", "),
    salesAttributes: attrs,
  };
}

/** GET /product/202309/products/{product_id} — detail lengkap produk: SKU
 *  (id, nama varian, harga, stok per gudang), gambar, status audit. */
export async function getTiktokProduct(
  shop: TiktokShopCtx,
  productId: string,
): Promise<TiktokProductResult> {
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
  const path = `/product/202309/products/${productId}`;
  const params: Record<string, string> = {
    app_key: appKey,
    shop_cipher: shop.cipher,
    timestamp: Math.floor(Date.now() / 1000).toString(),
    locale: "id-ID",
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
      data?: Record<string, unknown>;
    };
    if (!res.ok || (data.code ?? 1) !== 0 || !data.data) {
      return {
        ok: false,
        detail: `Gagal mengambil detail produk: ${String(
          data.message ?? res.status,
        )}`,
      };
    }
    const r = data.data;
    const audit = (r.audit ?? {}) as Record<string, unknown>;
    const images = ((r.main_images ?? []) as Record<string, unknown>[]).map(
      (m) => {
        const urls = m.urls;
        return Array.isArray(urls) ? String(urls[0] ?? "") : str(m.url);
      },
    );
    const product: TiktokProductDetail = {
      id: str(r.id),
      title: str(r.title),
      status: str(r.status),
      productStatus: str(r.product_status),
      description: str(r.description),
      mainImages: images.filter(Boolean),
      categoryChains: ((r.category_chains ?? []) as Record<string, unknown>[]).map(
        (c) => str(c.local_name ?? c.name ?? ""),
      ),
      isNotForSale: Boolean(r.is_not_for_sale),
      auditFailedReasons: ((audit.audit_failed_reasons ?? []) as unknown[]).map(
        str,
      ),
      skus: ((r.skus ?? []) as Record<string, unknown>[]).map(parseSkuDetail),
    };
    return { ok: true, product };
  } catch (e) {
    return {
      ok: false,
      detail: `Gagal menghubungi server TikTok: ${
        e instanceof Error ? e.message : "kesalahan tidak dikenal"
      }`,
    };
  }
}

// ---------- Ubah harga & stok ----------

export type TiktokUpdateResult = {
  ok: boolean;
  detail: string;
  /** Pesan kesalahan per SKU — respons sukses tingkat atas tetap bisa
   *  memuat kegagalan sebagian (field data.errors endpoint inventory). */
  errors: string[];
};

/** POST /product/202309/products/{product_id}/prices/update — ubah harga
 *  beberapa SKU sekaligus. Produk harus berstatus ACTIVATE dan tidak sedang
 *  ikut promo (kalau tidak, TikTok menolak dengan pesan sendiri). */
export async function updateTiktokProductPrices(
  shop: TiktokShopCtx,
  productId: string,
  updates: { skuId: string; amount: number }[],
): Promise<TiktokUpdateResult> {
  const path = `/product/202309/products/${productId}/prices/update`;
  const body = JSON.stringify({
    skus: updates.map((u) => ({
      id: u.skuId,
      price: { amount: String(u.amount), currency: "IDR" },
    })),
  });
  return tiktokMutation(shop, path, body);
}

/** POST /product/202309/products/{product_id}/inventory/update — ubah stok
 *  beberapa SKU sekaligus. Setiap SKU wajib menyertakan SEMUA gudangnya
 *  dengan qty masing-masing (data dari detail produk). */
export async function updateTiktokProductStocks(
  shop: TiktokShopCtx,
  productId: string,
  updates: {
    skuId: string;
    inventory: { warehouseId: string; quantity: number }[];
  }[],
): Promise<TiktokUpdateResult> {
  const path = `/product/202309/products/${productId}/inventory/update`;
  const body = JSON.stringify({
    skus: updates.map((u) => ({
      id: u.skuId,
      inventory: u.inventory.map((w) => ({
        warehouse_id: w.warehouseId,
        quantity: w.quantity,
      })),
    })),
  });
  return tiktokMutation(shop, path, body);
}

/** Kerangka panggilan POST tersignature ke API produk + parsing kegagalan
 *  per SKU (data.errors). */
async function tiktokMutation(
  shop: TiktokShopCtx,
  path: string,
  body: string,
): Promise<TiktokUpdateResult> {
  const { appKey, appSecret, ready } = tiktokEnv();
  if (!ready) {
    return {
      ok: false,
      detail:
        "Kredensial aplikasi belum diatur (env TIKTOK_APP_KEY dan TIKTOK_APP_SECRET).",
      errors: [],
    };
  }
  if (shop.cipher === "") {
    return {
      ok: false,
      detail: "shop_cipher belum tersimpan — coba otorisasi ulang aplikasi.",
      errors: [],
    };
  }
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
      data?: { errors?: unknown[] };
    };
    const errors = ((data.data?.errors ?? []) as Record<string, unknown>[])
      .flatMap((e) => {
        const detail = (e.detail ?? {}) as Record<string, unknown>;
        const extra = ((detail.extra_errors ?? []) as Record<string, unknown>[])
          .map((x) => str(x.message));
        return [str(e.message), ...extra].filter(Boolean);
      });
    if (!res.ok || (data.code ?? 1) !== 0) {
      return {
        ok: false,
        detail: `Gagal memperbarui produk: ${String(data.message ?? res.status)}`,
        errors,
      };
    }
    return { ok: true, detail: "", errors };
  } catch (e) {
    return {
      ok: false,
      detail: `Gagal menghubungi server TikTok: ${
        e instanceof Error ? e.message : "kesalahan tidak dikenal"
      }`,
      errors: [],
    };
  }
}
