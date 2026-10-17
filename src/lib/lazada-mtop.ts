// Klien mtop web Seller Center untuk mencetak AWB RESMI pesanan kurir
// terintegrasi (LEX dsb.) — dokumen yang tidak pernah tersedia lewat Open
// Platform (peristiwa 17 Okt 2026: /order/document/get membalas file 1 byte
// untuk pesanan LEX-integrated).
//
// Meniru panggilan tombol "Cetak AWB" di web Seller Center:
//   POST https://acs-m.lazada.co.id/h5/mtop.lazada.seller.order.package.print/1.0/
//   query: appKey=4272 (appKey web), t=epoch ms, sign=MD5(token&t&appKey&body)
//   cookie: sesi web seller tersimpan di tabel lazada_web_sessions
//   token = nilai _m_h5_tk cookie (bagian sebelum "_").
// Respons sukses memuat URL PDF di OSS — diunduh lalu dipakai sebagai label.
//
// Token _m_h5_tk diputar gateway secara berkala; setiap respons membawa
// token baru lewat Set-Cookie sehingga sesi tersimpan ikut diperbarui.
import { createHash } from "node:crypto";
import { getLazadaWebSession, saveLazadaWebSession } from "@/lib/db";

const MTOP_HOST = "https://acs-m.lazada.co.id";
const APP_KEY = "4272";
const PRINT_API = "mtop.lazada.seller.order.package.print";
const RENEW_API = "mtop.taobao.wireless.mtop.token.renew";

/** Short code toko KTD Store (Seller Center → Pengaturan → Kode Pendek). */
const SELLER_SHORT_CODE = "ID69LJAH8J";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

export type LazadaMtopAwbResult =
  | { ok: true; pdf: Buffer; sumber: "mtop-awb" }
  | { ok: false; detail: string };

function md5(s: string): string {
  return createHash("md5").update(s).digest("hex");
}

function cookiePair(cookieText: string, name: string): string {
  for (const part of cookieText.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return "";
}

/** Nilai token _m_h5_tk (bagian sebelum "_") + masa kedaluwarsanya (epoch ms). */
function mtopToken(cookieText: string): { token: string; expiresAt: number } {
  const raw = cookiePair(cookieText, "_m_h5_tk");
  const [token = "", exp = "0"] = raw.split("_");
  return { token, expiresAt: Number(exp) || 0 };
}

/** Ganti satu pasangan cookie tanpa mengubah sisanya. */
function replaceCookiePair(
  cookieText: string,
  name: string,
  value: string,
): string {
  const pairs = cookieText
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i), p.slice(i + 1)] as const;
    });
  const map = new Map(pairs.map(([k, v]) => [k, v]));
  map.set(name, value);
  return Array.from(map.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

/** Serap token mtop baru dari Set-Cookie respons gateway (token diputar
 *  otomatis) — sesi tersimpan tetap segar selama dipakai. */
function absorbSetCookie(
  cookieText: string,
  headers: Headers,
  sellerId: string,
): void {
  const setCookies = headers.getSetCookie?.() ?? [];
  let next = cookieText;
  let changed = false;
  for (const sc of setCookies) {
    const m = /^\s*([^=;]+)=([^;]*)/.exec(sc);
    if (!m) continue;
    if (m[1] !== "_m_h5_tk" && m[1] !== "_m_h5_tk_enc") continue;
    next = replaceCookiePair(next, m[1], m[2]);
    changed = true;
  }
  if (changed) {
    const { expiresAt } = mtopToken(next);
    void saveLazadaWebSession(sellerId, next, String(expiresAt)).catch(() => {
      // penyimpanan gagal — sesi lama tetap terpakai sampai panggilan
      // berikutnya; bukan kegagalan fatal untuk cetak ini.
    });
  }
}

/** Panggil satu API mtop dengan sesi tersimpan (POST JSON, sign MD5). */
async function callMtop(
  api: string,
  data: Record<string, unknown>,
  cookieText: string,
): Promise<{ ret: string[]; raw: unknown; headers: Headers }> {
  const { token } = mtopToken(cookieText);
  const body = JSON.stringify(data);
  const t = Date.now();
  const sign = md5(`${token}&${t}&${APP_KEY}&${body}`);
  const q = new URLSearchParams({
    jsv: "2.6.1",
    appKey: APP_KEY,
    t: String(t),
    sign,
    v: "1.0",
    timeout: "30000",
    H5Request: "true",
    url: api,
    api,
    type: "originaljson",
    dataType: "json",
    valueType: "original",
    "x-i18n-regionID": "LAZADA_ID",
  });
  const res = await fetch(`${MTOP_HOST}/h5/${api}/1.0/?${q.toString()}`, {
    method: "POST",
    headers: {
      Cookie: cookieText,
      "Content-Type": "application/json",
      "User-Agent": UA,
      Referer: "https://sellercenter.lazada.co.id/",
      Origin: "https://sellercenter.lazada.co.id",
    },
    body,
  });
  const txt = await res.text();
  let parsed: unknown = txt;
  try {
    parsed = JSON.parse(txt);
  } catch {
    // bukan JSON — biarkan sebagai teks mentah.
  }
  const ret = (parsed as { ret?: string[] } | null)?.ret ?? [];
  return { ret, raw: parsed, headers: res.headers };
}

/** Cari URL PDF di respons mtop (bentuk pastinya bervariasi — cari semua
 *  URL http(s) lalu pilih yang mengarah ke OSS/PDF). */
function extractPdfUrl(raw: unknown): string {
  const s = typeof raw === "string" ? raw : JSON.stringify(raw);
  const urls = s.match(/https?:\/\/[^"'\\\s]+/g) ?? [];
  return (
    urls.find((u) => /\.pdf(\?|$)/i.test(u)) ??
    urls.find((u) => u.includes("oss") && u.includes("PDF")) ??
    urls.find((u) => u.includes("logistics-waybill")) ??
    ""
  );
}

/** Perbarui token mtop yang kedaluwarsa memakai cookie _m_h5_tk_enc
 *  (protokol perpanjangan token lib-mtop). Kembalikan nilai _m_h5_tk baru
 *  dari Set-Cookie, atau null bila perpanjangan ditolak (sesi SSO mati). */
async function renewMtopToken(cookieText: string): Promise<string | null> {
  const enc = cookiePair(cookieText, "_m_h5_tk_enc");
  if (!enc) return null;
  const { token } = mtopToken(cookieText);
  const body = JSON.stringify({ appKey: APP_KEY });
  const t = Date.now();
  const sign = md5(`${token}&${t}&${APP_KEY}&${body}`);
  const q = new URLSearchParams({
    jsv: "2.6.1",
    appKey: APP_KEY,
    t: String(t),
    sign,
    v: "1.0",
    timeout: "30000",
    H5Request: "true",
    url: RENEW_API,
    api: RENEW_API,
    type: "originaljson",
    dataType: "json",
    valueType: "original",
  });
  try {
    const res = await fetch(`${MTOP_HOST}/h5/${RENEW_API}/1.0/?${q.toString()}`, {
      method: "POST",
      headers: {
        Cookie: cookieText,
        "Content-Type": "application/json",
        "User-Agent": UA,
        Referer: "https://sellercenter.lazada.co.id/",
        Origin: "https://sellercenter.lazada.co.id",
      },
      body,
    });
    const setCookies = res.headers.getSetCookie?.() ?? [];
    const tk = setCookies.find((c) => c.startsWith("_m_h5_tk="));
    if (tk) {
      const m = /^_m_h5_tk=([^;]+)/.exec(tk);
      if (m) return m[1];
    }
  } catch {
    return null;
  }
  return null;
}

/** Unduh PDF AWB dari URL OSS dan validasi penanda %PDF-. */
async function downloadAwbPdf(
  url: string,
  cookieText: string,
): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      headers: { Cookie: cookieText, "User-Agent": UA },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 5 || buf.subarray(0, 5).toString("latin1") !== "%PDF-") {
      return null;
    }
    return buf;
  } catch {
    return null;
  }
}

/** Cetak AWB RESMI satu pesanan lewat sesi web Seller Center tersimpan —
 *  dokumen asli Lazada (persis hasil tombol "Cetak AWB"). Bila sesi belum
 *  disimpan, kedaluwarsa, atau pesanan tidak bisa dicetak (sudah pernah
 *  dicetak/dibatalkan), kembalikan ok:false dengan alasan. */
export async function getLazadaResmiAWB(
  orderId: string,
  orderItemIds: string[],
): Promise<LazadaMtopAwbResult> {
  const row = await getLazadaWebSession(SELLER_SHORT_CODE);
  if (!row || !row.cookie_text.trim()) {
    return {
      ok: false,
      detail: "Sesi web Seller Center belum tersimpan (login ulang)",
    };
  }
  let cookies = row.cookie_text;

  let call = await callMtop(
    PRINT_API,
    {
      processRequest: {
        orders: [{ orderId, orderItemIds }],
        types: ["awb"],
        source: "completeHtmlAwb",
      },
    },
    cookies,
  );
  absorbSetCookie(cookies, call.headers, SELLER_SHORT_CODE);

  // Token mtop kedaluwarsa — coba perpanjang dengan _m_h5_tk_enc lalu ulangi
  // sekali. Bila perpanjangan ditolak, sesi SSO kemungkinan mati.
  const retTxt = call.ret.join(" ");
  const tokenExpired =
    /TOKEN/i.test(retTxt) && /EXPIRE|EXOIRED|INVALID|EMPTY/i.test(retTxt);
  if (tokenExpired) {
    const baru = await renewMtopToken(cookies);
    if (baru) {
      cookies = replaceCookiePair(cookies, "_m_h5_tk", baru);
      await saveLazadaWebSession(
        SELLER_SHORT_CODE,
        cookies,
        String(Date.now() + 3600_000),
      ).catch(() => {});
      call = await callMtop(
        PRINT_API,
        {
          processRequest: {
            orders: [{ orderId, orderItemIds }],
            types: ["awb"],
            source: "completeHtmlAwb",
          },
        },
        cookies,
      );
      absorbSetCookie(cookies, call.headers, SELLER_SHORT_CODE);
    }
  }

  const okRet = call.ret.some((r) => /^SUCCESS/i.test(r));
  const url = extractPdfUrl(call.raw);
  if (!okRet || !url) {
    return {
      ok: false,
      detail:
        (call.ret[0] ?? "respons tidak dikenali").slice(0, 220) ||
        "mtop print tanpa respons",
    };
  }
  const pdf = await downloadAwbPdf(url, cookies);
  if (!pdf) {
    return { ok: false, detail: "PDF AWB tidak bisa diunduh dari OSS" };
  }
  return { ok: true, pdf, sumber: "mtop-awb" };
}

/** Info sesi web tersimpan (tanpa nilai cookie) — untuk pemeriksaan admin. */
export async function getLazadaWebSessionInfo(): Promise<{
  ada: boolean;
  seller_id: string;
  updated_at?: string;
  tk_expires_at?: string;
}> {
  const row = await getLazadaWebSession(SELLER_SHORT_CODE);
  return {
    ada: !!row?.cookie_text.trim(),
    seller_id: SELLER_SHORT_CODE,
    ...(row
      ? { updated_at: row.updated_at, tk_expires_at: row.tk_expires_at }
      : {}),
  };
}
