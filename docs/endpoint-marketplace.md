# Endpoint Marketplace — Inventaris & Pemetaan Fitur KTD Hub

Dokumen riset Tahap 2 (17 Okt 2026). Inventaris lengkap endpoint API
semua channel yang kredensialnya sudah dimiliki, status implementasi di
ktd-hub, dan pemetaan ke fitur Tahap 3 (sync harga), 4 (sync stok + hook
order), 6 (upload produk baru). Kredensial semua channel SUDAH terpasang
di env ktd-hub (.env.local + Vercel) — tidak ada registrasi baru.

---

## 1. Ringkasan status implementasi

| Kemampuan | TikTok | Blibli | Lazada | KTD Store |
|---|---|---|---|---|
| Auth / token | ✅ OAuth + refresh | ✅ Basic+Api-Seller-Key | ✅ OAuth + refresh | ✅ internal |
| Daftar produk | ✅ | ✅ | ✅ | ✅ |
| Detail produk + varian | ✅ | ✅ (variants/filter) | ✅ (products/get) | ✅ |
| Ubah HARGA | ✅ | ✅ (updateProduct antrian) | ✅ (price_quantity) | — |
| Ubah STOK | ✅ | ✅ (delta / exact) | ✅ (price_quantity) | — |
| Ubah NAMA/detail | ❌ belum | ✅ (detail by SKU) | ❌ belum (product/update) | — |
| Upload produk BARU | ❌ belum | ❌ belum (createProductV3) | ❌ belum (product/create) | — |
| Pohon kategori | ❌ belum | ❌ belum (categoryV1) | ❌ belum (category/tree/get) | — |
| Pesanan (untuk hook stok) | ✅ | ✅ | ✅ | ✅ |
| Webhook pesanan | belum dipakai | tersedia (seller webhook) | tersedia (push) | ✅ |

Modul ktd-hub yang sudah ada:
- `src/lib/tiktok.ts` — auth, sign HMAC-SHA256, pesanan (search + detail)
- `src/lib/tiktok-products.ts` — search, detail, prices/update, inventory/update
- `src/lib/tiktok-orders.ts` — polling pesanan toko
- `src/lib/blibli.ts` — auth/headers/query, pesanan, label
- `src/lib/blibli-products.ts` — list V3, varian, updateProduct (antrian)
- `src/lib/lazada.ts` — OAuth, sign, pesanan, pack/rts/label, products/get,
  price_quantity/update
- `src/lib/lazada-products.ts` — update harga/stok per SKU (XML)
- `src/lib/bulk-harga.ts` — orkestrasi harga massal 4 channel + snapshot

---

## 2. TikTok Shop — open-api.tiktokglobalshop.com

Auth: HMAC-SHA256 (`signRequest`), header `x-tts-access-token`, query
`app_key`, `shop_cipher`, `timestamp`, `sign`. App di TikTok Shop for
Sellers Partner Center (docv2). Scope produk: Product Basic
(`seller.product.basic`) untuk baca, Product Modify untuk tulis.

| Fitur | Endpoint | Status |
|---|---|---|
| Daftar produk | POST `/product/202502/products/search` | ✅ `searchTiktokProducts` |
| Detail + SKU | GET `/product/202309/products/{product_id}` | ✅ `getTiktokProduct` |
| Ubah harga SKU | POST `/product/202309/products/{product_id}/prices/update` | ✅ `updateTiktokProductPrices` |
| Ubah stok SKU (semua gudang) | POST `/product/202309/products/{product_id}/inventory/update` | ✅ `updateTiktokProductStocks` |
| Pesanan | POST `/order/202309/orders/search` + GET detail | ✅ |
| **Buat produk baru** | POST `/product/202309/products` | ❌ Tahap 6 — body besar: title, description, category_id, images (main_images urls), skus (seller_sku, price, inventory, sales_attributes), berat/dimensi. Dokumen resmi: partner.tiktokshop.com docv2 "Create Product" (202309) |
| **Periksa pra-upload** | POST `/product/202309/listing_check` | ❌ Tahap 6 — validasi listing sebelum create |
| **Pohon kategori** | GET `/product/202309/categories` | ❌ Tahap 6 — ambil category_id + atribut wajib |
| **Ubah judul/deskripsi** | POST `/product/202309/products/{product_id}` (Update Product) | ❌ Tahap 3/6 — untuk sync nama |

Catatan pasar ID: harga lokal satu nilai `price.amount` IDR (tanpa
sale_price); stok per gudang min 1, maks 99.999; produk harus ACTIVATE
dan tidak sedang ikut promo agar harga bisa diubah.

---

## 3. Blibli — api.blibli.com/v2

Auth: Basic Auth (API Client ID : API Client Key) + header
`Api-Seller-Key`; `storeCode`, `username`, `storeId`, `channelId`,
`requestId` sebagai QUERY params. Nilai KTD STORE: storeId=10001,
username=info@kustoro2026.com, channelId=KUSTORO. Rate limit 100
request/30 menit per store; page size maks 50.

Operasi dari spek resmi (service 66, operationId camelCase TANPA
prefiks "API-"):

| Fitur | Endpoint | Status |
|---|---|---|
| Daftar produk | POST `/proxy/seller/v1/products/filter` (Product List V3) | ✅ `listBlibliProducts` |
| Varian produk | POST `/proxy/seller/v1/products/{product-sku}/variants/filter` | ✅ |
| Ubah massal (harga/stok/nama, ANTRIAN asinkron) | POST `/proxy/mta/api/businesspartner/v1/product/updateProduct` | ✅ `bulkUpdateProduct` → kembalikan feedId, pantau via Queue List/Detail |
| Detail antrian | GET `/proxy/mta/api/businesspartner/v1/queue/{queue-id}` (Queue Detail V1) + Queue List V1 | ✅ |
| Ubah satu produk | PUT `/proxy/seller/v1/products/{blibli-sku}` (Update Single Product V2) | ❌ belum dipakai |
| Ubah detail (nama/deskripsi) per SKU | PUT `/proxy/seller/v1/products/{product-sku}/detail` | ❌ Tahap 3 |
| Stok nilai PASTI | PUT `/proxy/seller/v1/products/{blibli-sku}/stock` | ❌ Tahap 4 (alternatif delta yang sudah ada) |
| Ubah varian | POST `/proxy/seller/v1/products/{product-sku}/variants` (Update Product Variant V1) | ❌ Tahap 6 |
| **Buat produk baru** | POST createProductV3 — URL asli BELUM diambil (perlu fetch spek: `/backend/documentation/services/66/specifications/latest/operations/createProductV3` → field value.url; pola kemungkinan `/proxy/mta/api/businesspartner/v1/product/createProduct`) | ❌ Tahap 6 |
| Pohon kategori | GET Category Tree V1 (`CategoryV1`) + Category Attributes V2 | ❌ Tahap 6 |
| **Webhook pesanan** | spec 79: `new_order`, `delivered_order`, `canceled_order`, `package_created_order`, dll | ❌ Tahap 4 (opsional; polling Order List V2 juga cukup) |
| Pesanan | POST `/proxy/seller/v1/orders/packages/filter` + GET `/proxy/seller/v1/orders/items/{id}` | ✅ |

Catatan penting: updateProduct = antrian asinkron → hasil dicek lewat
Queue Detail; nama/deskripsi bisa memicu moderasi ulang Blibli
(listing nonaktif sementara) sedangkan harga/stok TIDAK memicu moderasi.
Spek resmi: API sinkron "not intended for high throughput" — batch kecil.

---

## 4. Lazada — api.lazada.co.id/rest

Auth: HMAC-SHA256 `signLazada` (urutkan param, gabung apiPath, kunci
app_secret, hex UPPERCASE), query `app_key`, `timestamp`, `sign_method`,
`access_token`. App "KTD Hub" (App Key 143047), token OAuth auto-refresh.

| Fitur | Endpoint | Status |
|---|---|---|
| Daftar produk (maks 50/halaman, `sku_seller_list` maks 100) | GET `/products/get` | ✅ `getLazadaProducts` |
| Ubah harga + stok (XML `Request/Product`, maks 50 — saran 20) | POST `/product/price_quantity/update` | ✅ `updateLazadaPriceQuantity` |
| Pesanan | GET `/orders/get` + `/order/items/get` | ✅ |
| Fulfillment | POST `/order/pack`, `/order/rts`, GET `/order/document/get`, GET `/shipment/providers/get` | ✅ |
| **Buat produk baru** | POST `/product/create` (XML `Request/Product` dengan attributes, skus, images) — dokumen resmi open.lazada.com/apps/doc/api?path=/product/create | ❌ Tahap 6 |
| **Ubah nama/detail** | POST `/product/update` (XML, perlu SkuId + ItemId dari products/get) | ❌ Tahap 3/6 |
| Pohon kategori | GET `/category/tree/get` + `/category/attributes/get` | ❌ Tahap 6 |
| Upload gambar | POST `/image/migrate` (URL image) | ❌ Tahap 6 |

Catatan: respons konvensi `{"code":"0"}`; error `ApiCallLimit` →
retry dengan jeda (sudah diimplementasikan di lib). Status pesanan
(unpaid/pending/packed/ready_to_ship/shipped/delivered/canceled) dipakai
untuk hook stok Tahap 4.

---

## 5. Pemetaan fitur → endpoint per channel

### 5.1 Tahap 3 — Sync harga (satu aksi → semua channel)

| Channel | Endpoint | Catatan |
|---|---|---|
| TikTok | prices/update per SKU | harus ACTIVATE & tidak ikut promo |
| Blibli | updateProduct (antrian) | cek Queue Detail; tanpa moderasi |
| Lazada | price_quantity/update (XML) | batch ≤20 disarankan |
| KTD Store | internal (bulk-harga.ts sudah ada) | |

### 5.2 Tahap 4 — Sync stok + hook order selesai

| Channel | Endpoint | Catatan |
|---|---|---|
| TikTok | inventory/update (SEMUA gudang tiap SKU) | min 1, maks 99.999 |
| Blibli | stock exact-value (PUT) ATAU updateProduct delta | exact lebih aman untuk sinkronisasi penuh |
| Lazada | price_quantity/update (Quantity) | |
| KTD Store | internal | |

Hook "order selesai → kurangi stok semua channel": deteksi pesanan
berstatus selesai (TikTok: status COMPLETED; Blibli: delivered/CX;
Lazada: delivered) → hitung qty per SKU → kurangi stok master Aneka →
push pengurangan ke SEMUA channel lain. (Tahap 4 implementasi penuh;
pilihan webhook vs polling dijelaskan di rencana Tahap 4.)

### 5.3 Tahap 6 — Upload produk baru (bertahap per channel)

Alur generik per channel:
1. Bersihkan nama (strip tag seller) + jalankan rule engine Tahap 5.
2. Ambil kategori channel: TikTok `categories` / Blibli CategoryV1 +
   AttributesV2 / Lazada `category/tree/get` + `attributes/get`.
3. Upload gambar (TikTok: URL main_images langsung di body create;
   Lazada: `image/migrate` dulu; Blibli: URL di payload create).
4. Create produk dengan harga + stok awal.
5. Pantau moderasi (TikTok audit status; Blibli queue; Lazada kode).

Urutan channel yang disarankan: **Blibli → Lazada → TikTok**
(dari aturan paling longgar ke paling ketat sertifikasi — hasil moderasi
TikTok paling sulit diprediksi, jadi dikerjakan terakhir).

---

## 6. KTD Store (situs sendiri)

Tidak dibahas aturan larangannya. Untuk sinkronisasi: data produk situs
berasal dari `products-cache.json` + DB; harga/stok dikelola lewat
`bulk-harga.ts` (channel "ktd-store"). Detail implementasi Tahap 3-4
menyesuaikan lapisan data yang sudah ada.
