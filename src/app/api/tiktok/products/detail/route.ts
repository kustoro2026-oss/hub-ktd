// Detail produk TikTok Shop (SKU + harga + stok per gudang) — dipakai panel
// "Atur" di halaman Produk. Perlu sesi admin.
import { isAuthed } from "@/lib/auth";
import { listTiktokShopTokens } from "@/lib/db";
import { getTiktokProduct } from "@/lib/tiktok-products";
import { prepareShop } from "@/lib/tiktok-orders";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }

  const url = new URL(request.url);
  const productId = (url.searchParams.get("productId") ?? "").trim();
  if (productId === "") {
    return Response.json(
      { ok: false, detail: "productId wajib diisi." },
      { status: 400 },
    );
  }

  const shops = await listTiktokShopTokens();
  if (shops.length === 0) {
    return Response.json({
      ok: false,
      detail: "Belum ada toko TikTok Shop yang terotorisasi.",
    });
  }
  const prep = await prepareShop(shops[0]);
  if (!prep.ok) return Response.json({ ok: false, detail: prep.detail });

  try {
    const result = await getTiktokProduct(prep, productId);
    if (!result.ok) return Response.json({ ok: false, detail: result.detail });
    return Response.json({ ok: true, product: result.product });
  } catch (e) {
    return Response.json({
      ok: false,
      detail: `Kesalahan server: ${
        e instanceof Error ? e.message : "tidak dikenal"
      }`,
    });
  }
}
