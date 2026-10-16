// Operasi produk Lazada Open Platform untuk KTD Hub (toko KTD STORE).
// Endpoint yang dipakai:
//  - GetProducts              GET  /products/get
//  - UpdatePriceQuantity      POST /product/price_quantity/update
// Update massal menerima payload XML (maks 50 produk, disarankan 20 per
// request) — respons hanya kode sukses/gagal, hasil akhir cek lewat daftar
// produk beberapa menit kemudian.
import {
  getLazadaProducts,
  updateLazadaPriceQuantity,
  type LazadaProductRow,
  type LazadaResult,
} from "./lazada";

export type LazadaProductsFilter = {
  filter?: "all" | "live" | "inactive" | "sold-out";
  skuSellerList?: string[];
  offset?: number;
  limit?: number;
};

/** Satu baris permintaan update massal — kirim harga + stok sekaligus
 *  (keduanya wajib di payload XML supaya nilai tidak terhapus). SkuId dan
 *  ItemId opsional, diambil dari daftar produk supaya payload persis
 *  mengikuti contoh resmi Open Platform. */
export type LazadaBulkItemUpdate = {
  sellerSku: string;
  price: number;
  quantity: number;
  skuId?: string;
  itemId?: string;
};

/** GetProducts — daftar produk beserta SKU-nya (SellerSku = kunci pemetaan).
 *  Ambil satu halaman (maks 50); total untuk paginasi di data.total. */
export async function listLazadaProducts(
  filter: LazadaProductsFilter = {},
): Promise<LazadaResult<{ items: LazadaProductRow[]; total: number }>> {
  const r = await getLazadaProducts({
    filter: filter.filter ?? "all",
    sku_seller_list: filter.skuSellerList,
    offset: filter.offset ?? 0,
    limit: filter.limit ?? 50,
  });
  if (!r.ok) return r;
  return { ok: true, data: { items: r.data.products, total: r.data.total } };
}

/** Escape karakter XML dalam nilai produk (SKU/nama bisa memuat & < >). */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Susun payload XML UpdatePriceQuantity untuk satu kelompok produk.
 *  Format resmi Open Platform membungkus tiap SKU dalam
 *  <Request><Product><Skus><Sku>...</Sku></Skus></Product></Request> —
 *  tanpa pembungkus Skus/Sku API menolak dengan E006 (Unexpected
 *  internal error) untuk SEMUA SKU. */
function buildPriceQuantityXml(rows: LazadaBulkItemUpdate[]): string {
  const skus = rows
    .map((r) => {
      const itemId = r.itemId ? `<ItemId>${xmlEscape(r.itemId)}</ItemId>` : "";
      const skuId = r.skuId ? `<SkuId>${xmlEscape(r.skuId)}</SkuId>` : "";
      return (
        `<Sku>${itemId}${skuId}` +
        `<SellerSku>${xmlEscape(r.sellerSku)}</SellerSku>` +
        `<Price>${Math.round(r.price)}</Price>` +
        `<Quantity>${Math.max(0, Math.round(r.quantity))}</Quantity></Sku>`
      );
    })
    .join("");
  return `<Request><Product><Skus>${skus}</Skus></Product></Request>`;
}

/** UpdatePriceQuantity — update massal harga/stok dalam kelompok maks 20
 *  produk per request (rekomendasi resmi; batas keras 50). */
export async function updateLazadaProductsBulk(
  requests: LazadaBulkItemUpdate[],
): Promise<LazadaResult<{ total: number }>> {
  if (requests.length === 0) {
    return { ok: false, detail: "Tidak ada SKU yang dikirim untuk diperbarui." };
  }
  if (requests.length > 50) {
    return { ok: false, detail: "Maksimal 50 SKU per permintaan update." };
  }

  const total = requests.length;
  const chunk = 20;
  for (let i = 0; i < requests.length; i += chunk) {
    const part = requests.slice(i, i + chunk);
    let r = await updateLazadaPriceQuantity(buildPriceQuantityXml(part));
    // ApiCallLimit/E901 = batas frekuensi Lazada yang sementara (ban beberapa
    // detik) — coba lagi dengan jeda sebelum dinyatakan gagal.
    for (
      let ulang = 0;
      !r.ok && /ApiCallLimit|E901/.test(r.detail) && ulang < 3;
      ulang++
    ) {
      await new Promise((res) => setTimeout(res, 1500 * (ulang + 1)));
      r = await updateLazadaPriceQuantity(buildPriceQuantityXml(part));
    }
    if (!r.ok) {
      return {
        ok: false,
        detail: `Gagal perbarui produk (kelompok ${i / chunk + 1}): ${r.detail}`,
      };
    }
  }
  return { ok: true, data: { total } };
}
