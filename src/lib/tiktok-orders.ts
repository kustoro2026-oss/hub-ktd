// Orkestrasi pesanan TikTok Shop: refresh token kedaluwarsa, isi ulang
// shop_cipher yang kosong, lalu tarik 20 pesanan terbaru per toko.
// Dipakai route API dan halaman Pesanan di dashboard.
import {
  listTiktokShopTokens,
  saveTiktokShopToken,
  type TiktokShopToken,
} from "@/lib/db";
import {
  getAuthorizedTiktokShops,
  getTiktokOrders,
  refreshTiktokToken,
  type TiktokOrderSummary,
} from "@/lib/tiktok";

export type TiktokShopOrders = {
  shop_id: string;
  shop_name: string;
  ok: boolean;
  detail?: string;
  count?: number;
  orders?: TiktokOrderSummary[];
};

/** Siapkan toko untuk panggilan business API: refresh token kedaluwarsa dan
 *  isi ulang shop_cipher yang kosong (perlu setelah otorisasi ulang aplikasi).
 *  Dipakai halaman Pesanan dan alur resi otomatis — kembalikan kredensial
 *  siap pakai atau pesan kesalahan. */
export async function prepareShop(
  shop: TiktokShopToken,
): Promise<
  | { ok: true; cipher: string; access_token: string }
  | { ok: false; detail: string }
> {
  let token = shop.access_token;
  let expiresAt = shop.expires_at;
  let refreshToken = shop.refresh_token;

  // Perbarui token bila sudah kedaluwarsa.
  if (isExpired(shop)) {
    const r = await refreshTiktokToken(refreshToken);
    if (!r.ok) {
      return {
        ok: false,
        detail: `Token kedaluwarsa dan gagal diperbarui: ${r.detail}`,
      };
    }
    token = r.access_token;
    refreshToken = r.refresh_token;
    expiresAt = r.expires_at;
  }

  // shop_cipher wajib untuk API pesanan; isi ulang bila belum tersimpan.
  let cipher = shop.cipher;
  if (cipher === "") {
    const sh = await getAuthorizedTiktokShops(token);
    if (sh.ok && sh.shops.length > 0) {
      cipher = sh.shops[0].cipher;
    }
  }

  // Simpan hanya bila ada yang berubah.
  if (
    token !== shop.access_token ||
    cipher !== shop.cipher ||
    refreshToken !== shop.refresh_token
  ) {
    await saveTiktokShopToken({
      shop_id: shop.shop_id,
      shop_name: shop.shop_name,
      cipher,
      access_token: token,
      refresh_token: refreshToken,
      expires_at: expiresAt,
    });
  }

  if (cipher === "") {
    return {
      ok: false,
      detail: "shop_cipher belum tersimpan — coba otorisasi ulang aplikasi.",
    };
  }
  return { ok: true, cipher, access_token: token };
}

export async function pullTiktokShopOrders(): Promise<TiktokShopOrders[]> {
  const shops = await listTiktokShopTokens();
  const results: TiktokShopOrders[] = [];

  for (const shop of shops) {
    const prep = await prepareShop(shop);
    if (!prep.ok) {
      results.push({
        shop_id: shop.shop_id,
        shop_name: shop.shop_name,
        ok: false,
        detail: prep.detail,
      });
      continue;
    }

    const ord = await getTiktokOrders({
      cipher: prep.cipher,
      access_token: prep.access_token,
    });
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

  return results;
}

function isExpired(shop: TiktokShopToken): boolean {
  if (!shop.expires_at) return false;
  const t = new Date(shop.expires_at.replace(" ", "T") + "Z");
  return !Number.isNaN(t.getTime()) && t.getTime() < Date.now();
}
