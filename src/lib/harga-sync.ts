// Sinkronisasi harga master Aneka → semua channel sekaligus (Tahap 3).
//
// Berbeda dari aturan harga massal per kanal (bulk-harga.ts): di sini HARGA
// TARGET eksplisit per produk Aneka (default rekomendasi jual master, bisa
// diubah di halaman Sinkron Harga) didorong ke tiap kanal tempat produk
// dipetakan — TikTok Shop (semua SKU produk), Blibli (semua varian), Lazada
// (SellerSku), dan KTD Store (tabel override, tanpa API eksternal).
//
// Snapshot "harga awal" disimpan otomatis per SKU SEBELUM penulisan
// (tabel harga_snapshot, sekali saja berkat ON CONFLICT DO NOTHING) — Reset
// di halaman massal tiap kanal bisa memulihkan seperti aturan massal.
// Batas 60 produk per panggilan (ceiling 60 detik serverless).
import type { BarisPratinjau, HasilTerapkan, Marketplace } from "@/lib/bulk-harga";
import { getAnekaMasterById, listAnekaMaster } from "@/lib/aneka-master";
import {
  getBlibliProductVariants,
  updateBlibliProductsBulk,
  type BlibliBulkItemUpdate,
} from "@/lib/blibli-products";
import {
  insertHargaSnapshot,
  listAnekaProductMaps,
  listBlibliProductMaps,
  listHargaSnapshot,
  listKtdStoreHarga,
  listLazadaProductMaps,
  listTiktokShopTokens,
  upsertKtdStoreHarga,
} from "@/lib/db";
import {
  listLazadaProducts,
  updateLazadaProductsBulk,
  type LazadaBulkItemUpdate,
} from "@/lib/lazada-products";
import { prepareShop } from "@/lib/tiktok-orders";
import {
  searchTiktokProducts,
  updateTiktokProductPrices,
  type TiktokShopCtx,
} from "@/lib/tiktok-products";

/** Satu produk Aneka + harga jual target (Rp, rupiah penuh). */
export type PilihanHargaSync = {
  anekaId: string;
  harga: number;
};

/** Batas keamanan eksekusi per permintaan (serverless 60 detik). */
const MAKS_PRODUK_SYNC = 60;

/** Jeda sederhana antar panggilan API Lazada (batas frekuensi ketat). */
const tunda = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Bersihkan pilihan: buang duplikat (per anekaId) dan harga tidak valid. */
function validPilihan(pilihan: PilihanHargaSync[]): PilihanHargaSync[] {
  const seen = new Set<string>();
  const out: PilihanHargaSync[] = [];
  for (const p of pilihan) {
    if (!p || !p.anekaId || seen.has(p.anekaId)) continue;
    const harga = Math.round(Number(p.harga));
    if (!Number.isFinite(harga) || harga < 1) continue;
    seen.add(p.anekaId);
    out.push({ anekaId: p.anekaId, harga });
  }
  return out;
}

// ---------- Pratinjau kanal KTD Store (berbasis master, bukan katalog lama) ----------

/** Pratinjau KTD Store untuk halaman Sinkron Harga: satu baris per produk
 *  MASTER Aneka (bukan snapshot katalog lama) — harga patokan = override
 *  tersimpan bila ada, selain itu rekomendasi jual master. Bentuk baris
 *  sama dengan pratinjau kanal lain supaya klien mengelompokkannya identik. */
export async function pratinjauKtdMaster(): Promise<
  | { ok: true; rows: BarisPratinjau[]; tanpaPemetaan: number; snapshotCount: number }
  | { ok: false; detail: string }
> {
  const [overrideRows, snapshots] = await Promise.all([
    listKtdStoreHarga(),
    listHargaSnapshot("ktd-store"),
  ]);
  const override = new Map(overrideRows.map((r) => [r.aneka_id, r.harga]));
  const snapKeys = new Set(snapshots.map((s) => s.sku_key));
  const rows: BarisPratinjau[] = [];
  for (const p of listAnekaMaster()) {
    const id = String(p.id ?? "");
    if (!id) continue;
    const modal = Number(p.hargaModal) || 0;
    const rekomendasi = Number(p.rekomendasiJual) || 0;
    const harga = override.get(id) ?? rekomendasi;
    rows.push({
      skuKey: id,
      productId: id,
      anekaId: id,
      skuId: "",
      productName: p.name,
      skuLabel: `Aneka #${id}`,
      hargaSekarang: harga,
      hargaSekarangMax: harga,
      modal,
      rekomendasiJual: rekomendasi,
      profit: modal > 0 ? harga - modal : 0,
      profitMax: modal > 0 ? harga - modal : 0,
      kenaAturan: false,
      aksi: "",
      jenis: "",
      nilai: 0,
      hargaBaru: harga,
      hargaBaruMax: harga,
      alasan: "",
      punyaSnapshot: snapKeys.has(id),
    });
  }
  rows.sort((a, b) => a.productName.localeCompare(b.productName, "id"));
  return { ok: true, rows, tanpaPemetaan: 0, snapshotCount: snapshots.length };
}

// ---------- Terapkan harga target ke satu kanal ----------

/** Terapkan harga target ke kanal terpilih. Harga segar dibaca dari kanal
 *  sebelum ditulis (dasar snapshot + pembanding perubahan); SKU yang sudah
 *  berharga target dilewati. */
export async function terapkanHargaSync(
  channel: Marketplace,
  pilihan: PilihanHargaSync[],
): Promise<HasilTerapkan> {
  const gagal: HasilTerapkan["gagal"] = [];
  const bersih = validPilihan(pilihan);
  if (bersih.length === 0) {
    return {
      ok: false,
      diubah: 0,
      gagal,
      detail: "Tidak ada produk dengan harga valid yang dipilih.",
      catatan: [],
    };
  }
  if (bersih.length > MAKS_PRODUK_SYNC) {
    return {
      ok: false,
      diubah: 0,
      gagal,
      detail: `Maksimal ${MAKS_PRODUK_SYNC} produk per sekali terapkan (dipilih ${bersih.length}) — terapkan bertahap.`,
      catatan: [],
    };
  }
  switch (channel) {
    case "tiktok":
      return syncTiktok(bersih);
    case "blibli":
      return syncBlibli(bersih);
    case "lazada":
      return syncLazada(bersih);
    default:
      return syncKtdStore(bersih);
  }
}

/** TikTok: harga target diterapkan ke SEMUA SKU produk (tingkat produk).
 *  Harga segar dipindai dari daftar produk ACTIVATE (maks 3 halaman × 100),
 *  lalu satu panggilan update harga per produk. */
async function syncTiktok(pilihan: PilihanHargaSync[]): Promise<HasilTerapkan> {
  const gagal: HasilTerapkan["gagal"] = [];
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

  // anekaId → product_id (hanya pemetaan aktif) + label untuk pesan gagal.
  const productByAneka = new Map<string, string>();
  const namaByAneka = new Map<string, string>();
  const namaByProduct = new Map<string, string>();
  for (const m of maps) {
    if (m.enabled !== 1) continue;
    productByAneka.set(m.aneka_product_id, m.tiktok_product_id);
    namaByAneka.set(m.aneka_product_id, m.aneka_product_name || `Aneka #${m.aneka_product_id}`);
    namaByProduct.set(m.tiktok_product_id, m.aneka_product_name || m.tiktok_product_name || m.tiktok_product_id);
  }
  const targetByProduct = new Map<string, number>();
  for (const p of pilihan) {
    const productId = productByAneka.get(p.anekaId);
    if (!productId) {
      gagal.push({
        skuKey: p.anekaId,
        label: namaByAneka.get(p.anekaId) ?? `Aneka #${p.anekaId}`,
        detail: "Tanpa pemetaan TikTok — petakan dulu di halaman Pemetaan.",
      });
      continue;
    }
    targetByProduct.set(productId, p.harga);
  }

  // Harga segar: pindai produk ACTIVATE, kumpulkan SKU produk terpilih.
  const perProduk = new Map<string, { skuId: string; amount: number }[]>();
  let token = "";
  let halaman = 0;
  do {
    const r = await searchTiktokProducts(ctx, {
      status: "ACTIVATE",
      pageSize: 100,
      pageToken: token || undefined,
    });
    if (!r.ok) return { ok: false, diubah: 0, gagal, detail: r.detail, catatan: [] };
    for (const p of r.items) {
      const target = targetByProduct.get(p.id);
      if (target === undefined) continue;
      const updates: { skuId: string; amount: number }[] = [];
      for (const sku of p.skus) {
        const sekarang = sku.price.display;
        if (sekarang === target) continue; // sudah sesuai — biarkan
        await insertHargaSnapshot({
          marketplace: "tiktok",
          sku_key: `${p.id}|${sku.id}`,
          product_id: p.id,
          sku_id: sku.id,
          product_name: p.title,
          sku_label: sku.sellerSku || sku.id,
          harga_regular: sekarang,
          harga_sale: 0,
          pickup_point_code: "",
        });
        updates.push({ skuId: sku.id, amount: target });
      }
      if (updates.length > 0) perProduk.set(p.id, updates);
      targetByProduct.delete(p.id); // produk sudah ditemukan
    }
    if (targetByProduct.size === 0) break;
    token = r.nextPageToken;
    halaman++;
  } while (token && halaman < 3);

  // Sisa yang tidak muncul di daftar produk Aktif.
  for (const [productId] of targetByProduct) {
    gagal.push({
      skuKey: productId,
      label: namaByProduct.get(productId) ?? productId,
      detail: "Tidak ditemukan lagi di daftar produk Aktif TikTok.",
    });
  }

  let diubah = 0;
  for (const [productId, updates] of perProduk) {
    const r = await updateTiktokProductPrices(ctx, productId, updates);
    if (r.ok && r.errors.length === 0) {
      diubah += updates.length;
      continue;
    }
    for (const u of updates) {
      gagal.push({
        skuKey: `${productId}|${u.skuId}`,
        label: u.skuId,
        detail: r.detail || r.errors.join("; "),
      });
    }
  }
  return { ok: diubah > 0 || gagal.length === 0, diubah, gagal, detail: "", catatan: [] };
}

/** Blibli: harga target diterapkan ke SEMUA varian produk (tingkat productSku).
 *  Harga sale digeser mengikuti regular (jarak dipertahankan, ≤ regular − 1).
 *  Penulisan lewat antrean update massal Blibli (asinkron — hasil final
 *  beberapa menit kemudian). */
async function syncBlibli(pilihan: PilihanHargaSync[]): Promise<HasilTerapkan> {
  const gagal: HasilTerapkan["gagal"] = [];
  const maps = await listBlibliProductMaps();
  const skuByAneka = new Map<string, string>();
  const mapBySku = new Map<string, { anekaId: string; productName: string }>();
  for (const m of maps) {
    if (m.enabled !== 1) continue;
    skuByAneka.set(m.aneka_product_id, m.blibli_sku);
    mapBySku.set(m.blibli_sku, {
      anekaId: m.aneka_product_id,
      productName: m.product_name || m.blibli_sku,
    });
  }
  const targetBySku = new Map<string, number>();
  for (const p of pilihan) {
    const sku = skuByAneka.get(p.anekaId);
    if (!sku) {
      gagal.push({
        skuKey: p.anekaId,
        label: `Aneka #${p.anekaId}`,
        detail: "Tanpa pemetaan Blibli — petakan dulu di halaman Pemetaan.",
      });
      continue;
    }
    targetBySku.set(sku, p.harga);
  }

  const requests: BlibliBulkItemUpdate[] = [];
  const berubah: { gdnSku: string; label: string }[] = [];
  for (const [sku, target] of targetBySku) {
    const map = mapBySku.get(sku);
    const vars = await getBlibliProductVariants(sku);
    if (!vars.ok) {
      gagal.push({ skuKey: sku, label: sku, detail: vars.detail });
      continue;
    }
    for (const v of vars.data) {
      const regular = Number(v.price.regular);
      const sale = Number(v.price.sale);
      if (regular === target) continue; // sudah sesuai — biarkan
      // Geser sale mengikuti regular agar tetap valid (≤ regular − 1).
      let saleBaru = sale;
      if (sale > 0) {
        const jarak = regular - sale;
        saleBaru = jarak > 0 ? Math.max(1, target - jarak) : Math.max(1, target - 1);
      }
      await insertHargaSnapshot({
        marketplace: "blibli",
        sku_key: v.variant.blibliSku,
        product_id: sku,
        sku_id: v.variant.blibliSku,
        product_name: map?.productName ?? sku,
        sku_label: v.variant.name || v.variant.sellerSku || v.variant.blibliSku,
        harga_regular: regular,
        harga_sale: sale,
        pickup_point_code: v.pickupPoint.code,
      });
      requests.push({
        gdnSku: v.variant.blibliSku,
        pickupPointCode: v.pickupPoint.code,
        price: target,
        salePrice: saleBaru,
      });
      berubah.push({
        gdnSku: v.variant.blibliSku,
        label: v.variant.name || v.variant.sellerSku || v.variant.blibliSku,
      });
    }
  }

  let diubah = 0;
  const catatan: string[] = [];
  for (let i = 0; i < requests.length; i += 100) {
    const chunk = requests.slice(i, i + 100);
    const r = await updateBlibliProductsBulk(chunk);
    if (!r.ok) {
      for (const c of chunk) {
        const b = berubah.find((x) => x.gdnSku === c.gdnSku);
        gagal.push({ skuKey: c.gdnSku, label: b?.label ?? c.gdnSku, detail: r.detail });
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

/** Lazada: harga target diterapkan ke SellerSku. Harga + stok segar dibaca
 *  lewat sku_seller_list (kelompok maks 50 — hasil /products/get terpotong
 *  50 baris); stok saat ini ikut dikirim karena UpdatePriceQuantity wajib
 *  memuat Price + Quantity. Penulisan sinkron seperti TikTok. */
async function syncLazada(pilihan: PilihanHargaSync[]): Promise<HasilTerapkan> {
  const gagal: HasilTerapkan["gagal"] = [];
  const maps = await listLazadaProductMaps();
  const skuByAneka = new Map<string, string>();
  const mapBySku = new Map<string, { anekaId: string; productName: string }>();
  for (const m of maps) {
    if (m.enabled !== 1) continue;
    skuByAneka.set(m.aneka_product_id, m.lazada_sku);
    mapBySku.set(m.lazada_sku, {
      anekaId: m.aneka_product_id,
      productName: m.product_name || m.lazada_sku,
    });
  }
  const targetBySku = new Map<string, number>();
  for (const p of pilihan) {
    const sku = skuByAneka.get(p.anekaId);
    if (!sku) {
      gagal.push({
        skuKey: p.anekaId,
        label: `Aneka #${p.anekaId}`,
        detail: "Tanpa pemetaan Lazada — petakan dulu di halaman Pemetaan.",
      });
      continue;
    }
    targetBySku.set(sku, p.harga);
  }

  // Harga + stok segar lewat sku_seller_list (kelompok maks 50 SKU).
  const keys = [...targetBySku.keys()];
  const segar = new Map<
    string,
    { harga: number; stok: number; nama: string; skuId: string; itemId: string }
  >();
  for (let i = 0; i < keys.length; i += 50) {
    const chunk = keys.slice(i, i + 50);
    let r = await listLazadaProducts({ filter: "all", skuSellerList: chunk, limit: 50 });
    // ApiCallLimit/E901 = ban sementara beberapa detik — coba lagi.
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
        gagal.push({ skuKey: sku, label: sku, detail: r.detail });
      }
      continue;
    }
    for (const p of r.data.items) {
      const nama = String(p.attributes?.name ?? "");
      for (const sku of p.skus ?? []) {
        const key = String(sku.SellerSku ?? "");
        if (!key || segar.has(key)) continue;
        const price = Number(sku.price ?? 0) || 0;
        const special = Number(sku.special_price ?? 0);
        segar.set(key, {
          harga: special > 0 && special < price ? special : price,
          stok: Number(sku.quantity ?? 0) || 0,
          nama: nama || key,
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
        skuKey: sku,
        label: sku,
        detail: "Tidak ditemukan di katalog Lazada (periksa SellerSku).",
      });
      continue;
    }
    if (f.harga === target) continue; // sudah sesuai — biarkan
    const map = mapBySku.get(sku);
    await insertHargaSnapshot({
      marketplace: "lazada",
      sku_key: sku,
      product_id: sku,
      sku_id: "",
      product_name: map?.productName ?? f.nama,
      sku_label: sku,
      harga_regular: f.harga,
      harga_sale: 0,
      pickup_point_code: "",
    });
    requests.push({
      sellerSku: sku,
      price: target,
      quantity: f.stok,
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
          skuKey: c.sellerSku,
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

/** KTD Store: simpan override harga per id Aneka (tabel ktd_store_harga yang
 *  dibaca situs toko). Murni basis data — tanpa API eksternal. */
async function syncKtdStore(pilihan: PilihanHargaSync[]): Promise<HasilTerapkan> {
  const gagal: HasilTerapkan["gagal"] = [];
  const overrideRows = await listKtdStoreHarga();
  const override = new Map(overrideRows.map((r) => [r.aneka_id, r.harga]));
  const akanSimpan: { aneka_id: string; harga: number }[] = [];
  for (const p of pilihan) {
    const master = getAnekaMasterById(p.anekaId);
    if (!master) {
      gagal.push({
        skuKey: p.anekaId,
        label: `Aneka #${p.anekaId}`,
        detail: "Produk tidak ada di master Aneka — jalankan ulang sweep.",
      });
      continue;
    }
    const sekarang =
      override.get(p.anekaId) ?? (Number(master.rekomendasiJual) || 0);
    if (sekarang === p.harga) continue; // sudah sesuai — biarkan
    await insertHargaSnapshot({
      marketplace: "ktd-store",
      sku_key: p.anekaId,
      product_id: p.anekaId,
      sku_id: "",
      product_name: master.name,
      sku_label: `Aneka #${p.anekaId}`,
      harga_regular: sekarang,
      harga_sale: 0,
      pickup_point_code: "",
    });
    akanSimpan.push({ aneka_id: p.anekaId, harga: p.harga });
  }
  await upsertKtdStoreHarga(akanSimpan);
  return {
    ok: akanSimpan.length > 0 || gagal.length === 0,
    diubah: akanSimpan.length,
    gagal,
    detail: "",
    catatan:
      akanSimpan.length > 0
        ? ["Situs toko memakai harga baru dalam beberapa menit (cache)."]
        : [],
  };
}
