// Aturan harga massal berbasis profit Aneka dropship (TikTok Shop + Blibli).
//
// Konsep:
//  - Profit per SKU = harga jual marketplace − hargaModal produk Aneka
//    (dari pemetaan aneka_product_map / blibli_product_map → snapshot
//    aneka-catalog.json). Modal level PRODUK — untuk produk bervarian
//    profitnya perkiraan.
//  - Aturan bertingkat: daftar berurutan, tiap aturan = rentang profit +
//    aksi (potong/naik, Rp/%). Aturan pertama yang cocok menang.
//  - Snapshot "harga awal" disimpan OTOMATIS sebelum perubahan massal
//    pertama (hanya SKU yang benar-benar berubah) — tombol Reset Semua
//    memulihkannya lalu menghapus snapshot yang berhasil.
import { findAnekaCatalogById, listAnekaCatalog } from "@/lib/aneka-map";
import {
  getBlibliProductVariants,
  listBlibliProducts,
  updateBlibliProductsBulk,
  type BlibliBulkItemUpdate,
} from "@/lib/blibli-products";
import {
  listLazadaProducts,
  updateLazadaProductsBulk,
  type LazadaBulkItemUpdate,
} from "@/lib/lazada-products";
import {
  deleteHargaSnapshot,
  deleteHargaSnapshotBanyak,
  deleteKtdStoreHarga,
  insertHargaSnapshot,
  listAnekaProductMaps,
  listAturanHarga,
  listBlibliProductMaps,
  listHargaSnapshot,
  listKtdStoreHarga,
  listLazadaProductMaps,
  listTiktokShopTokens,
  upsertKtdStoreHarga,
  type AturanHargaRow,
  type HargaSnapshotRow,
} from "@/lib/db";
import { prepareShop } from "@/lib/tiktok-orders";
import {
  searchTiktokProducts,
  updateTiktokProductPrices,
  type TiktokShopCtx,
} from "@/lib/tiktok-products";

export type Marketplace = "tiktok" | "blibli" | "lazada" | "ktd-store";

/** Satu aturan dalam bentuk yang dikirim/diterima UI. */
export type AturanSimpan = {
  id: string;
  posisi: number;
  minProfit: number;
  /** null = tanpa batas atas. */
  maxProfit: number | null;
  aksi: "potong" | "naik";
  jenis: "rp" | "persen";
  nilai: number;
  aktif: boolean;
};

/** Batas keamanan eksekusi per permintaan (serverless 60 detik). */
const MAKS_PRODUK_TERAPKAN = 60;

/** Jeda sederhana antar panggilan API Lazada (batas frekuensi ketat). */
const tunda = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "Rp18.450" → 18450. Katalog Aneka bersih (tanpa rentang "/"). */
function parseRpModal(s: string): number {
  const n = Number(String(s ?? "").replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Validasi daftar aturan sebelum disimpan — null = valid. */
export function validasiAturanSimpan(rows: AturanSimpan[]): string | null {
  // Daftar kosong sah: artinya semua aturan dihapus (editor mengirim daftar
  // kosong saat aturan terakhir dihapus, dan tombol Simpan tidak lagi
  // dinonaktifkan pada daftar kosong).
  if (!Array.isArray(rows)) {
    return "aturan wajib berupa daftar.";
  }
  if (rows.length > 20) return "Maksimal 20 aturan.";
  for (const r of rows) {
    if (!Number.isInteger(r.minProfit) || r.minProfit < 0) {
      return "Batas profit minimum harus bilangan bulat ≥ 0.";
    }
    if (r.maxProfit !== null && !Number.isInteger(r.maxProfit)) {
      return "Batas profit maksimum harus bilangan bulat atau kosong.";
    }
    if (r.maxProfit !== null && r.maxProfit < r.minProfit) {
      return "Batas maksimum tidak boleh lebih kecil dari batas minimum.";
    }
    if (r.aksi !== "potong" && r.aksi !== "naik") {
      return "Aksi aturan tidak dikenal.";
    }
    if (r.jenis !== "rp" && r.jenis !== "persen") {
      return "Jenis nilai aturan tidak dikenal.";
    }
    if (!Number.isFinite(r.nilai) || r.nilai <= 0) {
      return "Nilai aturan harus angka > 0.";
    }
    if (r.jenis === "persen" && r.nilai > 90) {
      return "Nilai persen maksimal 90%.";
    }
  }
  return null;
}

/** Harga baru setelah aturan diterapkan (dibulatkan ke rupiah penuh). */
export function hitungHargaBaru(
  hargaSekarang: number,
  aksi: "potong" | "naik",
  jenis: "rp" | "persen",
  nilai: number,
): number {
  if (jenis === "rp") {
    return aksi === "potong" ? hargaSekarang - nilai : hargaSekarang + nilai;
  }
  const delta = Math.round((hargaSekarang * nilai) / 100);
  return aksi === "potong" ? hargaSekarang - delta : hargaSekarang + delta;
}

/** Aturan aktif pertama (urut posisi) yang rentangnya memuat profit. */
export function cocokAturan(
  profit: number,
  aturan: AturanHargaRow[],
): AturanHargaRow | null {
  for (const a of aturan) {
    if (a.aktif !== 1) continue;
    if (profit < a.min_profit) continue;
    if (a.max_profit !== null && profit > a.max_profit) continue;
    return a;
  }
  return null;
}

/** Modal & rekomendasi jual produk Aneka dari snapshot katalog. */
function infoModalAneka(
  anekaProductId: string,
): { modal: number; rekomendasiJual: number } | null {
  const cat = findAnekaCatalogById(anekaProductId);
  if (!cat) return null;
  const modal = parseRpModal(cat.hargaModal);
  if (modal <= 0) return null;
  return { modal, rekomendasiJual: parseRpModal(cat.rekomendasiJual) };
}

// ---------- Tipe hasil ----------

/** Satu baris pratinjau (bentuk normalisasi kedua marketplace). */
export type BarisPratinjau = {
  /** Kunci pilihan: TikTok `productId|skuId`, Blibli productSku. */
  skuKey: string;
  productId: string;
  /** TikTok: sku id; Blibli: "" (tingkat produk). */
  skuId: string;
  productName: string;
  /** TikTok: sellerSku; Blibli: productSku. */
  skuLabel: string;
  hargaSekarang: number;
  /** Blibli: harga varian tertinggi; TikTok: sama dengan hargaSekarang. */
  hargaSekarangMax: number;
  modal: number;
  rekomendasiJual: number;
  profit: number;
  profitMax: number;
  kenaAturan: boolean;
  aksi: string;
  jenis: string;
  nilai: number;
  hargaBaru: number;
  hargaBaruMax: number;
  alasan: string;
  punyaSnapshot: boolean;
};

export type HasilTerapkan = {
  ok: boolean;
  diubah: number;
  gagal: { skuKey: string; label: string; detail: string }[];
  detail: string;
  catatan: string[];
};

export type HasilReset = {
  ok: boolean;
  dipulihkan: number;
  gagal: { skuKey: string; label: string; detail: string }[];
  detail: string;
  catatan: string[];
};

// ---------- Pratinjau ----------

/** Susun satu baris pratinjau dari harga + modal + aturan. */
function barisPratinjau(opts: {
  skuKey: string;
  productId: string;
  skuId: string;
  productName: string;
  skuLabel: string;
  harga: number;
  hargaMax: number;
  infoModal: { modal: number; rekomendasiJual: number } | null;
  alasanModal: string;
  aturan: AturanHargaRow[];
  punyaSnapshot: boolean;
}): BarisPratinjau {
  const dasar: BarisPratinjau = {
    skuKey: opts.skuKey,
    productId: opts.productId,
    skuId: opts.skuId,
    productName: opts.productName,
    skuLabel: opts.skuLabel,
    hargaSekarang: opts.harga,
    hargaSekarangMax: opts.hargaMax,
    modal: 0,
    rekomendasiJual: 0,
    profit: 0,
    profitMax: 0,
    kenaAturan: false,
    aksi: "",
    jenis: "",
    nilai: 0,
    hargaBaru: opts.harga,
    hargaBaruMax: opts.hargaMax,
    alasan: opts.alasanModal,
    punyaSnapshot: opts.punyaSnapshot,
  };
  if (!opts.infoModal) return dasar;

  const { modal, rekomendasiJual } = opts.infoModal;
  dasar.modal = modal;
  dasar.rekomendasiJual = rekomendasiJual;
  dasar.profit = opts.harga - modal;
  dasar.profitMax = opts.hargaMax - modal;

  const a = cocokAturan(dasar.profit, opts.aturan);
  if (!a) {
    dasar.alasan = "Profit tidak masuk aturan mana pun";
    return dasar;
  }
  const baru = hitungHargaBaru(opts.harga, a.aksi as "potong" | "naik", a.jenis as "rp" | "persen", a.nilai);
  const baruMax = hitungHargaBaru(
    opts.hargaMax,
    a.aksi as "potong" | "naik",
    a.jenis as "rp" | "persen",
    a.nilai,
  );
  dasar.aksi = a.aksi;
  dasar.jenis = a.jenis;
  dasar.nilai = a.nilai;
  dasar.hargaBaru = baru;
  dasar.hargaBaruMax = baruMax;
  if (baru === opts.harga && baruMax === opts.hargaMax) {
    dasar.alasan = "Perubahan kurang dari Rp 1 (pembulatan)";
    return dasar;
  }
  if (baru < 1) {
    dasar.alasan = "Harga baru di bawah Rp 1 — aturan dilewati";
    return dasar;
  }
  dasar.kenaAturan = true;
  dasar.alasan = "";
  return dasar;
}

/** Pratinjau TikTok: semua SKU produk ACTIVATE (maks 3 halaman × 100). */
export async function pratinjauTiktok(): Promise<
  | { ok: true; shopName: string; rows: BarisPratinjau[]; tanpaPemetaan: number; snapshotCount: number }
  | { ok: false; detail: string }
> {
  const [aturan, maps, snapshots, tokens] = await Promise.all([
    listAturanHarga("tiktok"),
    listAnekaProductMaps(),
    listHargaSnapshot("tiktok"),
    listTiktokShopTokens(),
  ]);
  if (tokens.length === 0) {
    return { ok: false, detail: "Belum ada toko TikTok Shop yang terhubung." };
  }
  const prep = await prepareShop(tokens[0]);
  if (!prep.ok) return { ok: false, detail: prep.detail };
  const ctx: TiktokShopCtx = { cipher: prep.cipher, access_token: prep.access_token };
  const byMap = new Map(
    maps.filter((m) => m.enabled === 1).map((m) => [m.tiktok_product_id, m]),
  );
  const snapKeys = new Set(snapshots.map((s) => s.sku_key));
  const rows: BarisPratinjau[] = [];
  let tanpaPemetaan = 0;
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
      const map = byMap.get(p.id);
      const info = map ? infoModalAneka(map.aneka_product_id) : null;
      if (!info) tanpaPemetaan++;
      for (const sku of p.skus) {
        rows.push(
          barisPratinjau({
            skuKey: `${p.id}|${sku.id}`,
            productId: p.id,
            skuId: sku.id,
            productName: p.title,
            skuLabel: sku.sellerSku || sku.id,
            harga: sku.price.display,
            hargaMax: sku.price.display,
            infoModal: info,
            alasanModal: info
              ? "Tanpa pemetaan Aneka — petakan dulu di halaman Pemetaan"
              : "Tanpa pemetaan Aneka — petakan dulu di halaman Pemetaan",
            aturan,
            punyaSnapshot: snapKeys.has(`${p.id}|${sku.id}`),
          }),
        );
      }
    }
    token = r.nextPageToken;
    halaman++;
  } while (token && halaman < 3);
  rows.sort((a, b) => a.productName.localeCompare(b.productName, "id"));
  return {
    ok: true,
    shopName: String(tokens[0].shop_name ?? ""),
    rows,
    tanpaPemetaan,
    snapshotCount: snapshots.length,
  };
}

/** Pratinjau Blibli: produk ACTIVE tingkat produk (harga varian terendah
 *  sebagai patokan konservatif — varian dinilai ulang saat eksekusi). */
export async function pratinjauBlibli(): Promise<
  | { ok: true; rows: BarisPratinjau[]; tanpaPemetaan: number; snapshotCount: number }
  | { ok: false; detail: string }
> {
  const [aturan, maps, snapshots] = await Promise.all([
    listAturanHarga("blibli"),
    listBlibliProductMaps(),
    listHargaSnapshot("blibli"),
  ]);
  const byMap = new Map(
    maps.filter((m) => m.enabled === 1).map((m) => [m.blibli_sku, m]),
  );
  const snapProductIds = new Set(snapshots.map((s) => s.product_id));
  const rows: BarisPratinjau[] = [];
  let tanpaPemetaan = 0;
  let page = 0;
  for (;;) {
    const r = await listBlibliProducts({ state: "ACTIVE", page, size: 50 });
    if (!r.ok) return { ok: false, detail: r.detail };
    for (const p of r.data.items) {
      const sku = String(p.product.sku ?? "");
      if (!sku) continue;
      const map = byMap.get(sku);
      const info = map ? infoModalAneka(map.aneka_product_id) : null;
      if (!info) tanpaPemetaan++;
      rows.push(
        barisPratinjau({
          skuKey: sku,
          productId: sku,
          skuId: "",
          productName: p.product.name,
          skuLabel: sku,
          harga: Number(p.price.normal.min ?? 0),
          hargaMax: Number(p.price.normal.max ?? 0),
          infoModal: info,
          alasanModal: "Tanpa pemetaan Aneka — petakan dulu di halaman Pemetaan",
          aturan,
          punyaSnapshot: snapProductIds.has(sku),
        }),
      );
    }
    if (r.data.items.length < 50 || page >= 40) break;
    page++;
  }
  rows.sort((a, b) => a.productName.localeCompare(b.productName, "id"));
  return {
    ok: true,
    rows,
    tanpaPemetaan,
    snapshotCount: snapshots.length,
  };
}

/** Pratinjau Lazada: semua SKU produk (filter "all"), satu baris per
 *  SellerSku — kunci pemetaan tingkat produk (satu SellerSku menaungi
 *  semua varian). Harga patokan = special_price bila aktif dan lebih murah,
 *  selain itu price. */
export async function pratinjauLazada(): Promise<
  | { ok: true; rows: BarisPratinjau[]; tanpaPemetaan: number; snapshotCount: number }
  | { ok: false; detail: string }
> {
  const [aturan, maps, snapshots] = await Promise.all([
    listAturanHarga("lazada"),
    listLazadaProductMaps(),
    listHargaSnapshot("lazada"),
  ]);
  const byMap = new Map(
    maps.filter((m) => m.enabled === 1).map((m) => [m.lazada_sku, m]),
  );
  const snapKeys = new Set(snapshots.map((s) => s.sku_key));
  const rows: BarisPratinjau[] = [];
  let tanpaPemetaan = 0;
  let page = 0;
  for (;;) {
    let r = await listLazadaProducts({
      filter: "all",
      offset: page * 50,
      limit: 50,
    });
    // ApiCallLimit = ban sementara beberapa detik karena panggilan beruntun
    // tanpa jeda (katalog ±700 SKU = 15 halaman) — coba lagi sebelum menyerah.
    for (
      let ulang = 0;
      !r.ok && /ApiCallLimit|E901/.test(r.detail) && ulang < 3;
      ulang++
    ) {
      await tunda(1500 * (ulang + 1));
      r = await listLazadaProducts({
        filter: "all",
        offset: page * 50,
        limit: 50,
      });
    }
    if (!r.ok) return { ok: false, detail: r.detail };
    for (const p of r.data.items) {
      const nama = String(p.attributes?.name ?? "");
      for (const sku of p.skus ?? []) {
        const key = String(sku.SellerSku ?? "");
        if (!key) continue;
        const price = Number(sku.price ?? 0) || 0;
        const special = Number(sku.special_price ?? 0);
        const harga = special > 0 && special < price ? special : price;
        const map = byMap.get(key);
        const info = map ? infoModalAneka(map.aneka_product_id) : null;
        if (!info) tanpaPemetaan++;
        rows.push(
          barisPratinjau({
            skuKey: key,
            productId: key,
            skuId: "",
            productName: nama || key,
            skuLabel: key,
            harga,
            hargaMax: harga,
            infoModal: info,
            alasanModal: "Tanpa pemetaan Aneka — petakan dulu di halaman Pemetaan",
            aturan,
            punyaSnapshot: snapKeys.has(key),
          }),
        );
      }
    }
    if (r.data.items.length < 50 || page >= 40) break;
    page++;
    await tunda(600); // kurangi tekanan ke batas frekuensi Lazada
  }
  rows.sort((a, b) => a.productName.localeCompare(b.productName, "id"));
  return {
    ok: true,
    rows,
    tanpaPemetaan,
    snapshotCount: snapshots.length,
  };
}

/** Pratinjau KTD Store: seluruh produk katalog Aneka (situs toko sendiri) —
 *  satu baris per produk, tanpa pemetaan karena katalog Aneka ADALAH
 *  katalog toko. Harga patokan = override tersimpan bila ada, selain itu
 *  rekomendasi jual Aneka. */
export async function pratinjauKtdStore(): Promise<
  | { ok: true; rows: BarisPratinjau[]; tanpaPemetaan: number; snapshotCount: number }
  | { ok: false; detail: string }
> {
  const [aturan, snapshots, overrideRows] = await Promise.all([
    listAturanHarga("ktd-store"),
    listHargaSnapshot("ktd-store"),
    listKtdStoreHarga(),
  ]);
  const override = new Map(overrideRows.map((r) => [r.aneka_id, r.harga]));
  const snapKeys = new Set(snapshots.map((s) => s.sku_key));
  const rows: BarisPratinjau[] = [];
  for (const p of listAnekaCatalog()) {
    const id = String(p.id ?? "");
    if (!id) continue;
    const info = infoModalAneka(id);
    const harga = info ? (override.get(id) ?? info.rekomendasiJual) : 0;
    rows.push(
      barisPratinjau({
        skuKey: id,
        productId: id,
        skuId: "",
        productName: p.name,
        skuLabel: `Aneka #${id}`,
        harga,
        hargaMax: harga,
        infoModal: info,
        alasanModal: "Modal Aneka tidak ditemukan di snapshot katalog",
        aturan,
        punyaSnapshot: snapKeys.has(id),
      }),
    );
  }
  rows.sort((a, b) => a.productName.localeCompare(b.productName, "id"));
  return { ok: true, rows, tanpaPemetaan: 0, snapshotCount: snapshots.length };
}

// ---------- Terapkan ----------

/** Terapkan aturan ke SKU TikTok terpilih (kunci `productId|skuId`).
 *  Harga segar diambil dari API sebelum dihitung ulang; snapshot harga awal
 *  disimpan SEBELUM penulisan (hanya SKU yang benar-benar berubah). */
export async function terapkanTiktok(
  pilihan: string[],
): Promise<HasilTerapkan> {
  const gagal: HasilTerapkan["gagal"] = [];
  if (!Array.isArray(pilihan) || pilihan.length === 0) {
    return { ok: false, diubah: 0, gagal, detail: "Tidak ada SKU yang dipilih.", catatan: [] };
  }
  const [aturan, maps, tokens] = await Promise.all([
    listAturanHarga("tiktok"),
    listAnekaProductMaps(),
    listTiktokShopTokens(),
  ]);
  if (tokens.length === 0) {
    return { ok: false, diubah: 0, gagal, detail: "Belum ada toko TikTok Shop yang terhubung.", catatan: [] };
  }
  const prep = await prepareShop(tokens[0]);
  if (!prep.ok) return { ok: false, diubah: 0, gagal, detail: prep.detail, catatan: [] };
  const ctx: TiktokShopCtx = { cipher: prep.cipher, access_token: prep.access_token };
  const byMap = new Map(
    maps.filter((m) => m.enabled === 1).map((m) => [m.tiktok_product_id, m]),
  );

  // Harga segar: pindai produk ACTIVATE, ambil SKU yang dipilih.
  const dipilih = new Set(pilihan);
  const segar = new Map<
    string,
    { productId: string; title: string; skuId: string; label: string; harga: number }
  >();
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
      for (const sku of p.skus) {
        const key = `${p.id}|${sku.id}`;
        if (dipilih.has(key)) {
          segar.set(key, {
            productId: p.id,
            title: p.title,
            skuId: sku.id,
            label: sku.sellerSku || sku.id,
            harga: sku.price.display,
          });
        }
      }
    }
    token = r.nextPageToken;
    halaman++;
  } while (token && halaman < 3);

  const produkTerpilih = new Set<string>();
  for (const key of pilihan) {
    const f = segar.get(key);
    if (!f) {
      gagal.push({ skuKey: key, label: key, detail: "Tidak ditemukan lagi di daftar produk Aktif." });
      continue;
    }
    produkTerpilih.add(f.productId);
  }
  if (produkTerpilih.size > MAKS_PRODUK_TERAPKAN) {
    return {
      ok: false,
      diubah: 0,
      gagal,
      detail: `Maksimal ${MAKS_PRODUK_TERAPKAN} produk per sekali terapkan (dipilih ${produkTerpilih.size}) — terapkan bertahap.`,
      catatan: [],
    };
  }

  // Hitung nilai baru + snapshot per SKU, kelompokkan per produk.
  const perProduk = new Map<string, { skuId: string; amount: number }[]>();
  const diubahBaris: { key: string; label: string; productName: string }[] = [];
  for (const key of pilihan) {
    const f = segar.get(key);
    if (!f) continue; // sudah dicatat gagal di atas
    const map = byMap.get(f.productId);
    const info = map ? infoModalAneka(map.aneka_product_id) : null;
    if (!info) {
      gagal.push({ skuKey: key, label: f.label, detail: "Tanpa pemetaan Aneka — petakan dulu di halaman Pemetaan." });
      continue;
    }
    const profit = f.harga - info.modal;
    const a = cocokAturan(profit, aturan);
    if (!a) continue; // tidak kena aturan — biarkan (bukan gagal)
    const baru = hitungHargaBaru(
      f.harga,
      a.aksi as "potong" | "naik",
      a.jenis as "rp" | "persen",
      a.nilai,
    );
    if (baru < 1 || baru === f.harga) {
      gagal.push({
        skuKey: key,
        label: f.label,
        detail: baru < 1 ? "Harga baru di bawah Rp 1 — dilewati." : "Perubahan kurang dari Rp 1 — dilewati.",
      });
      continue;
    }
    await insertHargaSnapshot({
      marketplace: "tiktok",
      sku_key: key,
      product_id: f.productId,
      sku_id: f.skuId,
      product_name: f.title,
      sku_label: f.label,
      harga_regular: f.harga,
      harga_sale: 0,
      pickup_point_code: "",
    });
    const arr = perProduk.get(f.productId) ?? [];
    arr.push({ skuId: f.skuId, amount: baru });
    perProduk.set(f.productId, arr);
    diubahBaris.push({ key, label: f.label, productName: f.title });
  }

  let diubah = 0;
  for (const [productId, updates] of perProduk) {
    const r = await updateTiktokProductPrices(ctx, productId, updates);
    if (r.ok && r.errors.length === 0) {
      diubah += updates.length;
      continue;
    }
    for (const u of updates) {
      const baris = diubahBaris.find((b) => b.key === `${productId}|${u.skuId}`);
      gagal.push({
        skuKey: `${productId}|${u.skuId}`,
        label: baris?.label ?? u.skuId,
        detail: r.detail || r.errors.join("; "),
      });
    }
  }

  return {
    ok: diubah > 0 || gagal.length === 0,
    diubah,
    gagal,
    detail: "",
    catatan: [],
  };
}

/** Terapkan aturan ke produk Blibli terpilih (kunci = productSku). Tiap
 *  varian dinilai ulang sendiri saat eksekusi; harga regular & sale digeser
 *  bersamaan (sale dijaga tetap ≤ regular − 1). Penulisan lewat antrean
 *  update massal Blibli (asinkron — hasil final beberapa menit kemudian). */
export async function terapkanBlibli(
  pilihan: string[],
): Promise<HasilTerapkan> {
  const gagal: HasilTerapkan["gagal"] = [];
  if (!Array.isArray(pilihan) || pilihan.length === 0) {
    return { ok: false, diubah: 0, gagal, detail: "Tidak ada produk yang dipilih.", catatan: [] };
  }
  if (pilihan.length > MAKS_PRODUK_TERAPKAN) {
    return {
      ok: false,
      diubah: 0,
      gagal,
      detail: `Maksimal ${MAKS_PRODUK_TERAPKAN} produk per sekali terapkan (dipilih ${pilihan.length}) — terapkan bertahap.`,
      catatan: [],
    };
  }
  const [aturan, maps] = await Promise.all([
    listAturanHarga("blibli"),
    listBlibliProductMaps(),
  ]);
  const byMap = new Map(
    maps.filter((m) => m.enabled === 1).map((m) => [m.blibli_sku, m]),
  );

  const requests: BlibliBulkItemUpdate[] = [];
  const berubah: { gdnSku: string; label: string }[] = [];
  for (const sku of pilihan) {
    const map = byMap.get(sku);
    if (!map) {
      gagal.push({ skuKey: sku, label: sku, detail: "Tanpa pemetaan Aneka — petakan dulu di halaman Pemetaan." });
      continue;
    }
    const info = infoModalAneka(map.aneka_product_id);
    if (!info) {
      gagal.push({ skuKey: sku, label: sku, detail: "Harga modal Aneka tidak ditemukan di katalog — refresh snapshot katalog." });
      continue;
    }
    const vars = await getBlibliProductVariants(sku);
    if (!vars.ok) {
      gagal.push({ skuKey: sku, label: sku, detail: vars.detail });
      continue;
    }
    for (const v of vars.data) {
      const profit = Number(v.price.regular) - info.modal;
      const a = cocokAturan(profit, aturan);
      if (!a) continue; // varian tidak kena aturan — biarkan
      const regular = Number(v.price.regular);
      const sale = Number(v.price.sale);
      const baru = hitungHargaBaru(
        regular,
        a.aksi as "potong" | "naik",
        a.jenis as "rp" | "persen",
        a.nilai,
      );
      if (baru < 1 || baru === regular) {
        gagal.push({
          skuKey: v.variant.blibliSku,
          label: v.variant.name || v.variant.sellerSku || v.variant.blibliSku,
          detail: baru < 1 ? "Harga baru di bawah Rp 1 — dilewati." : "Perubahan kurang dari Rp 1 — dilewati.",
        });
        continue;
      }
      // Geser sale mengikuti regular agar tetap valid (≤ regular − 1).
      let saleBaru = sale;
      if (sale > 0) {
        const jarak = regular - sale;
        saleBaru = jarak > 0 ? Math.max(1, baru - jarak) : Math.max(1, baru - 1);
      }
      await insertHargaSnapshot({
        marketplace: "blibli",
        sku_key: v.variant.blibliSku,
        product_id: sku,
        sku_id: v.variant.blibliSku,
        product_name: map.product_name || sku,
        sku_label: v.variant.name || v.variant.sellerSku || v.variant.blibliSku,
        harga_regular: regular,
        harga_sale: sale,
        pickup_point_code: v.pickupPoint.code,
      });
      requests.push({
        gdnSku: v.variant.blibliSku,
        pickupPointCode: v.pickupPoint.code,
        price: baru,
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
    catatan.push(`Antrean Blibli diterima (${chunk.length} varian) — hasil final cek beberapa menit lagi di daftar produk.`);
  }

  return {
    ok: diubah > 0 || gagal.length === 0,
    diubah,
    gagal,
    detail: "",
    catatan: [...new Set(catatan)],
  };
}

/** Terapkan aturan ke SellerSku Lazada terpilih. Harga segar dibaca lewat
 *  sku_seller_list (maks 100 per panggilan) supaya tidak menyapu seluruh
 *  katalog; stok saat ini ikut dikirim karena UpdatePriceQuantity wajib
 *  memuat Price + Quantity. Penulisan sinkron seperti TikTok. */
export async function terapkanLazada(
  pilihan: string[],
): Promise<HasilTerapkan> {
  const gagal: HasilTerapkan["gagal"] = [];
  if (!Array.isArray(pilihan) || pilihan.length === 0) {
    return { ok: false, diubah: 0, gagal, detail: "Tidak ada SKU yang dipilih.", catatan: [] };
  }
  if (pilihan.length > MAKS_PRODUK_TERAPKAN) {
    return {
      ok: false,
      diubah: 0,
      gagal,
      detail: `Maksimal ${MAKS_PRODUK_TERAPKAN} produk per sekali terapkan (dipilih ${pilihan.length}) — terapkan bertahap.`,
      catatan: [],
    };
  }
  const [aturan, maps] = await Promise.all([
    listAturanHarga("lazada"),
    listLazadaProductMaps(),
  ]);
  const byMap = new Map(
    maps.filter((m) => m.enabled === 1).map((m) => [m.lazada_sku, m]),
  );

  // Harga + stok segar lewat sku_seller_list (kelompok maks 50 SKU —
  // /products/get membatasi hasil 50 baris, jadi kelompok lebih besar bisa
  // kehilangan SKU dan dianggap "tidak ditemukan").
  const segar = new Map<
    string,
    { harga: number; stok: number; nama: string; skuId: string; itemId: string }
  >();
  for (let i = 0; i < pilihan.length; i += 50) {
    const chunk = pilihan.slice(i, i + 50);
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
  for (const sku of pilihan) {
    const f = segar.get(sku);
    if (!f) {
      gagal.push({
        skuKey: sku,
        label: sku,
        detail: "Tidak ditemukan di katalog Lazada (periksa SellerSku).",
      });
      continue;
    }
    const map = byMap.get(sku);
    if (!map) {
      gagal.push({ skuKey: sku, label: sku, detail: "Tanpa pemetaan Aneka — petakan dulu di halaman Pemetaan." });
      continue;
    }
    const info = infoModalAneka(map.aneka_product_id);
    if (!info) {
      gagal.push({ skuKey: sku, label: sku, detail: "Harga modal Aneka tidak ditemukan di katalog — refresh snapshot katalog." });
      continue;
    }
    const profit = f.harga - info.modal;
    const a = cocokAturan(profit, aturan);
    if (!a) continue; // tidak kena aturan — biarkan (bukan gagal)
    const baru = hitungHargaBaru(
      f.harga,
      a.aksi as "potong" | "naik",
      a.jenis as "rp" | "persen",
      a.nilai,
    );
    if (baru < 1 || baru === f.harga) {
      gagal.push({
        skuKey: sku,
        label: sku,
        detail: baru < 1 ? "Harga baru di bawah Rp 1 — dilewati." : "Perubahan kurang dari Rp 1 — dilewati.",
      });
      continue;
    }
    await insertHargaSnapshot({
      marketplace: "lazada",
      sku_key: sku,
      product_id: sku,
      sku_id: "",
      product_name: f.nama,
      sku_label: sku,
      harga_regular: f.harga,
      harga_sale: 0,
      pickup_point_code: "",
    });
    requests.push({
      sellerSku: sku,
      price: baru,
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

  return {
    ok: diubah > 0 || gagal.length === 0,
    diubah,
    gagal,
    detail: "",
    catatan: [],
  };
}

/** Terapkan aturan ke produk KTD Store terpilih (kunci = id Aneka). Harga
 *  patokan = override tersimpan bila ada, selain itu rekomendasi jual Aneka;
 *  hasil disimpan ke tabel ktd_store_harga yang dibaca situs toko. Murni
 *  basis data — tanpa API eksternal, jadi cepat dan aman. */
export async function terapkanKtdStore(
  pilihan: string[],
): Promise<HasilTerapkan> {
  const gagal: HasilTerapkan["gagal"] = [];
  if (!Array.isArray(pilihan) || pilihan.length === 0) {
    return { ok: false, diubah: 0, gagal, detail: "Tidak ada produk yang dipilih.", catatan: [] };
  }
  if (pilihan.length > MAKS_PRODUK_TERAPKAN) {
    return {
      ok: false,
      diubah: 0,
      gagal,
      detail: `Maksimal ${MAKS_PRODUK_TERAPKAN} produk per sekali terapkan (dipilih ${pilihan.length}) — terapkan bertahap.`,
      catatan: [],
    };
  }
  const [aturan, overrideRows] = await Promise.all([
    listAturanHarga("ktd-store"),
    listKtdStoreHarga(),
  ]);
  const override = new Map(overrideRows.map((r) => [r.aneka_id, r.harga]));
  const akanSimpan: { aneka_id: string; harga: number }[] = [];
  for (const id of pilihan) {
    const info = infoModalAneka(id);
    if (!info) {
      gagal.push({ skuKey: id, label: id, detail: "Harga modal Aneka tidak ditemukan di katalog — refresh snapshot katalog." });
      continue;
    }
    const sekarang = override.get(id) ?? info.rekomendasiJual;
    const profit = sekarang - info.modal;
    const a = cocokAturan(profit, aturan);
    if (!a) continue; // tidak kena aturan — biarkan (bukan gagal)
    const baru = hitungHargaBaru(
      sekarang,
      a.aksi as "potong" | "naik",
      a.jenis as "rp" | "persen",
      a.nilai,
    );
    if (baru < 1 || baru === sekarang) {
      gagal.push({
        skuKey: id,
        label: id,
        detail: baru < 1 ? "Harga baru di bawah Rp 1 — dilewati." : "Perubahan kurang dari Rp 1 — dilewati.",
      });
      continue;
    }
    const cat = findAnekaCatalogById(id);
    await insertHargaSnapshot({
      marketplace: "ktd-store",
      sku_key: id,
      product_id: id,
      sku_id: "",
      product_name: cat?.name ?? id,
      sku_label: `Aneka #${id}`,
      harga_regular: sekarang,
      harga_sale: 0,
      pickup_point_code: "",
    });
    akanSimpan.push({ aneka_id: id, harga: baru });
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

// ---------- Reset ke harga awal ----------

/** Pulihkan semua snapshot harga TikTok (satu panggilan per produk) lalu
 *  hapus snapshot yang berhasil — yang gagal tetap tersimpan untuk coba
 *  ulang. */
export async function resetTiktok(): Promise<HasilReset> {
  const gagal: HasilReset["gagal"] = [];
  const snap = await listHargaSnapshot("tiktok");
  if (snap.length === 0) {
    return { ok: false, dipulihkan: 0, gagal, detail: "Tidak ada snapshot harga untuk di-reset.", catatan: [] };
  }
  const tokens = await listTiktokShopTokens();
  if (tokens.length === 0) {
    return { ok: false, dipulihkan: 0, gagal, detail: "Belum ada toko TikTok Shop yang terhubung.", catatan: [] };
  }
  const prep = await prepareShop(tokens[0]);
  if (!prep.ok) return { ok: false, dipulihkan: 0, gagal, detail: prep.detail, catatan: [] };
  const ctx: TiktokShopCtx = { cipher: prep.cipher, access_token: prep.access_token };

  const perProduk = new Map<string, HargaSnapshotRow[]>();
  for (const s of snap) {
    const arr = perProduk.get(s.product_id) ?? [];
    arr.push(s);
    perProduk.set(s.product_id, arr);
  }

  let dipulihkan = 0;
  for (const [productId, rows] of perProduk) {
    const r = await updateTiktokProductPrices(
      ctx,
      productId,
      rows.map((s) => ({ skuId: s.sku_id, amount: s.harga_regular })),
    );
    if (r.ok && r.errors.length === 0) {
      dipulihkan += rows.length;
      for (const s of rows) await deleteHargaSnapshot("tiktok", s.sku_key);
    } else {
      gagal.push({
        skuKey: rows.map((s) => s.sku_key).join(", "),
        label: rows[0].product_name,
        detail: r.detail || r.errors.join("; "),
      });
    }
  }
  return { ok: true, dipulihkan, gagal, detail: "", catatan: [] };
}

/** Pulihkan semua snapshot harga Blibli (batch ≤ 100 gdnSku lewat antrean
 *  update massal) lalu hapus snapshot yang berhasil dikirim. */
export async function resetBlibli(): Promise<HasilReset> {
  const gagal: HasilReset["gagal"] = [];
  const snap = await listHargaSnapshot("blibli");
  if (snap.length === 0) {
    return { ok: false, dipulihkan: 0, gagal, detail: "Tidak ada snapshot harga untuk di-reset.", catatan: [] };
  }
  const requests: BlibliBulkItemUpdate[] = snap.map((s) => ({
    gdnSku: s.sku_id,
    pickupPointCode: s.pickup_point_code,
    price: s.harga_regular,
    salePrice: s.harga_sale,
  }));

  let dipulihkan = 0;
  const catatan: string[] = [];
  for (let i = 0; i < requests.length; i += 100) {
    const chunk = requests.slice(i, i + 100);
    const r = await updateBlibliProductsBulk(chunk);
    if (!r.ok) {
      for (const c of chunk) {
        const s = snap.find((x) => x.sku_id === c.gdnSku);
        gagal.push({ skuKey: c.gdnSku, label: s?.sku_label ?? c.gdnSku, detail: r.detail });
      }
      continue;
    }
    for (const c of chunk) {
      await deleteHargaSnapshot("blibli", c.gdnSku);
    }
    dipulihkan += chunk.length;
    catatan.push(`Antrean Blibli diterima (${chunk.length} varian) — harga kembali ke awal beberapa menit lagi.`);
  }
  return { ok: true, dipulihkan, gagal, detail: "", catatan: [...new Set(catatan)] };
}

/** Pulihkan semua snapshot harga Lazada (kelompok ≤ 50 SellerSku per update
 *  massal, stok saat ini dikirim ulang apa adanya) lalu hapus snapshot yang
 *  berhasil — yang gagal tetap tersimpan untuk coba ulang. */
export async function resetLazada(): Promise<HasilReset> {
  const gagal: HasilReset["gagal"] = [];
  const snap = await listHargaSnapshot("lazada");
  if (snap.length === 0) {
    return { ok: false, dipulihkan: 0, gagal, detail: "Tidak ada snapshot harga untuk di-reset.", catatan: [] };
  }

  // Stok saat ini wajib dikirim bersama harga (UpdatePriceQuantity).
  // /products/get hanya mengembalikan maks 50 baris per panggilan —
  // sku_seller_list lebih dari 50 membuat SKU sisanya hilang dari hasil
  // (kejadian nyata saat massal: KTDCGK-2145 dkk "Tidak ditemukan").
  const kunci = snap.map((s) => s.sku_key);
  const stok = new Map<string, number>();
  for (let i = 0; i < kunci.length; i += 50) {
    const chunk = kunci.slice(i, i + 50);
    let r = await listLazadaProducts({
      filter: "all",
      skuSellerList: chunk,
      limit: 50,
    });
    // ApiCallLimit/E901 = batas frekuensi Lazada yang sementara — coba lagi.
    for (
      let ulang = 0;
      !r.ok && /ApiCallLimit|E901/.test(r.detail) && ulang < 3;
      ulang++
    ) {
      await new Promise((res) => setTimeout(res, 1500 * (ulang + 1)));
      r = await listLazadaProducts({
        filter: "all",
        skuSellerList: chunk,
        limit: 50,
      });
    }
    if (!r.ok) {
      for (const sku of chunk) stok.set(sku, -1);
      continue;
    }
    for (const p of r.data.items) {
      for (const sku of p.skus ?? []) {
        const key = String(sku.SellerSku ?? "");
        if (!key || stok.has(key)) continue;
        stok.set(key, Number(sku.quantity ?? 0) || 0);
      }
    }
    await new Promise((res) => setTimeout(res, 600)); // jeda antarpanggilan
  }

  let dipulihkan = 0;
  for (let i = 0; i < snap.length; i += 50) {
    const chunk = snap.slice(i, i + 50);
    const reqs: LazadaBulkItemUpdate[] = [];
    for (const s of chunk) {
      const q = stok.get(s.sku_key);
      if (q === undefined || q < 0) {
        gagal.push({
          skuKey: s.sku_key,
          label: s.sku_label || s.sku_key,
          detail: "Stok saat ini tidak bisa dibaca dari Lazada.",
        });
        continue;
      }
      reqs.push({ sellerSku: s.sku_key, price: s.harga_regular, quantity: q });
    }
    if (reqs.length === 0) continue;
    const r = await updateLazadaProductsBulk(reqs);
    if (!r.ok) {
      for (const c of reqs) {
        const s = chunk.find((x) => x.sku_key === c.sellerSku);
        gagal.push({
          skuKey: c.sellerSku,
          label: s?.sku_label ?? c.sellerSku,
          detail: r.detail,
        });
      }
      continue;
    }
    for (const c of reqs) await deleteHargaSnapshot("lazada", c.sellerSku);
    dipulihkan += reqs.length;
  }
  return { ok: true, dipulihkan, gagal, detail: "", catatan: [] };
}

/** Pulihkan semua harga KTD Store: hapus override tersimpan (harga kembali
 *  ke rekomendasi jual Aneka) lalu hapus snapshot yang berhasil. */
export async function resetKtdStore(): Promise<HasilReset> {
  const gagal: HasilReset["gagal"] = [];
  const snap = await listHargaSnapshot("ktd-store");
  if (snap.length === 0) {
    return { ok: false, dipulihkan: 0, gagal, detail: "Tidak ada snapshot harga untuk di-reset.", catatan: [] };
  }
  await deleteKtdStoreHarga(snap.map((s) => s.sku_key));
  // Hapus snapshot massal (satu query per potongan) — penghapusan per baris
  // memakan ratusan kueri berurutan dan pernah membuat reset terpotong
  // batas 60 detik serverless di tengah jalan.
  await deleteHargaSnapshotBanyak("ktd-store", snap.map((s) => s.sku_key));
  return {
    ok: true,
    dipulihkan: snap.length,
    gagal,
    detail: "",
    catatan: ["Situs toko kembali memakai rekomendasi jual Aneka dalam beberapa menit."],
  };
}
