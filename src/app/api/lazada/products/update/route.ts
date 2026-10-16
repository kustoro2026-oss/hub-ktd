// Perbarui produk Lazada (harga & stok) — SATU SellerSku, langsung lewat
// UpdatePriceQuantity (sinkron, hasil cek lewat daftar produk beberapa
// menit kemudian). Perlu sesi admin.
// Aksi:
//  - price      : harga PERSIS (stok dipertahankan)
//  - priceDelta : naik/turun harga relatif harga saat ini
//  - stockDelta : tambah/kurang stok (nilai delta)
//  - stockExact : stok PERSIS
import { isAuthed } from "@/lib/auth";
import {
  listLazadaProducts,
  updateLazadaProductsBulk,
  type LazadaBulkItemUpdate,
} from "@/lib/lazada-products";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ActionBody = {
  action?: string;
  sellerSku?: string;
  price?: number;
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
  const sellerSku = String(body.sellerSku ?? "").trim();
  if (sellerSku === "") return bad("sellerSku wajib diisi.");

  // Nilai SKU saat ini (harga + stok) — dasar hitung delta dan nilai stok
  // yang dipertahankan pada aksi harga.
  const list = await listLazadaProducts({
    filter: "all",
    skuSellerList: [sellerSku],
    limit: 50,
  });
  if (!list.ok) return Response.json({ ok: false, detail: list.detail });
  let current: { price: number; quantity: number } | null = null;
  for (const p of list.data.items) {
    for (const s of p.skus ?? []) {
      if ((s.SellerSku ?? "") === sellerSku) {
        current = {
          price: Number(s.price ?? s.special_price ?? 0) || 0,
          quantity: Number(s.quantity) || 0,
        };
      }
    }
  }
  if (!current) return bad("SellerSku tidak ditemukan di daftar produk.");

  let update: LazadaBulkItemUpdate;
  switch (body.action) {
    case "price": {
      const price = Number(body.price);
      if (!Number.isFinite(price) || price < 1) {
        return bad("Harga harus angka ≥ 1.");
      }
      update = { sellerSku, price, quantity: current.quantity };
      break;
    }
    case "priceDelta": {
      const delta = Number(body.delta);
      if (!Number.isFinite(delta) || delta === 0) {
        return bad("Delta harga tidak valid.");
      }
      const price = current.price + delta;
      if (price < 1) return bad("Harga baru di bawah Rp 1 — dibatalkan.");
      update = { sellerSku, price, quantity: current.quantity };
      break;
    }
    case "stockDelta": {
      const delta = Number(body.delta);
      if (!Number.isInteger(delta) || delta === 0) {
        return bad("Delta stok harus bilangan bulat selain 0.");
      }
      if (current.quantity + delta < 0) {
        return bad(
          `Stok saat ini hanya ${current.quantity} — tidak bisa dikurangi ${Math.abs(delta)}.`,
        );
      }
      update = {
        sellerSku,
        price: current.price,
        quantity: current.quantity + delta,
      };
      break;
    }
    case "stockExact": {
      const stock = Number(body.stock);
      if (!Number.isInteger(stock) || stock < 0) {
        return bad("Stok persis harus bilangan bulat ≥ 0.");
      }
      update = { sellerSku, price: current.price, quantity: stock };
      break;
    }
    default:
      return bad("Aksi tidak dikenal (price/priceDelta/stockDelta/stockExact).");
  }

  try {
    const result = await updateLazadaProductsBulk([update]);
    // Di production, body 5xx bisa diganti Cloudflare dengan halaman 502
    // generik — balas 200 + pesan supaya alasan aslinya sampai ke browser.
    const status = result.ok ? 200 : process.env.NODE_ENV === "production" ? 200 : 502;
    return Response.json(
      result.ok
        ? {
            ok: true,
            ...result.data,
            sellerSku,
            hargaBaru: update.price,
            stokBaru: update.quantity,
          }
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
