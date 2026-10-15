// Perbarui produk Blibli (harga & stok) — satu produk, semua variannya,
// lewat update massal antrian Blibli (asinkron). Perlu sesi admin.
// Aksi:
//  - price      : harga regular+sale PERSIS untuk semua varian
//  - priceDelta : naik/turun harga semua varian relatif harga saat ini
//  - stockDelta : tambah/kurang stok semua varian (nilai delta)
//  - stockExact : stok PERSIS untuk semua varian
import { isAuthed } from "@/lib/auth";
import {
  getBlibliProductVariants,
  updateBlibliProductsBulk,
  type BlibliBulkItemUpdate,
} from "@/lib/blibli-products";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ActionBody = {
  action?: string;
  productSku?: string;
  regular?: number;
  sale?: number;
  deltaRegular?: number;
  deltaSale?: number;
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
  const productSku = String(body.productSku ?? "").trim();
  if (productSku === "") return bad("productSku wajib diisi.");

  // Ambil varian dulu supaya nilai baru bisa dihitung per gdnSku dan
  // pickupPointCode-nya ikut terisi (wajib di request update).
  const variants = await getBlibliProductVariants(productSku);
  if (!variants.ok) return Response.json({ ok: false, detail: variants.detail });
  if (variants.data.length === 0) return bad("Produk ini tidak punya varian.");

  const requests: BlibliBulkItemUpdate[] = [];

  switch (body.action) {
    case "price": {
      const regular = Number(body.regular);
      const sale = Number(body.sale);
      if (!Number.isFinite(regular) || !Number.isFinite(sale) || regular < 1 || sale < 1) {
        return bad("Harga regular dan sale harus angka ≥ 1.");
      }
      if (sale > regular) return bad("Harga sale tidak boleh melebihi harga regular.");
      for (const v of variants.data) {
        requests.push({
          gdnSku: v.variant.blibliSku,
          pickupPointCode: v.pickupPoint.code,
          price: regular,
          salePrice: sale,
        });
      }
      break;
    }
    case "priceDelta": {
      const deltaRegular = Number(body.deltaRegular ?? 0);
      const deltaSale = Number(body.deltaSale ?? 0);
      if (!Number.isFinite(deltaRegular) || !Number.isFinite(deltaSale)) {
        return bad("Delta harga tidak valid.");
      }
      if (deltaRegular === 0 && deltaSale === 0) return bad("Delta harga tidak boleh 0.");
      for (const v of variants.data) {
        const regular = v.price.regular + deltaRegular;
        const sale = v.price.sale + deltaSale;
        if (regular < 1 || sale < 1) {
          return bad(`Harga baru varian "${v.variant.name}" di bawah Rp 1 — dibatalkan.`);
        }
        if (sale > regular) {
          return bad(`Harga sale baru varian "${v.variant.name}" melebihi regular — dibatalkan.`);
        }
        requests.push({
          gdnSku: v.variant.blibliSku,
          pickupPointCode: v.pickupPoint.code,
          price: regular,
          salePrice: sale,
        });
      }
      break;
    }
    case "stockDelta": {
      const delta = Number(body.delta);
      if (!Number.isInteger(delta) || delta === 0) {
        return bad("Delta stok harus bilangan bulat selain 0.");
      }
      for (const v of variants.data) {
        const current = v.stock.seller.available;
        if (current + delta < 0) {
          return bad(
            `Stok varian "${v.variant.name}" hanya ${current} — tidak bisa dikurangi ${Math.abs(delta)}.`,
          );
        }
        requests.push({
          gdnSku: v.variant.blibliSku,
          pickupPointCode: v.pickupPoint.code,
          stock: delta,
        });
      }
      break;
    }
    case "stockExact": {
      const stock = Number(body.stock);
      if (!Number.isInteger(stock) || stock < 0) {
        return bad("Stok persis harus bilangan bulat ≥ 0.");
      }
      for (const v of variants.data) {
        requests.push({
          gdnSku: v.variant.blibliSku,
          pickupPointCode: v.pickupPoint.code,
          exactStock: stock,
        });
      }
      break;
    }
    default:
      return bad("Aksi tidak dikenal (price/priceDelta/stockDelta/stockExact).");
  }

  try {
    const result = await updateBlibliProductsBulk(requests);
    // Di production, body 5xx bisa diganti Cloudflare dengan halaman 502
    // generik — balas 200 + pesan supaya alasan aslinya sampai ke browser.
    const status = result.ok ? 200 : process.env.NODE_ENV === "production" ? 200 : 502;
    return Response.json(
      result.ok
        ? { ok: true, ...result.data, variantCount: requests.length }
        : { ok: false, detail: result.detail },
      { status },
    );
  } catch (e) {
    const detail = `Kesalahan server: ${
      e instanceof Error ? e.message : "tidak dikenal"
    }`;
    const status = process.env.NODE_ENV === "production" ? 200 : 502;
    return Response.json({ ok: false, detail }, { status });
  }
}
