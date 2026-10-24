// Sinkronisasi stok Aneka → semua channel + hook "order selesai" (Tahap 4).
//
// Dua jalur:
//  1. MANUAL — halaman Sinkron Stok: target stok eksplisit per produk Aneka
//     (default stok master) didorong ke tiap kanal: TikTok Shop (semua SKU
//     produk), Blibli (semua varian, exactStock), Lazada (SellerSku), dan
//     KTD Store (tabel override ktd_store_stok yang dibaca situs toko).
//  2. OTOMATIS — hook order selesai: pesanan berstatus selesai
//     (TikTok COMPLETED, Blibli item D/terkirim, Lazada delivered) dicatat
//     ke tabel stok_penyesuaian (sekali saja per kejadian), lalu stok
//     dikurangi sebesar qty terjual di SEMUA kanal LAIN — kanal asal sudah
//     berkurang otomatis oleh marketplace-nya. Gagal di satu kanal tidak
//     menghalangi kanal lain; kanal gagal dicoba lagi pada tick berikut
//     (flag per kanal di baris kejadian).
//
// Batas 60 produk per panggilan manual (ceiling 60 detik serverless);
// hook membatasi jumlah produk per kanal per jalan supaya tidak melintasi
// batas frekuensi API (Blibli ±25 panggilan/menit).
import { blibliProductSku, listBlibliOrders } from "@/lib/blibli";
import {
  getBlibliProductVariants,
  listBlibliProducts,
  updateBlibliProductsBulk,
  type BlibliBulkItemUpdate,
  type BlibliVariantRow,
} from "@/lib/blibli-products";
import { getAnekaMasterById, listAnekaMaster } from "@/lib/aneka-master";
import {
  insertStokPenyesuaian,
  listAnekaProductMaps,
  listBlibliProductMaps,
  listKtdStoreStok,
  listLazadaProductMaps,
  listStokPenyesuaianTerbuka,
  listTiktokShopTokens,
  tandaiStokKanalSelesai,
  upsertKtdStoreStok,
  workerHeartbeatFresh,
  type StokKanal,
  type StokPenyesuaianRow,
} from "@/lib/db";
import { getLazadaOrderItems, getLazadaOrders } from "@/lib/lazada";
import {
  listLazadaProducts,
  updateLazadaProductsBulk,
  type LazadaBulkItemUpdate,
} from "@/lib/lazada-products";
import { getTiktokOrders } from "@/lib/tiktok";
import { prepareShop } from "@/lib/tiktok-orders";
import {
  getTiktokProduct,
  searchTiktokProducts,
  updateTiktokProductStocks,
  type TiktokShopCtx,
} from "@/lib/tiktok-products";

/** Satu produk Aneka + target stok (≥ 0). */
export type PilihanStokSync = {
  anekaId: string;
  stok: number;
};

/** Satu baris pratinjau stok per kanal (stok saat ini di kanal itu). */
export type BarisStokPratinjau = {
  anekaId: string;
  productName: string;
  stok: number;
};

export type HasilStokSync = {
  ok: boolean;
  diubah: number;
  gagal: { key: string; label: string; detail: string }[];
  detail: string;
  catatan: string[];
};

/** Hasil pengurangan stok satu produk di satu kanal (jalur otomatis). */
export type HasilKurangiStok = {
  /** false = kegagalan sementara, coba lagi tick berikut; true = selesai
   *  (termasuk "tidak ada yang dikurangi" — jangan dicoba ulang). */
  ok: boolean;
  diubah: number;
  detail: string;
};

export type HasilCekOrderSelesai = {
  ok: boolean;
  detail: string;
  eventBaru: number;
  diterapkan: Record<StokKanal, number>;
  gagalKanal: string[];
};

/** Batas keamanan eksekusi manual per permintaan (serverless 60 detik). */
const MAKS_PRODUK_SYNC = 60;

/** Jeda sederhana antar panggilan API yang dibatasi frekuensinya. */
const tunda = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Batas produk per kanal per jalan hook (antrean sisanya menunggu tick
 *  berikut) — menjaga tetap di bawah batas frekuensi masing-masing API. */
const KAP_PER_KANAL_PER_JALAN: Record<StokKanal, number> = {
  tiktok: 40,
  blibli: 15,
  lazada: 60,
  ktd: 100,
};

/**
 * Jendela mundur pemantauan order selesai (hari).
 * Default 14; bisa dipersempit saat deploy pertama via env STOK_JENDELA_HARI
 * supaya koreksi stok gelombang awal lebih halus (mis. 3), lalu dilepas lagi.
 */
const JENDELA_HARI =
  Number(process.env.STOK_JENDELA_HARI) > 0
    ? Math.floor(Number(process.env.STOK_JENDELA_HARI))
    : 14;

const KANAL_SEMUA: StokKanal[] = ["tiktok", "blibli", "lazada", "ktd"];

/** Bersihkan pilihan: buang duplikat (per anekaId) dan stok tidak valid. */
function validPilihan(pilihan: PilihanStokSync[]): PilihanStokSync[] {
  const seen = new Set<string>();
  const out: PilihanStokSync[] = [];
  for (const p of pilihan) {
    if (!p || !p.anekaId || seen.has(p.anekaId)) continue;
    const stok = Math.round(Number(p.stok));
    if (!Number.isFinite(stok) || stok < 0) continue;
    seen.add(p.anekaId);
    out.push({ anekaId: p.anekaId, stok });
  }
  return out;
}

/** Sebarkan target ke deret stok proporsional (sisa dibagi ke entri
 *  terbesar). Jumlah hasil selalu = target; semua ≥ 0. Deret kosong (sum 0)
 *  → target ditaruh seluruhnya di entri pertama. */
function sebarProporsional(currentIn: number[], target: number): number[] {
  const n = currentIn.length;
  if (n === 0) return [];
  if (target <= 0) return currentIn.map(() => 0);
  const c = [...currentIn];
  const sum = c.reduce((a, b) => a + b, 0);
  if (sum <= 0) {
    const out = c.map(() => 0);
    out[0] = target;
    return out;
  }
  const out = c.map((v) => Math.floor((v / sum) * target));
  let sisa = target - out.reduce((a, b) => a + b, 0);
  while (sisa > 0) {
    let idx = -1;
    let max = -1;
    for (let i = 0; i < n; i++) {
      if (c[i] > max) {
        max = c[i];
        idx = i;
      }
    }
    if (idx < 0) break;
    out[idx] += 1;
    c[idx] = -1;
    sisa -= 1;
  }
  return out;
}

/** Kurangi qty dari deret stok mulai dari entri terbesar (clamp ≥ 0). */
function kurangiDariTerbesar(currentIn: number[], qty: number): number[] {
  const out = [...currentIn];
  let sisa = qty;
  while (sisa > 0) {
    let idx = -1;
    let max = -1;
    for (let i = 0; i < out.length; i++) {
      if (out[i] > max) {
        max = out[i];
        idx = i;
      }
    }
    if (idx < 0) break;
    const ambil = Math.min(out[idx], sisa);
    out[idx] -= ambil;
    sisa -= ambil;
  }
  return out;
}

// ---------- Pratinjau stok per kanal ----------

/** Pratinjau KTD Store: satu baris per produk master; stok = override
 *  tersimpan bila ada, selain itu stok efektif master. */
export async function pratinjauStokKtd(): Promise<
  | { ok: true; rows: BarisStokPratinjau[] }
  | { ok: false; detail: string }
> {
  const overrideRows = await listKtdStoreStok();
  const override = new Map(overrideRows.map((r) => [r.aneka_id, r.stok]));
  const rows: BarisStokPratinjau[] = [];
  for (const p of listAnekaMaster()) {
    const id = String(p.id ?? "");
    if (!id) continue;
    rows.push({
      anekaId: id,
      productName: p.name,
      stok: override.get(id) ?? (Number(p.stok) || 0),
    });
  }
  rows.sort((a, b) => a.productName.localeCompare(b.productName, "id"));
  return { ok: true, rows };
}

/** Pratinjau TikTok: pindai produk ACTIVATE (maks 3 halaman × 100) dan
 *  jumlahkan stok gudang semua SKU per produk yang dipetakan. */
export async function pratinjauStokTiktok(): Promise<
  | { ok: true; rows: BarisStokPratinjau[] }
  | { ok: false; detail: string }
> {
  const [maps, tokens] = await Promise.all([
    listAnekaProductMaps(),
    listTiktokShopTokens(),
  ]);
  if (tokens.length === 0) {
    return { ok: false, detail: "Belum ada toko TikTok Shop yang terhubung." };
  }
  const prep = await prepareShop(tokens[0]);
  if (!prep.ok) return { ok: false, detail: prep.detail };
  const ctx: TiktokShopCtx = { cipher: prep.cipher, access_token: prep.access_token };

  const info = new Map<string, { anekaId: string; nama: string }>();
  for (const m of maps) {
    if (m.enabled !== 1 || !m.aneka_product_id) continue;
    info.set(m.tiktok_product_id, {
      anekaId: m.aneka_product_id,
      nama: m.aneka_product_name || m.tiktok_product_name || m.tiktok_product_id,
    });
  }

  const stokByProduct = new Map<string, number>();
  let token = "";
  let halaman = 0;
  do {
    const r = await searchTiktokProducts(ctx, {
      status: "ACTIVATE",
      pageSize: 100,
      pageToken: token || undefined,
    });
    if (!r.ok) return { ok: false, detail: r.detail };
    for (const p of r.items) {
      const total = p.skus.reduce(
        (a, s) => a + s.inventory.reduce((b, w) => b + (Number(w.quantity) || 0), 0),
        0,
      );
      stokByProduct.set(p.id, total);
    }
    token = r.nextPageToken;
    halaman++;
  } while (token && halaman < 3);

  const rows: BarisStokPratinjau[] = [];
  for (const [productId, m] of info) {
    rows.push({
      anekaId: m.anekaId,
      productName: m.nama,
      stok: stokByProduct.get(productId) ?? 0,
    });
  }
  rows.sort((a, b) => a.productName.localeCompare(b.productName, "id"));
  return { ok: true, rows };
}

/** Pratinjau Blibli: pindai daftar produk (productSku + counter.stock
 *  tingkat produk) untuk productSku yang dipetakan. */
export async function pratinjauStokBlibli(): Promise<
  | { ok: true; rows: BarisStokPratinjau[] }
  | { ok: false; detail: string }
> {
  const maps = await listBlibliProductMaps();
  const info = new Map<string, { anekaId: string; nama: string }>();
  for (const m of maps) {
    if (m.enabled !== 1 || !m.aneka_product_id) continue;
    info.set(m.blibli_sku, {
      anekaId: m.aneka_product_id,
      nama: m.product_name || m.blibli_sku,
    });
  }
  if (info.size === 0) return { ok: true, rows: [] };

  const stokBySku = new Map<string, number>();
  let total = Infinity;
  let page = 0;
  while (page < 25 && page * 50 < total) {
    const r = await listBlibliProducts({ page, size: 50 });
    if (!r.ok) return { ok: false, detail: r.detail };
    for (const p of r.data.items) {
      const sku = String(p.product?.sku ?? "");
      if (sku && info.has(sku)) {
        stokBySku.set(sku, Number(p.counter?.stock ?? 0) || 0);
      }
    }
    total = r.data.totalRecord;
    page++;
    if (r.data.items.length === 0) break;
  }

  const rows: BarisStokPratinjau[] = [];
  for (const [sku, m] of info) {
    rows.push({
      anekaId: m.anekaId,
      productName: m.nama,
      stok: stokBySku.get(sku) ?? 0,
    });
  }
  rows.sort((a, b) => a.productName.localeCompare(b.productName, "id"));
  return { ok: true, rows };
}

/** Pratinjau Lazada: pindai daftar produk (semua halaman) dan ambil
 *  quantity per SellerSku yang dipetakan. */
export async function pratinjauStokLazada(): Promise<
  | { ok: true; rows: BarisStokPratinjau[] }
  | { ok: false; detail: string }
> {
  const maps = await listLazadaProductMaps();
  const info = new Map<string, { anekaId: string; nama: string }>();
  for (const m of maps) {
    if (m.enabled !== 1 || !m.aneka_product_id) continue;
    info.set(m.lazada_sku, {
      anekaId: m.aneka_product_id,
      nama: m.product_name || m.lazada_sku,
    });
  }
  if (info.size === 0) return { ok: true, rows: [] };

  const stokBySku = new Map<string, number>();
  let total = Infinity;
  let offset = 0;
  while (offset < total && offset < 1500) {
    let r = await listLazadaProducts({ filter: "all", offset, limit: 50 });
    for (
      let ulang = 0;
      !r.ok && /ApiCallLimit|E901/.test(r.detail) && ulang < 3;
      ulang++
    ) {
      await tunda(1500 * (ulang + 1));
      r = await listLazadaProducts({ filter: "all", offset, limit: 50 });
    }
    if (!r.ok) return { ok: false, detail: r.detail };
    total = r.data.total;
    for (const p of r.data.items) {
      for (const sku of p.skus ?? []) {
        const key = String(sku.SellerSku ?? "");
        if (key && info.has(key)) {
          stokBySku.set(key, Number(sku.quantity ?? 0) || 0);
        }
      }
    }
    offset += 50;
    if (r.data.items.length === 0) break;
  }

  const rows: BarisStokPratinjau[] = [];
  for (const [sku, m] of info) {
    rows.push({
      anekaId: m.anekaId,
      productName: m.nama,
      stok: stokBySku.get(sku) ?? 0,
    });
  }
  rows.sort((a, b) => a.productName.localeCompare(b.productName, "id"));
  return { ok: true, rows };
}

// ---------- Terapkan target stok ke satu kanal (manual) ----------

/** Terapkan target stok ke kanal terpilih. Stok segar dibaca dari kanal
 *  sebelum ditulis; listing yang sudah berstok target dilewati. */
export async function terapkanStokSync(
  channel: string,
  pilihan: PilihanStokSync[],
): Promise<HasilStokSync> {
  const bersih = validPilihan(pilihan);
  if (bersih.length === 0) {
    return {
      ok: false,
      diubah: 0,
      gagal: [],
      detail: "Tidak ada produk dengan stok valid yang dipilih.",
      catatan: [],
    };
  }
  if (bersih.length > MAKS_PRODUK_SYNC) {
    return {
      ok: false,
      diubah: 0,
      gagal: [],
      detail: `Maksimal ${MAKS_PRODUK_SYNC} produk per sekali terapkan (dipilih ${bersih.length}) — terapkan bertahap.`,
      catatan: [],
    };
  }
  switch (channel) {
    case "tiktok":
      return syncStokTiktok(bersih);
    case "blibli":
      return syncStokBlibli(bersih);
    case "lazada":
      return syncStokLazada(bersih);
    default:
      return syncStokKtd(bersih);
  }
}

/** KTD Store: simpan override stok per id Aneka (tabel ktd_store_stok yang
 *  dibaca situs toko). Murni basis data — tanpa API eksternal. */
async function syncStokKtd(pilihan: PilihanStokSync[]): Promise<HasilStokSync> {
  const gagal: HasilStokSync["gagal"] = [];
  const overrideRows = await listKtdStoreStok();
  const override = new Map(overrideRows.map((r) => [r.aneka_id, r.stok]));
  const akanSimpan: { aneka_id: string; stok: number }[] = [];
  for (const p of pilihan) {
    const master = getAnekaMasterById(p.anekaId);
    if (!master) {
      gagal.push({
        key: p.anekaId,
        label: `Aneka #${p.anekaId}`,
        detail: "Produk tidak ada di master Aneka — jalankan ulang sweep.",
      });
      continue;
    }
    const sekarang = override.get(p.anekaId) ?? (Number(master.stok) || 0);
    if (sekarang === p.stok) continue; // sudah sesuai — biarkan
    akanSimpan.push({ aneka_id: p.anekaId, stok: p.stok });
  }
  await upsertKtdStoreStok(akanSimpan);
  return {
    ok: akanSimpan.length > 0 || gagal.length === 0,
    diubah: akanSimpan.length,
    gagal,
    detail: "",
    catatan:
      akanSimpan.length > 0
        ? ["Situs toko memakai stok baru dalam beberapa menit (cache)."]
        : [],
  };
}

/** TikTok: target stok tingkat produk disebar ke semua SKU (proporsional
 *  stok sekarang), lalu per SKU disebar ke gudang-gudangnya — endpoint
 *  inventory/update wajib menyertakan SEMUA gudang tiap SKU. */
async function syncStokTiktok(pilihan: PilihanStokSync[]): Promise<HasilStokSync> {
  const gagal: HasilStokSync["gagal"] = [];
  const [maps, tokens] = await Promise.all([
    listAnekaProductMaps(),
    listTiktokShopTokens(),
  ]);
  if (tokens.length === 0) {
    return {
      ok: false,
      diubah: 0,
      gagal,
      detail: "Belum ada toko TikTok Shop yang terhubung.",
      catatan: [],
    };
  }
  const prep = await prepareShop(tokens[0]);
  if (!prep.ok) return { ok: false, diubah: 0, gagal, detail: prep.detail, catatan: [] };
  const ctx: TiktokShopCtx = { cipher: prep.cipher, access_token: prep.access_token };

  const productByAneka = new Map<string, string>();
  const namaByAneka = new Map<string, string>();
  const namaByProduct = new Map<string, string>();
  for (const m of maps) {
    if (m.enabled !== 1) continue;
    productByAneka.set(m.aneka_product_id, m.tiktok_product_id);
    namaByAneka.set(m.aneka_product_id, m.aneka_product_name || `Aneka #${m.aneka_product_id}`);
    namaByProduct.set(
      m.tiktok_product_id,
      m.aneka_product_name || m.tiktok_product_name || m.tiktok_product_id,
    );
  }
  const targetByProduct = new Map<string, number>();
  for (const p of pilihan) {
    const productId = productByAneka.get(p.anekaId);
    if (!productId) {
      gagal.push({
        key: p.anekaId,
        label: namaByAneka.get(p.anekaId) ?? `Aneka #${p.anekaId}`,
        detail: "Tanpa pemetaan TikTok — petakan dulu di halaman Pemetaan.",
      });
      continue;
    }
    targetByProduct.set(productId, p.stok);
  }

  let diubah = 0;
  for (const [productId, target] of targetByProduct) {
    const label = namaByProduct.get(productId) ?? productId;
    const d = await getTiktokProduct(ctx, productId);
    if (!d.ok) {
      gagal.push({ key: productId, label, detail: d.detail });
      continue;
    }
    const skus = d.product.skus;
    if (skus.length === 0) {
      gagal.push({ key: productId, label, detail: "Produk tanpa SKU." });
      continue;
    }
    const totalSekarang = skus.map((s) =>
      s.inventory.reduce((a, w) => a + (Number(w.quantity) || 0), 0),
    );
    const jumlah = totalSekarang.reduce((a, b) => a + b, 0);
    if (jumlah === target) continue; // sudah sesuai — biarkan
    const perSku = sebarProporsional(totalSekarang, target);
    const updates = skus.map((s, i) => {
      const gudang = s.inventory.map((w) => Number(w.quantity) || 0);
      const isi = sebarProporsional(gudang, perSku[i]);
      return {
        skuId: s.id,
        inventory: s.inventory.map((w, j) => ({
          warehouseId: w.warehouseId,
          quantity: isi[j],
        })),
      };
    });
    const r = await updateTiktokProductStocks(ctx, productId, updates);
    if (!r.ok || r.errors.length > 0) {
      for (const u of updates) {
        gagal.push({
          key: `${productId}|${u.skuId}`,
          label: u.skuId,
          detail: r.detail || r.errors.join("; "),
        });
      }
      continue;
    }
    diubah += updates.length;
  }
  return { ok: diubah > 0 || gagal.length === 0, diubah, gagal, detail: "", catatan: [] };
}

/** Blibli: target stok tingkat produk disebar ke semua varian gdnSku
 *  (proporsional stok sekarang) lalu dikirim sebagai exactStock lewat
 *  antrean update massal (asinkron — hasil final beberapa menit kemudian).
 *  Jeda antar panggilan varian menjaga batas ±25 panggilan/menit. */
async function syncStokBlibli(pilihan: PilihanStokSync[]): Promise<HasilStokSync> {
  const gagal: HasilStokSync["gagal"] = [];
  const maps = await listBlibliProductMaps();
  const skuByAneka = new Map<string, string>();
  const namaBySku = new Map<string, string>();
  for (const m of maps) {
    if (m.enabled !== 1) continue;
    skuByAneka.set(m.aneka_product_id, m.blibli_sku);
    namaBySku.set(m.blibli_sku, m.product_name || m.blibli_sku);
  }
  const targetBySku = new Map<string, number>();
  for (const p of pilihan) {
    const sku = skuByAneka.get(p.anekaId);
    if (!sku) {
      gagal.push({
        key: p.anekaId,
        label: `Aneka #${p.anekaId}`,
        detail: "Tanpa pemetaan Blibli — petakan dulu di halaman Pemetaan.",
      });
      continue;
    }
    targetBySku.set(sku, p.stok);
  }

  const requests: BlibliBulkItemUpdate[] = [];
  const berubah: { gdnSku: string; label: string }[] = [];
  let pertama = true;
  for (const [sku, target] of targetBySku) {
    if (!pertama) await tunda(2500);
    pertama = false;
    const vars = await getBlibliProductVariants(sku);
    if (!vars.ok) {
      gagal.push({ key: sku, label: namaBySku.get(sku) ?? sku, detail: vars.detail });
      continue;
    }
    const current = vars.data.map(
      (v) => Number(v.stock?.seller?.available) || 0,
    );
    const jumlah = current.reduce((a, b) => a + b, 0);
    if (jumlah === target) continue; // sudah sesuai — biarkan
    const perVarian = sebarProporsional(current, target);
    vars.data.forEach((v, i) => {
      if (perVarian[i] === current[i]) return;
      requests.push({
        gdnSku: v.variant.blibliSku,
        pickupPointCode: v.pickupPoint.code,
        exactStock: perVarian[i],
      });
      berubah.push({
        gdnSku: v.variant.blibliSku,
        label: v.variant.name || v.variant.sellerSku || v.variant.blibliSku,
      });
    });
  }

  let diubah = 0;
  const catatan: string[] = [];
  for (let i = 0; i < requests.length; i += 100) {
    const chunk = requests.slice(i, i + 100);
    const r = await updateBlibliProductsBulk(chunk);
    if (!r.ok) {
      for (const c of chunk) {
        const b = berubah.find((x) => x.gdnSku === c.gdnSku);
        gagal.push({ key: c.gdnSku, label: b?.label ?? c.gdnSku, detail: r.detail });
      }
      continue;
    }
    diubah += chunk.length;
    catatan.push(
      `Antrean Blibli diterima (${chunk.length} varian) — hasil final cek beberapa menit lagi di daftar produk.`,
    );
  }
  return {
    ok: diubah > 0 || gagal.length === 0,
    diubah,
    gagal,
    detail: "",
    catatan: [...new Set(catatan)],
  };
}

/** Lazada: target stok per SellerSku. Harga segar ikut dikirim karena
 *  UpdatePriceQuantity wajib memuat Price + Quantity. */
async function syncStokLazada(pilihan: PilihanStokSync[]): Promise<HasilStokSync> {
  const gagal: HasilStokSync["gagal"] = [];
  const maps = await listLazadaProductMaps();
  const skuByAneka = new Map<string, string>();
  const namaBySku = new Map<string, string>();
  for (const m of maps) {
    if (m.enabled !== 1) continue;
    skuByAneka.set(m.aneka_product_id, m.lazada_sku);
    namaBySku.set(m.lazada_sku, m.product_name || m.lazada_sku);
  }
  const targetBySku = new Map<string, number>();
  for (const p of pilihan) {
    const sku = skuByAneka.get(p.anekaId);
    if (!sku) {
      gagal.push({
        key: p.anekaId,
        label: `Aneka #${p.anekaId}`,
        detail: "Tanpa pemetaan Lazada — petakan dulu di halaman Pemetaan.",
      });
      continue;
    }
    targetBySku.set(sku, p.stok);
  }

  // Harga + stok segar lewat sku_seller_list (kelompok maks 50 SKU).
  const keys = [...targetBySku.keys()];
  const segar = new Map<
    string,
    { harga: number; quantity: number; skuId: string; itemId: string }
  >();
  for (let i = 0; i < keys.length; i += 50) {
    const chunk = keys.slice(i, i + 50);
    let r = await listLazadaProducts({ filter: "all", skuSellerList: chunk, limit: 50 });
    for (
      let ulang = 0;
      !r.ok && /ApiCallLimit|E901/.test(r.detail) && ulang < 3;
      ulang++
    ) {
      await tunda(1500 * (ulang + 1));
      r = await listLazadaProducts({ filter: "all", skuSellerList: chunk, limit: 50 });
    }
    if (!r.ok) {
      for (const sku of chunk) {
        gagal.push({ key: sku, label: namaBySku.get(sku) ?? sku, detail: r.detail });
      }
      continue;
    }
    for (const p of r.data.items) {
      for (const sku of p.skus ?? []) {
        const key = String(sku.SellerSku ?? "");
        if (!key || segar.has(key)) continue;
        const price = Number(sku.price ?? 0) || 0;
        const special = Number(sku.special_price ?? 0);
        segar.set(key, {
          harga: special > 0 && special < price ? special : price,
          quantity: Number(sku.quantity ?? 0) || 0,
          skuId: String(sku.SkuId ?? ""),
          itemId: String(p.item_id ?? ""),
        });
      }
    }
  }

  const requests: LazadaBulkItemUpdate[] = [];
  const berubah: { key: string; label: string }[] = [];
  for (const [sku, target] of targetBySku) {
    const f = segar.get(sku);
    if (!f) {
      gagal.push({
        key: sku,
        label: namaBySku.get(sku) ?? sku,
        detail: "Tidak ditemukan di katalog Lazada (periksa SellerSku).",
      });
      continue;
    }
    if (f.quantity === target) continue; // sudah sesuai — biarkan
    requests.push({
      sellerSku: sku,
      price: f.harga,
      quantity: target,
      skuId: f.skuId || undefined,
      itemId: f.itemId || undefined,
    });
    berubah.push({ key: sku, label: sku });
  }

  let diubah = 0;
  for (let i = 0; i < requests.length; i += 50) {
    const chunk = requests.slice(i, i + 50);
    const r = await updateLazadaProductsBulk(chunk);
    if (!r.ok) {
      for (const c of chunk) {
        const b = berubah.find((x) => x.key === c.sellerSku);
        gagal.push({
          key: c.sellerSku,
          label: b?.label ?? c.sellerSku,
          detail: r.detail,
        });
      }
      continue;
    }
    diubah += chunk.length;
  }
  return { ok: diubah > 0 || gagal.length === 0, diubah, gagal, detail: "", catatan: [] };
}

// ---------- Kurangi stok satu produk di satu kanal (jalur otomatis) ----------

/** Kurangi stok produk Aneka di satu kanal sebesar qty. Bila satu produk
 *  terpetakan ke beberapa listing, listing dengan stok terbanyak yang
 *  dikurangi (listing lain tidak disentuh). */
export async function kurangiStokChannel(
  kanal: StokKanal,
  anekaId: string,
  qty: number,
): Promise<HasilKurangiStok> {
  if (!Number.isFinite(qty) || qty <= 0) {
    return { ok: true, diubah: 0, detail: "Qty tidak valid — dilewati." };
  }
  switch (kanal) {
    case "tiktok":
      return kurangiTiktok(anekaId, qty);
    case "blibli":
      return kurangiBlibli(anekaId, qty);
    case "lazada":
      return kurangiLazada(anekaId, qty);
    default:
      return kurangiKtd(anekaId, qty);
  }
}

async function kurangiKtd(anekaId: string, qty: number): Promise<HasilKurangiStok> {
  const master = getAnekaMasterById(anekaId);
  if (!master) return { ok: true, diubah: 0, detail: "Produk tidak ada di master Aneka." };
  const rows = await listKtdStoreStok();
  const override = new Map(rows.map((r) => [r.aneka_id, r.stok]));
  const sekarang = override.get(anekaId) ?? (Number(master.stok) || 0);
  const baru = Math.max(0, sekarang - qty);
  if (baru === sekarang) {
    return { ok: true, diubah: 0, detail: "Stok KTD Store sudah 0." };
  }
  await upsertKtdStoreStok([{ aneka_id: anekaId, stok: baru }]);
  return { ok: true, diubah: 1, detail: `KTD Store: ${sekarang} → ${baru}.` };
}

async function kurangiTiktok(anekaId: string, qty: number): Promise<HasilKurangiStok> {
  const maps = await listAnekaProductMaps();
  const enabled = maps.filter(
    (m) => m.enabled === 1 && m.aneka_product_id === anekaId && m.tiktok_product_id,
  );
  if (enabled.length === 0) {
    return { ok: true, diubah: 0, detail: "Tanpa pemetaan TikTok." };
  }
  const tokens = await listTiktokShopTokens();
  if (tokens.length === 0) {
    return { ok: false, diubah: 0, detail: "Belum ada toko TikTok Shop yang terhubung." };
  }
  const prep = await prepareShop(tokens[0]);
  if (!prep.ok) return { ok: false, diubah: 0, detail: prep.detail };
  const ctx: TiktokShopCtx = { cipher: prep.cipher, access_token: prep.access_token };

  // Pilih listing dengan stok terbanyak; kesalahan API dicatat supaya
  // kegagalan sementara tidak dianggap "produk dihapus".
  let terpilih: {
    productId: string;
    total: number;
    skus: { id: string; inventory: { warehouseId: string; quantity: number }[] }[];
  } | null = null;
  let adaError = false;
  for (const m of enabled) {
    const d = await getTiktokProduct(ctx, m.tiktok_product_id);
    if (!d.ok) {
      adaError = true;
      continue;
    }
    const skus = d.product.skus.map((s) => ({
      id: s.id,
      inventory: s.inventory.map((w) => ({
        warehouseId: w.warehouseId,
        quantity: Number(w.quantity) || 0,
      })),
    }));
    const total = skus.reduce(
      (a, s) => a + s.inventory.reduce((b, w) => b + w.quantity, 0),
      0,
    );
    if (!terpilih || total > terpilih.total) {
      terpilih = { productId: m.tiktok_product_id, total, skus };
    }
  }
  if (!terpilih) {
    return adaError
      ? { ok: false, diubah: 0, detail: "Gagal membaca detail produk TikTok." }
      : { ok: true, diubah: 0, detail: "Produk TikTok tidak ditemukan (mungkin dihapus)." };
  }
  if (terpilih.total <= 0) {
    return { ok: true, diubah: 0, detail: "Stok TikTok sudah 0." };
  }
  const sekarangSku = terpilih.skus.map((s) =>
    s.inventory.reduce((a, w) => a + w.quantity, 0),
  );
  const perSku = kurangiDariTerbesar(sekarangSku, qty);
  const updates = terpilih.skus.map((s, i) => {
    const sekarangGudang = s.inventory.map((w) => w.quantity);
    const isi = kurangiDariTerbesar(sekarangGudang, sekarangSku[i] - perSku[i]);
    return {
      skuId: s.id,
      inventory: s.inventory.map((w, j) => ({
        warehouseId: w.warehouseId,
        quantity: isi[j],
      })),
    };
  });
  const r = await updateTiktokProductStocks(ctx, terpilih.productId, updates);
  if (!r.ok || r.errors.length > 0) {
    return { ok: false, diubah: 0, detail: r.detail || r.errors.join("; ") };
  }
  return {
    ok: true,
    diubah: 1,
    detail: `TikTok: ${terpilih.total} → ${Math.max(0, terpilih.total - qty)}.`,
  };
}

async function kurangiBlibli(anekaId: string, qty: number): Promise<HasilKurangiStok> {
  const maps = await listBlibliProductMaps();
  const enabled = maps.filter(
    (m) => m.enabled === 1 && m.aneka_product_id === anekaId && m.blibli_sku,
  );
  if (enabled.length === 0) {
    return { ok: true, diubah: 0, detail: "Tanpa pemetaan Blibli." };
  }
  let terpilih: {
    sku: string;
    total: number;
    vars: BlibliVariantRow[];
  } | null = null;
  let adaError = false;
  let pertama = true;
  for (const m of enabled) {
    if (!pertama) await tunda(2500);
    pertama = false;
    const vars = await getBlibliProductVariants(m.blibli_sku);
    if (!vars.ok) {
      adaError = true;
      continue;
    }
    const total = vars.data.reduce(
      (a, v) => a + (Number(v.stock?.seller?.available) || 0),
      0,
    );
    if (!terpilih || total > terpilih.total) {
      terpilih = { sku: m.blibli_sku, total, vars: vars.data };
    }
  }
  if (!terpilih) {
    return adaError
      ? { ok: false, diubah: 0, detail: "Gagal membaca stok Blibli." }
      : { ok: true, diubah: 0, detail: "Produk Blibli tidak ditemukan." };
  }
  if (terpilih.total <= 0) {
    return { ok: true, diubah: 0, detail: "Stok Blibli sudah 0." };
  }
  const current = terpilih.vars.map((v) => Number(v.stock?.seller?.available) || 0);
  const perVarian = kurangiDariTerbesar(current, qty);
  const requests: BlibliBulkItemUpdate[] = [];
  terpilih.vars.forEach((v, i) => {
    if (perVarian[i] === current[i]) return;
    requests.push({
      gdnSku: v.variant.blibliSku,
      pickupPointCode: v.pickupPoint.code,
      exactStock: perVarian[i],
    });
  });
  const r = await updateBlibliProductsBulk(requests);
  if (!r.ok) return { ok: false, diubah: 0, detail: r.detail };
  return {
    ok: true,
    diubah: requests.length,
    detail: `Blibli: ${terpilih.total} → ${Math.max(0, terpilih.total - qty)} (antrean).`,
  };
}

async function kurangiLazada(anekaId: string, qty: number): Promise<HasilKurangiStok> {
  const maps = await listLazadaProductMaps();
  const enabled = maps.filter(
    (m) => m.enabled === 1 && m.aneka_product_id === anekaId && m.lazada_sku,
  );
  if (enabled.length === 0) {
    return { ok: true, diubah: 0, detail: "Tanpa pemetaan Lazada." };
  }
  const keys = enabled.map((m) => m.lazada_sku);
  let r = await listLazadaProducts({ filter: "all", skuSellerList: keys, limit: 50 });
  for (
    let ulang = 0;
    !r.ok && /ApiCallLimit|E901/.test(r.detail) && ulang < 3;
    ulang++
  ) {
    await tunda(1500 * (ulang + 1));
    r = await listLazadaProducts({ filter: "all", skuSellerList: keys, limit: 50 });
  }
  if (!r.ok) return { ok: false, diubah: 0, detail: r.detail };

  // Pilih SellerSku dengan stok terbanyak.
  let terpilih: {
    sku: string;
    harga: number;
    quantity: number;
    skuId: string;
    itemId: string;
  } | null = null;
  for (const p of r.data.items) {
    for (const sku of p.skus ?? []) {
      const key = String(sku.SellerSku ?? "");
      if (!keys.includes(key)) continue;
      const qtySku = Number(sku.quantity ?? 0) || 0;
      if (terpilih && qtySku <= terpilih.quantity) continue;
      const price = Number(sku.price ?? 0) || 0;
      const special = Number(sku.special_price ?? 0);
      terpilih = {
        sku: key,
        harga: special > 0 && special < price ? special : price,
        quantity: qtySku,
        skuId: String(sku.SkuId ?? ""),
        itemId: String(p.item_id ?? ""),
      };
    }
  }
  if (!terpilih) {
    return { ok: true, diubah: 0, detail: "SellerSku tidak ditemukan di katalog Lazada." };
  }
  if (terpilih.quantity <= 0) {
    return { ok: true, diubah: 0, detail: "Stok Lazada sudah 0." };
  }
  const baru = Math.max(0, terpilih.quantity - qty);
  const up = await updateLazadaProductsBulk([
    {
      sellerSku: terpilih.sku,
      price: terpilih.harga,
      quantity: baru,
      skuId: terpilih.skuId || undefined,
      itemId: terpilih.itemId || undefined,
    },
  ]);
  if (!up.ok) return { ok: false, diubah: 0, detail: up.detail };
  return {
    ok: true,
    diubah: 1,
    detail: `Lazada: ${terpilih.quantity} → ${baru}.`,
  };
}

// ---------- Hook order selesai → kurangi stok semua kanal ----------

/** Flag per kanal pada baris kejadian. */
function sudahDiterapkan(ev: StokPenyesuaianRow, kanal: StokKanal): boolean {
  switch (kanal) {
    case "tiktok":
      return ev.tiktok_done === 1;
    case "blibli":
      return ev.blibli_done === 1;
    case "lazada":
      return ev.lazada_done === 1;
    default:
      return ev.ktd_done === 1;
  }
}

/** Kumpulkan pesanan TikTok berstatus COMPLETED (jendela 14 hari) menjadi
 *  kejadian stok. Kembalikan jumlah kejadian baru atau pesan kesalahan. */
async function kumpulkanKejadianTiktok(): Promise<number | string> {
  const [maps, tokens] = await Promise.all([
    listAnekaProductMaps(),
    listTiktokShopTokens(),
  ]);
  if (tokens.length === 0) {
    return "Belum ada toko TikTok Shop yang terhubung.";
  }
  const aktif = new Map<string, { anekaId: string; nama: string }>();
  for (const m of maps) {
    if (m.enabled !== 1 || !m.aneka_product_id) continue;
    aktif.set(m.tiktok_product_id, {
      anekaId: m.aneka_product_id,
      nama: m.aneka_product_name || m.tiktok_product_name || m.tiktok_product_id,
    });
  }
  let baru = 0;
  for (const shop of tokens) {
    const prep = await prepareShop(shop);
    if (!prep.ok) return prep.detail;
    const ord = await getTiktokOrders(
      { cipher: prep.cipher, access_token: prep.access_token },
      { daysBack: JENDELA_HARI, pageSize: 50 },
    );
    if (!ord.ok) return ord.detail;
    for (const o of ord.orders) {
      if (o.order_status !== "COMPLETED") continue;
      for (const it of o.items) {
        const qty = Number(it.sku_count ?? 0);
        if (qty <= 0) continue;
        const map = aktif.get(it.product_id);
        if (!map) continue; // belum dipetakan — tidak dicatat
        const id = `tiktok|${o.order_id}|${it.product_id}|${it.sku_id}`;
        const masuk = await insertStokPenyesuaian({
          id,
          channel: "tiktok",
          order_id: o.order_id,
          sku_key: `${it.product_id}|${it.sku_id}`,
          aneka_id: map.anekaId,
          nama: map.nama,
          qty,
        });
        if (!masuk) continue;
        baru++;
        // Kanal asal berkurang otomatis oleh TikTok — tandai selesai.
        await tandaiStokKanalSelesai(id, "tiktok", "kanal asal");
      }
    }
  }
  return baru;
}

/** Kumpulkan item Blibli berstatus D (terkirim) dari jendela 14 hari menjadi
 *  kejadian stok. Filter tanggal memakai jendela update status FP — kiriman
 *  yang FP-nya lebih lama dari jendela bisa terlewat (jarang, dan kejadian
 *  idempoten: tick berikut tetap aman). */
async function kumpulkanKejadianBlibli(): Promise<number | string> {
  const maps = await listBlibliProductMaps();
  const aktif = new Map<string, { anekaId: string; nama: string }>();
  for (const m of maps) {
    if (m.enabled !== 1 || !m.aneka_product_id) continue;
    aktif.set(m.blibli_sku, {
      anekaId: m.aneka_product_id,
      nama: m.product_name || m.blibli_sku,
    });
  }
  const now = Date.now();
  const ord = await listBlibliOrders({
    orderItemStatuses: ["D"],
    statusFPDateRange: { start: now - JENDELA_HARI * 86400_000, end: now },
    sorting: { by: "statusFPUpdatedTimestamp", direction: "DESC" },
    paging: { page: 0, size: 50 },
  });
  if (!ord.ok) return ord.detail;
  let baru = 0;
  for (const pkg of ord.data.packages) {
    for (const it of pkg.orderItems ?? []) {
      const qty = Number(it.order?.quantity ?? 0);
      if (qty <= 0) continue;
      const sku = blibliProductSku(it.product?.blibliSku || it.product?.sellerSku || "");
      if (!sku) continue;
      const map = aktif.get(sku);
      if (!map) continue; // belum dipetakan — tidak dicatat
      const id = `blibli|${it.order.itemId}|${sku}`;
      const masuk = await insertStokPenyesuaian({
        id,
        channel: "blibli",
        order_id: it.order.itemId,
        sku_key: sku,
        aneka_id: map.anekaId,
        nama: map.nama,
        qty,
      });
      if (!masuk) continue;
      baru++;
      await tandaiStokKanalSelesai(id, "blibli", "kanal asal");
    }
  }
  return baru;
}

/** Kumpulkan pesanan Lazada delivered (jendela 14 hari) menjadi kejadian
 *  stok per SellerSku (satu baris order item = satu unit; hanya item
 *  delivered yang dihitung). Maksimal 20 pesanan per jalan — sisanya
 *  menyusul di tick berikut. */
async function kumpulkanKejadianLazada(): Promise<number | string> {
  const maps = await listLazadaProductMaps();
  const aktif = new Map<string, { anekaId: string; nama: string }>();
  for (const m of maps) {
    if (m.enabled !== 1 || !m.aneka_product_id) continue;
    aktif.set(m.lazada_sku, {
      anekaId: m.aneka_product_id,
      nama: m.product_name || m.lazada_sku,
    });
  }
  const now = Date.now();
  const ord = await getLazadaOrders({
    status: "delivered",
    update_after: new Date(now - JENDELA_HARI * 86400_000).toISOString(),
    update_before: new Date(now).toISOString(),
    sort_by: "updated_at",
    sort_direction: "DESC",
    limit: 20,
  });
  if (!ord.ok) return ord.detail;
  let baru = 0;
  for (const o of ord.data.orders) {
    const items = await getLazadaOrderItems(o.order_id);
    if (!items.ok) return items.detail;
    const perSku = new Map<string, number>();
    for (const it of items.data) {
      if ((it.status ?? "").toLowerCase() !== "delivered") continue;
      // Kunci pemetaan = SellerSku; API kadang mengembalikannya sebagai
      // kolom "sku" (seller_sku kosong) — fallback supaya tetap cocok.
      const sku = String(it.seller_sku || it.sku || "");
      if (!sku) continue;
      perSku.set(sku, (perSku.get(sku) ?? 0) + 1);
    }
    for (const [sku, qty] of perSku) {
      const map = aktif.get(sku);
      if (!map) continue; // belum dipetakan — tidak dicatat
      const id = `lazada|${o.order_id}|${sku}`;
      const masuk = await insertStokPenyesuaian({
        id,
        channel: "lazada",
        order_id: o.order_id,
        sku_key: sku,
        aneka_id: map.anekaId,
        nama: map.nama,
        qty,
      });
      if (!masuk) continue;
      baru++;
      await tandaiStokKanalSelesai(id, "lazada", "kanal asal");
    }
    await tunda(400); // jeda antar panggilan /order/items/get
  }
  return baru;
}

/** Jalankan sinkronisasi stok otomatis penuh: kumpulkan order selesai baru
 *  dari TikTok/Blibli/Lazada, lalu terapkan pengurangan ke kanal-kanal yang
 *  belum menerimanya. Aman dipanggil berulang (idempoten per kejadian). Bila
 *  `skipIfWorkerFresh` dan worker VPS baru saja menjalankan ronde ini,
 *  sinkron dilewati. */
export async function cekOrderSelesaiSemuaChannel(opts?: {
  skipIfWorkerFresh?: boolean;
}): Promise<HasilCekOrderSelesai> {
  if (opts?.skipIfWorkerFresh && (await workerHeartbeatFresh("stok:sync"))) {
    return {
      ok: true,
      detail: "dilewati: worker VPS baru saja menjalankan",
      eventBaru: 0,
      diterapkan: {} as Record<StokKanal, number>,
      gagalKanal: [],
    };
  }
  const masalah: string[] = [];
  let eventBaru = 0;

  const t = await kumpulkanKejadianTiktok();
  if (typeof t === "string") masalah.push(`TikTok: ${t}`);
  else eventBaru += t;

  const b = await kumpulkanKejadianBlibli();
  if (typeof b === "string") masalah.push(`Blibli: ${b}`);
  else eventBaru += b;

  const l = await kumpulkanKejadianLazada();
  if (typeof l === "string") masalah.push(`Lazada: ${l}`);
  else eventBaru += l;

  // Terapkan antrean terbuka, dikelompokkan per kanal + produk supaya stok
  // dibaca sekali per produk (bukan sekali per kejadian). Kap per kanal per
  // jalan menjaga batas frekuensi API — sisanya menunggu tick berikut.
  const terbuka = await listStokPenyesuaianTerbuka(100);
  const diterapkan: Record<StokKanal, number> = { tiktok: 0, blibli: 0, lazada: 0, ktd: 0 };
  const gagalKanal: string[] = [];
  for (const kanal of KANAL_SEMUA) {
    const kap = KAP_PER_KANAL_PER_JALAN[kanal];
    const byAneka = new Map<string, { evs: StokPenyesuaianRow[]; qty: number }>();
    for (const ev of terbuka) {
      if (sudahDiterapkan(ev, kanal)) continue;
      const g = byAneka.get(ev.aneka_id);
      if (g) {
        g.qty += ev.qty;
        g.evs.push(ev);
      } else {
        byAneka.set(ev.aneka_id, { evs: [ev], qty: ev.qty });
      }
    }
    let diproses = 0;
    for (const [anekaId, g] of byAneka) {
      if (diproses >= kap) break;
      diproses++;
      const r = await kurangiStokChannel(kanal, anekaId, g.qty);
      if (!r.ok) {
        gagalKanal.push(`${kanal} · ${g.evs[0].nama || anekaId} (−${g.qty}): ${r.detail}`);
        continue;
      }
      for (const ev of g.evs) {
        await tandaiStokKanalSelesai(ev.id, kanal, r.detail || "");
      }
      if (r.diubah > 0) diterapkan[kanal] += g.evs.length;
    }
  }

  const ok = masalah.length === 0 && gagalKanal.length === 0;
  return {
    ok,
    detail: ok
      ? "Sinkronisasi stok otomatis selesai."
      : (masalah.concat(gagalKanal).join(" ") || "Sebagian gagal.").slice(0, 500),
    eventBaru,
    diterapkan,
    gagalKanal,
  };
}
