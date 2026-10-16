// Klien OAuth & API Lazada Open Platform (pasar Indonesia) untuk KTD Hub.
// App "KTD Hub" (Seller In-house APP, App Key 143047): token diambil lewat
// alur OAuth2.0 Server-side — seller setujui akses di auth.lazada.com lalu
// ?code= dikirim ke callback dan ditukar di sini.
// Referensi: open.lazada.com/apps/doc (OAuth Server-side authorization) dan
// SDK resmi lazada-sdk (packages/sdk-ts): endpoint auth dipanggil GET dengan
// query param bertanda tangan, app_secret hanya menjadi kunci HMAC.

import { createHmac } from "crypto";

const AUTH_BASE = "https://auth.lazada.com/rest";
const TOKEN_PATH = "/auth/token/create";
const REFRESH_PATH = "/auth/token/refresh";
/** Host business API Lazada Indonesia. Diekspor untuk lib pesanan/produk. */
export const API_HOST = "https://api.lazada.co.id/rest";

export type LazadaTokenResult =
  | {
      ok: true;
      access_token: string;
      refresh_token: string;
      expires_at: string;
      refresh_expires_at: string;
      account: string;
      seller_id: string;
      short_code: string;
      country: string;
    }
  | { ok: false; detail: string };

/** Kredensial aplikasi "KTD Hub" dari env Vercel/.env.local. */
export function lazadaEnv(): {
  appKey: string;
  appSecret: string;
  ready: boolean;
} {
  const appKey = process.env.LAZADA_APP_KEY ?? "";
  const appSecret = process.env.LAZADA_APP_SECRET ?? "";
  return { appKey, appSecret, ready: appKey !== "" && appSecret !== "" };
}

/** Tanda tangan request per dokumen "signature algorithm" Lazada:
 *  urutkan semua param (kecuali sign, dan nilai kosong) naik, susun
 *  apiPath + k1v1 + k2v2 + ..., HMAC-SHA256 dengan kunci app_secret,
 *  output hex UPPERCASE. Diekspor untuk dipakai lib pesanan/produk. */
export function signLazada(
  appSecret: string,
  apiPath: string,
  params: Record<string, string>,
): string {
  const keys = Object.keys(params)
    .filter((k) => k !== "sign" && params[k] !== "")
    .sort();
  let payload = apiPath;
  for (const k of keys) payload += k + params[k];
  return createHmac("sha256", appSecret).update(payload).digest("hex").toUpperCase();
}

/** Tukar code hasil redirect OAuth menjadi access token.
 *  token/create adalah GET dengan query params code, app_key, timestamp,
 *  sign_method, sign (kode hanya sekali pakai dan redirect_uri harus persis
 *  sama dengan yang terdaftar di konsol ISV). */
export async function exchangeLazadaAuthCode(
  code: string,
): Promise<LazadaTokenResult> {
  const { appKey, appSecret, ready } = lazadaEnv();
  if (!ready) {
    return {
      ok: false,
      detail:
        "Kredensial aplikasi belum diatur (env LAZADA_APP_KEY dan LAZADA_APP_SECRET).",
    };
  }

  return callAuthToken(TOKEN_PATH, appKey, appSecret, { code });
}

/** Perpanjang access token dengan refresh token (masa pakai 180 hari).
 *  Dipakai penjadwal saat expires_at terlewati. */
export async function refreshLazadaToken(
  refreshToken: string,
): Promise<LazadaTokenResult> {
  const { appKey, appSecret, ready } = lazadaEnv();
  if (!ready) {
    return {
      ok: false,
      detail:
        "Kredensial aplikasi belum diatur (env LAZADA_APP_KEY dan LAZADA_APP_SECRET).",
    };
  }

  return callAuthToken(REFRESH_PATH, appKey, appSecret, { refresh_token: refreshToken });
}

/** Panggil endpoint /auth/token/* dengan param bertanda tangan (GET). */
async function callAuthToken(
  apiPath: string,
  appKey: string,
  appSecret: string,
  extra: Record<string, string>,
): Promise<LazadaTokenResult> {
  const params: Record<string, string> = {
    app_key: appKey,
    timestamp: Date.now().toString(),
    sign_method: "sha256",
    ...extra,
  };
  params.sign = signLazada(appSecret, apiPath, params);

  const url = new URL(AUTH_BASE + apiPath);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  try {
    const res = await fetch(url.toString(), { method: "GET", cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const accessToken = String(data.access_token ?? "");
    const code = String(data.code ?? "");
    if (!res.ok || accessToken === "" || (code !== "" && code !== "0")) {
      return {
        ok: false,
        detail: `Gagal menukar kode otorisasi: ${String(
          data.message ?? code ?? res.status,
        )}`,
      };
    }

    // expires_in / refresh_expires_in = durasi dalam detik.
    const expiresIn = Number(data.expires_in ?? 0);
    const refreshExpiresIn = Number(data.refresh_expires_in ?? 0);
    // country_user_info adalah array berisi satu entri untuk seller tunggal.
    const cui = (
      (Array.isArray(data.country_user_info) ? data.country_user_info[0] : {}) ??
      {}
    ) as Record<string, unknown>;

    return {
      ok: true,
      access_token: accessToken,
      refresh_token: String(data.refresh_token ?? ""),
      expires_at: formatExpiry(expiresIn || 30 * 86400),
      refresh_expires_at: formatExpiry(refreshExpiresIn || 180 * 86400),
      account: String(data.account ?? ""),
      seller_id: String(cui.seller_id ?? ""),
      short_code: String(cui.short_code ?? ""),
      country: String(cui.country ?? ""),
    };
  } catch (e) {
    return {
      ok: false,
      detail: `Gagal menghubungi server Lazada: ${
        e instanceof Error ? e.message : "kesalahan tidak dikenal"
      }`,
    };
  }
}

/** Format waktu kedaluwarsa "YYYY-MM-DD HH:MM:SS" (UTC, konsisten dengan db). */
function formatExpiry(seconds: number): string {
  return new Date(Date.now() + seconds * 1000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}
