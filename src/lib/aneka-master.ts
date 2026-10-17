// Katalog master Aneka (ktd-hub/src/lib/aneka-master.json) — snapshot
// seluruh produk anekadropship.id hasil sweep listing + detail (lihat
// scripts/sweep-aneka-master.cjs). Menjadi sumber data menu Aneka di
// KTD Hub dan (fase berikutnya) mesin sinkronisasi harga/stok ke semua
// marketplace. Nama produk sudah dibersihkan dari tag seller
// ([PG STORE], [HERBALUNA], dll) — nama mentah Aneka tetap di namaAneka.
import masterData from "@/lib/aneka-master.json";

export type AnekaVarian = {
  id: string;
  label: string;
  nama: string;
  warna: string | null;
  ukuran: string | null;
  harga: number;
  stok: number;
  aktif: boolean;
};

export type AnekaMasterProduct = {
  id: string;
  /** Nama bersih (tanpa tag seller). */
  name: string;
  /** Nama mentah di Aneka (dengan tag seller). */
  namaAneka: string;
  /** Harga beli (modal) dari kartu listing. */
  hargaModal: number;
  hargaModalCut: number;
  /** Rekomendasi harga jual (kartu listing; fallback harga jual detail). */
  rekomendasiJual: number;
  profitPct: string;
  terjual: string;
  /** Stok efektif: minimum stok varian aktif (tanpa varian = stok produk). */
  stok: number;
  /** Stok mentah dari kartu listing (bisa berbeda dengan stok efektif). */
  stokCard: string;
  lokasi: string;
  kategori: string;
  beratGram: number;
  volume: string;
  ekspedisi: string;
  sistem: string;
  alamatSeller: string;
  image: string;
  sku: string;
  hasVarian: boolean;
  varian: AnekaVarian[];
  /** "listing" | "manual" | "cache" | "tiktok-export". */
  sumber: string;
  /** "aktif" | "404" | "tanpa-detail". */
  status: string;
};

export type AnekaMasterMeta = {
  generatedAt: string;
  source: string;
  scanned: number;
  withVariants: number;
  totalVariants: number;
  status404: number;
  stokHabis: number;
  products: AnekaMasterProduct[];
};

const MASTER = masterData as unknown as AnekaMasterMeta;

/** Seluruh produk master Aneka (snapshot). */
export function listAnekaMaster(): AnekaMasterProduct[] {
  return Array.isArray(MASTER.products) ? MASTER.products : [];
}

/** Metadata snapshot (jumlah, tanggal, dll) untuk info UI. */
export function anekaMasterMeta(): Omit<AnekaMasterMeta, "products"> {
  return {
    generatedAt: MASTER.generatedAt ?? "",
    source: MASTER.source ?? "",
    scanned: MASTER.scanned ?? 0,
    withVariants: MASTER.withVariants ?? 0,
    totalVariants: MASTER.totalVariants ?? 0,
    status404: MASTER.status404 ?? 0,
    stokHabis: MASTER.stokHabis ?? 0,
  };
}

/** Cari satu produk master berdasarkan id Aneka. */
export function getAnekaMasterById(id: string): AnekaMasterProduct | null {
  return listAnekaMaster().find((p) => p.id === id) ?? null;
}
