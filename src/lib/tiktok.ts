// Klien OAuth & API TikTok Shop (Open API, pasar Indonesia) untuk KTD Hub.
// Satu platform API mengelola TikTok Shop dan Tokopedia (pasca-merger);
// referensi: partner.tiktokshop.com/docv2 (ID market).

import { createHmac } from "crypto";

const AUTH_URL = "https://auth.tiktok-shops.com/api/v2/token/get";
const REFRESH_URL = "https://auth.tiktok-shops.com/api/v2/token/refresh";
const API_HOST = "https://open-api.tiktokglobalshop.com";

export type TiktokTokenResult =
  | {
      ok: true;
      access_token: string;
      refresh_token: string;
      expires_at: string;
      open_id: string;
      shop_id: string;
      shop_name: string;
    }
  | { ok: false; detail: string };

/** Kredensial aplikasi "KTD Hub Pesanan" dari env Vercel/.env.local. */
export function tiktokEnv(): {
  appKey: string;
  appSecret: string;
  ready: boolean;
} {
  const appKey = process.env.TIKTOK_APP_KEY ?? "";
  const appSecret = process.env.TIKTOK_APP_SECRET ?? "";
  return { appKey, appSecret, ready: appKey !== "" && appSecret !== "" };
}

/** Tukar auth_code hasil redirect OAuth menjadi access token.
 *  token/get adalah GET dengan query params (tanpa signature);
 *  grant_type harus persis "authorized_code" dan kode hanya sekali pakai. */
export async function exchangeTiktokAuthCode(
  code: string,
): Promise<TiktokTokenResult> {
  const { appKey, appSecret, ready } = tiktokEnv();
  if (!ready) {
    return {
      ok: false,
      detail:
        "Kredensial aplikasi belum diatur (env TIKTOK_APP_KEY dan TIKTOK_APP_SECRET).",
    };
  }

  const qs = new URLSearchParams({
    app_key: appKey,
    app_secret: appSecret,
    auth_code: code,
    grant_type: "authorized_code",
  });

  try {
    const res = await fetch(`${AUTH_URL}?${qs.toString()}`, {
      method: "GET",
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const d = (data.data ?? {}) as Record<string, unknown>;
    const accessToken = String(d.access_token ?? "");
    if (!res.ok || accessToken === "") {
      return {
        ok: false,
        detail: `Gagal menukar kode otorisasi: ${String(
          data.message ?? res.status,
        )}`,
      };
    }
    // access_token_expire_in = timestamp Unix (detik) kapan token habis;
    // bila nilainya kecil (durasi detik), hitung dari sekarang.
    const expireRaw = Number(d.access_token_expire_in ?? 0);
    const expiresMs =
      expireRaw >= 1e9 ? expireRaw * 1000 : Date.now() + expireRaw * 1000;
    return {
      ok: true,
      access_token: accessToken,
      refresh_token: String(d.refresh_token ?? ""),
      expires_at: new Date(expiresMs || Date.now() + 7 * 86400 * 1000)
        .toISOString()
        .slice(0, 19)
        .replace("T", " "),
      open_id: String(d.open_id ?? ""),
      // token/get tidak mengembalikan shop_id — diisi lewat Get Authorized Shops.
      shop_id: "",
      shop_name: String(d.seller_name ?? ""),
    };
  } catch (e) {
    return {
      ok: false,
      detail: `Gagal menghubungi server TikTok: ${
        e instanceof Error ? e.message : "kesalahan tidak dikenal"
      }`,
    };
  }
}

// ---------- Panggilan business API (butuh signature HMAC-SHA256) ----------

/** Hitung sign request per dokumen "Sign your API request":
 *  input = app_secret + path + (kunci tersortir {key}{value}, tanpa sign &
 *  access_token) + body mentah (bila bukan multipart) + app_secret,
 *  lalu HMAC-SHA256 key=app_secret, output hex huruf kecil. */
function signRequest(
  appSecret: string,
  path: string,
  params: Record<string, string>,
  body = "",
): string {
  const keys = Object.keys(params)
    .filter((k) => k !== "sign" && k !== "access_token")
    .sort();
  const concat = keys.map((k) => `${k}${params[k]}`).join("");
  const input = appSecret + path + concat + body + appSecret;
  return createHmac("sha256", appSecret).update(input).digest("hex");
}

export type TiktokShop = {
  id: string;
  name: string;
  region: string;
  cipher: string;
  code: string;
};

/** GET /authorization/202309/shops — daftar toko yang diotorisasi penjual
 *  untuk aplikasi ini. Butuh scope seller.authorization.info. */
export async function getAuthorizedTiktokShops(
  accessToken: string,
): Promise<{ ok: true; shops: TiktokShop[] } | { ok: false; detail: string }> {
  const { appKey, appSecret, ready } = tiktokEnv();
  if (!ready) {
    return {
      ok: false,
      detail:
        "Kredensial aplikasi belum diatur (env TIKTOK_APP_KEY dan TIKTOK_APP_SECRET).",
    };
  }
  const path = "/authorization/202309/shops";
  const params: Record<string, string> = {
    app_key: appKey,
    timestamp: Math.floor(Date.now() / 1000).toString(),
  };
  const sign = signRequest(appSecret, path, params);
  const qs = new URLSearchParams({ ...params, sign });
  try {
    const res = await fetch(`${API_HOST}${path}?${qs.toString()}`, {
      method: "GET",
      headers: {
        "content-type": "application/json",
        "x-tts-access-token": accessToken,
      },
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as {
      code?: number;
      message?: string;
      data?: { shops?: TiktokShop[] };
    };
    if (!res.ok || (data.code ?? 1) !== 0 || !Array.isArray(data.data?.shops)) {
      return {
        ok: false,
        detail: `Gagal mengambil daftar toko: ${String(
          data.message ?? res.status,
        )}`,
      };
    }
    return { ok: true, shops: data.data?.shops ?? [] };
  } catch (e) {
    return {
      ok: false,
      detail: `Gagal menghubungi server TikTok: ${
        e instanceof Error ? e.message : "kesalahan tidak dikenal"
      }`,
    };
  }
}

export type TiktokRefreshResult =
  | {
      ok: true;
      access_token: string;
      refresh_token: string;
      expires_at: string;
    }
  | { ok: false; detail: string };

/** Perbarui access token dengan refresh token (GET token/refresh). */
export async function refreshTiktokToken(
  refreshToken: string,
): Promise<TiktokRefreshResult> {
  const { appKey, appSecret, ready } = tiktokEnv();
  if (!ready) {
    return {
      ok: false,
      detail:
        "Kredensial aplikasi belum diatur (env TIKTOK_APP_KEY dan TIKTOK_APP_SECRET).",
    };
  }
  const qs = new URLSearchParams({
    app_key: appKey,
    app_secret: appSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  try {
    const res = await fetch(`${REFRESH_URL}?${qs.toString()}`, {
      method: "GET",
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const d = (data.data ?? {}) as Record<string, unknown>;
    const accessToken = String(d.access_token ?? "");
    if (!res.ok || accessToken === "") {
      return {
        ok: false,
        detail: `Gagal memperbarui token: ${String(
          data.message ?? res.status,
        )}`,
      };
    }
    const expireRaw = Number(d.access_token_expire_in ?? 0);
    const expiresMs =
      expireRaw >= 1e9 ? expireRaw * 1000 : Date.now() + expireRaw * 1000;
    return {
      ok: true,
      access_token: accessToken,
      refresh_token: String(d.refresh_token ?? refreshToken),
      expires_at: new Date(expiresMs || Date.now() + 7 * 86400 * 1000)
        .toISOString()
        .slice(0, 19)
        .replace("T", " "),
    };
  } catch (e) {
    return {
      ok: false,
      detail: `Gagal menghubungi server TikTok: ${
        e instanceof Error ? e.message : "kesalahan tidak dikenal"
      }`,
    };
  }
}

export type TiktokOrderSummary = {
  order_id: string;
  order_status: string;
  create_time: number;
  update_time: number;
  items: { product_name: string; sku_count: number }[];
};

/** POST /order/202309/orders/search — daftar pesanan terbaru toko. */
export async function getTiktokOrders(
  shop: { cipher: string; access_token: string },
  daysBack = 7,
): Promise<
  { ok: true; orders: TiktokOrderSummary[] } | { ok: false; detail: string }
> {
  const { appKey, appSecret, ready } = tiktokEnv();
  if (!ready) {
    return {
      ok: false,
      detail:
        "Kredensial aplikasi belum diatur (env TIKTOK_APP_KEY dan TIKTOK_APP_SECRET).",
    };
  }
  if (shop.cipher === "") {
    return {
      ok: false,
      detail: "shop_cipher belum tersimpan — coba otorisasi ulang aplikasi.",
    };
  }
  const path = "/order/202309/orders/search";
  const now = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({
    page_size: 20,
    update_time_from: now - daysBack * 86400,
    update_time_to: now,
    sort_by: "update_time",
    sort_order: "DESC",
  });
  const params: Record<string, string> = {
    app_key: appKey,
    shop_cipher: shop.cipher,
    timestamp: now.toString(),
  };
  const sign = signRequest(appSecret, path, params, body);
  const qs = new URLSearchParams({ ...params, sign });
  try {
    const res = await fetch(`${API_HOST}${path}?${qs.toString()}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tts-access-token": shop.access_token,
      },
      body,
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as {
      code?: number;
      message?: string;
      data?: { order_list?: unknown[] };
    };
    if (!res.ok || (data.code ?? 1) !== 0) {
      return {
        ok: false,
        detail: `Gagal mengambil pesanan: ${String(
          data.message ?? res.status,
        )}`,
      };
    }
    const orders: TiktokOrderSummary[] = (data.data?.order_list ?? []).map(
      (o) => {
        const r = o as Record<string, unknown>;
        const itemList = (r.item_list as unknown[] | undefined) ?? [];
        return {
          order_id: String(r.order_id ?? ""),
          order_status: String(r.order_status ?? ""),
          create_time: Number(r.create_time ?? 0),
          update_time: Number(r.update_time ?? 0),
          items: itemList.map((it) => {
            const i = it as Record<string, unknown>;
            return {
              product_name: String(i.product_name ?? ""),
              sku_count: Number(i.sku_count ?? 1),
            };
          }),
        };
      },
    );
    return { ok: true, orders };
  } catch (e) {
    return {
      ok: false,
      detail: `Gagal menghubungi server TikTok: ${
        e instanceof Error ? e.message : "kesalahan tidak dikenal"
      }`,
    };
  }
}
