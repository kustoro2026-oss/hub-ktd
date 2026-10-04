import { NextRequest } from "next/server";
import { exchangeTiktokAuthCode, getAuthorizedTiktokShops } from "@/lib/tiktok";
import { saveTiktokShopToken } from "@/lib/db";

// Endpoint redirect OAuth aplikasi "KTD Hub Pesanan" (TikTok Shop Partner
// Center). Dibuka oleh TikTok setelah penjual menyetujui akses:
// ?code=<auth_code>&shop_id=<id> — token ditukar lalu disimpan untuk Hub.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const code = sp.get("code") ?? "";

  if (code === "") {
    const err = sp.get("error") ?? "";
    return page(
      false,
      err !== ""
        ? `Otorisasi ditolak atau dibatalkan (${err}).`
        : "URL tidak memuat kode otorisasi (code).",
    );
  }

  const res = await exchangeTiktokAuthCode(code);
  if (!res.ok) return page(false, res.detail);

  // token/get tidak memuat shop_id — ambil lewat Get Authorized Shops.
  let shopId = `open-${res.open_id || "tokopedia"}`;
  let shopName = res.shop_name;
  let cipher = "";
  let catatan = "";
  const shopsRes = await getAuthorizedTiktokShops(res.access_token);
  if (!shopsRes.ok) {
    catatan = ` (daftar toko belum terbaca: ${shopsRes.detail})`;
  } else if (shopsRes.shops.length > 0) {
    const shop = shopsRes.shops[0];
    shopId = shop.id;
    shopName = shop.name || shopName;
    cipher = shop.cipher;
  }
  await saveTiktokShopToken({
    shop_id: shopId,
    shop_name: shopName,
    cipher,
    access_token: res.access_token,
    refresh_token: res.refresh_token,
    expires_at: res.expires_at,
  });

  return page(
    true,
    `Token tersimpan untuk toko "${shopName || shopId}" (${shopId}). KTD Hub kini dapat membaca pesanan TikTok Shop.${catatan}`,
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function page(ok: boolean, msg: string): Response {
  return new Response(
    `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KTD Hub — Otorisasi TikTok Shop</title></head><body style="font-family:system-ui,sans-serif;padding:24px;max-width:640px;margin:0 auto"><h2>${ok ? "Otorisasi berhasil" : "Otorisasi gagal"}</h2><p>${escapeHtml(msg)}</p><p><a href="/">Kembali ke KTD Hub</a></p></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
