import { isAuthed } from "@/lib/auth";
import {
  listTiktokShopTokens,
  saveTiktokShopToken,
  type TiktokShopToken,
} from "@/lib/db";
import {
  getAuthorizedTiktokShops,
  getTiktokOrders,
  refreshTiktokToken,
} from "@/lib/tiktok";

// Ambil pesanan terbaru semua toko TikTok Shop yang terotorisasi.
// Dipakai Modul Pesanan KTD Hub (sementara lewat URL, lalu halaman UI).
export async function GET() {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }

  const shops = await listTiktokShopTokens();
  if (shops.length === 0) {
    return Response.json({
      ok: false,
      detail: "Belum ada toko TikTok Shop yang terotorisasi.",
    });
  }

  const results = [];
  for (const shop of shops) {
    let token = shop.access_token;

    // Perbarui token bila sudah kedaluwarsa.
    if (isExpired(shop)) {
      const r = await refreshTiktokToken(shop.refresh_token);
      if (!r.ok) {
        results.push({
          shop_id: shop.shop_id,
          shop_name: shop.shop_name,
          ok: false,
          detail: `Token kedaluwarsa dan gagal diperbarui: ${r.detail}`,
        });
        continue;
      }
      token = r.access_token;
      await saveTiktokShopToken({
        shop_id: shop.shop_id,
        shop_name: shop.shop_name,
        cipher: shop.cipher,
        access_token: r.access_token,
        refresh_token: r.refresh_token,
        expires_at: r.expires_at,
      });
    }

    // shop_cipher wajib untuk API pesanan; isi ulang bila belum tersimpan
    // (otorisasi dilakukan sebelum kolom cipher ditambahkan).
    let cipher = shop.cipher;
    if (cipher === "") {
      const sh = await getAuthorizedTiktokShops(token);
      if (sh.ok && sh.shops.length > 0) {
        cipher = sh.shops[0].cipher;
        await saveTiktokShopToken({
          shop_id: shop.shop_id,
          shop_name: shop.shop_name,
          cipher,
          access_token: token,
          refresh_token: shop.refresh_token,
          expires_at: shop.expires_at,
        });
      }
    }

    const ord = await getTiktokOrders({ cipher, access_token: token });
    if (!ord.ok) {
      results.push({
        shop_id: shop.shop_id,
        shop_name: shop.shop_name,
        ok: false,
        detail: ord.detail,
      });
      continue;
    }
    results.push({
      shop_id: shop.shop_id,
      shop_name: shop.shop_name,
      ok: true,
      count: ord.orders.length,
      orders: ord.orders,
    });
  }

  return Response.json({ ok: true, results });
}

function isExpired(shop: TiktokShopToken): boolean {
  if (!shop.expires_at) return false;
  const t = new Date(shop.expires_at.replace(" ", "T") + "Z");
  return !Number.isNaN(t.getTime()) && t.getTime() < Date.now();
}
