// Klien OAuth & API TikTok Shop (Open API, pasar Indonesia) untuk KTD Hub.
// Satu platform API mengelola TikTok Shop dan Tokopedia (pasca-merger);
// referensi: partner.tiktokshop.com/docv2 (ID market).

import { createHmac } from "crypto";

const AUTH_URL = "https://auth.tiktok-shops.com/api/v2/token/get";
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
