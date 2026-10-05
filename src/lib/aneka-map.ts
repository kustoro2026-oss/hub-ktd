// Pemetaan produk TikTok Shop → Aneka (Fase 1): pencarian katalog Aneka
// dari snapshot statis (di-refresh lewat scripts/export-aneka-catalog.cjs)
// dan daftar produk TikTok yang pernah muncul di pesanan terbaru.
// Dipakai halaman Pemetaan Produk dan (Fase 2+) eksekusi checkout otomatis.
import catalogData from "@/lib/aneka-catalog.json";
import { listTiktokShopTokens } from "@/lib/db";
import { getTiktokOrders } from "@/lib/tiktok";
import { prepareShop } from "@/lib/tiktok-orders";

export type AnekaCatalogProduct = {
  id: string;
  name: string;
  hargaModal: string;
  rekomendasiJual: string;
  location: string;
};

/** Produk TikTok yang pernah tampil di pesanan (kunci pemetaan:
 *  product_id dari line_items). */
export type SeenTiktokProduct = {
  product_id: string;
  sku_id: string;
  product_name: string;
  order_count: number;
  total_qty: number;
  last_order_at: number;
};

const CATALOG = (catalogData as { products: AnekaCatalogProduct[] }).products;

/** Normalisasi nama produk untuk pencocokan (huruf kecil, tanpa tanda baca). */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

/** Cari produk Aneka dari snapshot katalog. Peringkat: nama diawali kata
 *  kunci > kata kunci ada di nama > nama mengandung kata kunci. */
export function searchAnekaCatalog(
  q: string,
  limit = 12,
): AnekaCatalogProduct[] {
  const query = norm(q);
  if (query.length < 2) return [];
  const starts: AnekaCatalogProduct[] = [];
  const contains: AnekaCatalogProduct[] = [];
  const fuzzy: AnekaCatalogProduct[] = [];
  for (const p of CATALOG) {
    const name = norm(p.name);
    if (name === query) {
      starts.unshift(p);
    } else if (name.startsWith(query)) {
      starts.push(p);
    } else if (name.includes(query)) {
      contains.push(p);
    } else if (
      query.length >= 4 &&
      query.split(" ").every((w) => name.includes(w))
    ) {
      fuzzy.push(p);
    }
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains, ...fuzzy].slice(0, limit);
}

/** Cari satu produk Aneka berdasarkan ID — untuk melengkapi nama saat
 *  pemetaan disimpan. */
export function findAnekaCatalogById(id: string): AnekaCatalogProduct | null {
  return CATALOG.find((p) => p.id === id) ?? null;
}

/** Tanggal pembuatan snapshot (teks info di UI). */
export function anekaCatalogGeneratedAt(): string {
  return String((catalogData as { generatedAt?: string }).generatedAt ?? "");
}

/** Tarik produk TikTok dari pesanan 30 hari terakhir (distinct per
 *  product_id) — sumber daftar produk yang perlu dipetakan. Tanpa toko
 *  terotorisasi kembalikan ok:false dengan keterangan. */
export async function getSeenTiktokProducts(): Promise<
  { ok: true; products: SeenTiktokProduct[] } | { ok: false; detail: string }
> {
  const tokens = await listTiktokShopTokens();
  if (tokens.length === 0) {
    return { ok: false, detail: "Belum ada toko TikTok Shop yang terhubung." };
  }
  const shop = tokens[0];
  const prep = await prepareShop(shop);
  if (!prep.ok) return { ok: false, detail: prep.detail };
  const r = await getTiktokOrders(
    { cipher: prep.cipher, access_token: prep.access_token },
    { daysBack: 30 },
  );
  if (!r.ok) return { ok: false, detail: r.detail };

  const byId = new Map<string, SeenTiktokProduct>();
  for (const o of r.orders) {
    for (const it of o.items) {
      if (!it.product_id) continue;
      const cur = byId.get(it.product_id);
      if (cur) {
        cur.order_count += 1;
        cur.total_qty += it.sku_count;
        if (o.create_time > cur.last_order_at) {
          cur.last_order_at = o.create_time;
        }
      } else {
        byId.set(it.product_id, {
          product_id: it.product_id,
          sku_id: it.sku_id,
          product_name: it.product_name,
          order_count: 1,
          total_qty: it.sku_count,
          last_order_at: o.create_time,
        });
      }
    }
  }
  const products = [...byId.values()].sort(
    (a, b) => b.last_order_at - a.last_order_at,
  );
  return { ok: true, products };
}
