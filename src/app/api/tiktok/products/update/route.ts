// Perbarui produk TikTok Shop (harga & stok) — satu produk, semua SKU-nya,
// lewat panggilan sinkron ke API produk TikTok. Perlu sesi admin.
// Aksi:
//  - price      : harga PERSIS untuk semua SKU
//  - priceDelta : naik/turun harga semua SKU relatif harga saat ini
//  - stockDelta : tambah/kurang stok semua SKU (nilai delta)
//  - stockExact : stok PERSIS untuk semua SKU
// Catatan TikTok: ubah harga hanya untuk produk berstatus ACTIVATE; stok
// per gudang minimal 1 dan maksimal 99.999.
import { isAuthed } from "@/lib/auth";
import { listTiktokShopTokens } from "@/lib/db";
import {
  getTiktokProduct,
  updateTiktokProductPrices,
  updateTiktokProductStocks,
} from "@/lib/tiktok-products";
import { prepareShop } from "@/lib/tiktok-orders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ActionBody = {
  action?: string;
  productId?: string;
  regular?: number;
  deltaRegular?: number;
  delta?: number;
  stock?: number;
};

function bad(detail: string) {
  return Response.json({ ok: false, detail }, { status: 400 });
}

export async function POST(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as ActionBody;
  const productId = String(body.productId ?? "").trim();
  if (productId === "") return bad("productId wajib diisi.");

  const shops = await listTiktokShopTokens();
  if (shops.length === 0) {
    return Response.json({
      ok: false,
      detail: "Belum ada toko TikTok Shop yang terotorisasi.",
    });
  }
  const prep = await prepareShop(shops[0]);
  if (!prep.ok) return Response.json({ ok: false, detail: prep.detail });

  // Ambil detail produk dulu supaya nilai baru dihitung dari data terkini
  // per SKU (harga, stok, daftar gudang).
  const detail = await getTiktokProduct(prep, productId);
  if (!detail.ok) return Response.json({ ok: false, detail: detail.detail });
  const skus = detail.product.skus;
  if (skus.length === 0) return bad("Produk ini tidak punya SKU.");

  // Ubah harga hanya untuk produk Aktif (sinkron dengan aturan TikTok);
  // status bisa kosong untuk toko Indonesia — jangan diblokir saat kosong.
  const statusProduk =
    detail.product.productStatus || detail.product.status || "";
  const aksiHarga = body.action === "price" || body.action === "priceDelta";
  if (aksiHarga && statusProduk !== "" && statusProduk !== "ACTIVATE") {
    return bad(
      `Produk harus berstatus Aktif untuk ubah harga (status sekarang: ${statusProduk}) — dibatalkan.`,
    );
  }

  try {
    switch (body.action) {
      case "price": {
        const regular = Number(body.regular);
        if (!Number.isFinite(regular) || regular < 1) {
          return bad("Harga harus angka ≥ 1.");
        }
        const r = await updateTiktokProductPrices(
          prep,
          productId,
          skus.map((s) => ({ skuId: s.id, amount: Math.round(regular) })),
        );
        return hasilUpdate(r, skus.length);
      }
      case "priceDelta": {
        const deltaRegular = Number(body.deltaRegular ?? 0);
        if (!Number.isFinite(deltaRegular) || deltaRegular === 0) {
          return bad("Delta harga tidak valid.");
        }
        const updates: { skuId: string; amount: number }[] = [];
        for (const s of skus) {
          const baru = Math.round(s.price.display + deltaRegular);
          if (baru < 1) {
            return bad(
              `Harga baru varian "${s.name}" di bawah Rp 1 — dibatalkan.`,
            );
          }
          updates.push({ skuId: s.id, amount: baru });
        }
        const r = await updateTiktokProductPrices(prep, productId, updates);
        return hasilUpdate(r, skus.length);
      }
      case "stockDelta": {
        const delta = Number(body.delta);
        if (!Number.isInteger(delta) || delta === 0) {
          return bad("Delta stok harus bilangan bulat selain 0.");
        }
        const updates: {
          skuId: string;
          inventory: { warehouseId: string; quantity: number }[];
        }[] = [];
        for (const s of skus) {
          if (s.inventory.length === 0) {
            return bad(
              `Varian "${s.name}" tidak punya data gudang — dibatalkan.`,
            );
          }
          const inventory: { warehouseId: string; quantity: number }[] = [];
          for (const w of s.inventory) {
            const baru = w.quantity + delta;
            if (baru < 1) {
              return bad(
                `Stok varian "${s.name}" jadi ${baru} — batas minimum TikTok 1, dibatalkan.`,
              );
            }
            if (baru > 99999) {
              return bad(
                `Stok varian "${s.name}" jadi ${baru} — batas maksimum TikTok 99.999, dibatalkan.`,
              );
            }
            inventory.push({ warehouseId: w.warehouseId, quantity: baru });
          }
          updates.push({ skuId: s.id, inventory });
        }
        const r = await updateTiktokProductStocks(prep, productId, updates);
        return hasilUpdate(r, skus.length);
      }
      case "stockExact": {
        const stock = Number(body.stock);
        if (!Number.isInteger(stock) || stock < 1 || stock > 99999) {
          return bad("Stok persis harus bilangan bulat 1 – 99.999.");
        }
        const updates: {
          skuId: string;
          inventory: { warehouseId: string; quantity: number }[];
        }[] = [];
        for (const s of skus) {
          if (s.inventory.length === 0) {
            return bad(
              `Varian "${s.name}" tidak punya data gudang — dibatalkan.`,
            );
          }
          updates.push({
            skuId: s.id,
            inventory: s.inventory.map((w) => ({
              warehouseId: w.warehouseId,
              quantity: stock,
            })),
          });
        }
        const r = await updateTiktokProductStocks(prep, productId, updates);
        return hasilUpdate(r, skus.length);
      }
      default:
        return bad("Aksi tidak dikenal (price/priceDelta/stockDelta/stockExact).");
    }
  } catch (e) {
    const detail = `Kesalahan server: ${
      e instanceof Error ? e.message : "tidak dikenal"
    }`;
    const status = process.env.NODE_ENV === "production" ? 200 : 502;
    return Response.json({ ok: false, detail }, { status });
  }
}

/** Balas hasil mutasi: di production, body 5xx bisa diganti Cloudflare
 *  dengan halaman 502 generik — balas 200 + pesan supaya alasan aslinya
 *  sampai ke browser. */
function hasilUpdate(
  r: { ok: boolean; detail: string; errors: string[] },
  skuCount: number,
) {
  const status = r.ok ? 200 : process.env.NODE_ENV === "production" ? 200 : 502;
  return Response.json(
    r.ok
      ? { ok: true, skuCount, errors: r.errors }
      : { ok: false, detail: r.detail, errors: r.errors },
    { status },
  );
}
