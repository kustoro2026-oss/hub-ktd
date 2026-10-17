// Klien OAuth & API Lazada Open Platform (pasar Indonesia) untuk KTD Hub.
// App "KTD Hub" (Seller In-house APP, App Key 143047): token diambil lewat
// alur OAuth2.0 Server-side — seller setujui akses di auth.lazada.com lalu
// ?code= dikirim ke callback dan ditukar di sini.
// Referensi: open.lazada.com/apps/doc (OAuth Server-side authorization) dan
// SDK resmi lazada-sdk (packages/sdk-ts): endpoint auth dipanggil GET dengan
// query param bertanda tangan, app_secret hanya menjadi kunci HMAC.

import { createHmac } from "crypto";
import { PDFDocument } from "pdf-lib";

import { listLazadaSellerTokens, saveLazadaSellerToken } from "@/lib/db";

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

// ---------- Business API Lazada (Open Platform) ----------

/** Hasil panggilan business API Lazada — konvensi respons `{"code":"0"}`. */
export type LazadaResult<T> =
  | { ok: true; data: T }
  | { ok: false; detail: string; code?: string };

/** Konteks kredensial + token seller siap pakai (sudah di-refresh otomatis). */
export type LazadaCtx =
  | {
      ok: true;
      appKey: string;
      appSecret: string;
      accessToken: string;
      shortCode: string;
      sellerId: string;
      account: string;
    }
  | { ok: false; detail: string };

/** Ambil token seller Lazada dari DB; otomatis refresh (token/refresh) bila
 *  expires_at terlewati. Dipakai semua fungsi business API di bawah. */
export async function getLazadaCtx(): Promise<LazadaCtx> {
  const env = lazadaEnv();
  if (!env.ready) {
    return {
      ok: false,
      detail:
        "Kredensial aplikasi Lazada belum diatur (env LAZADA_APP_KEY dan LAZADA_APP_SECRET).",
    };
  }
  const tokens = await listLazadaSellerTokens();
  if (tokens.length === 0) {
    return {
      ok: false,
      detail:
        "Belum ada seller Lazada yang terhubung — selesaikan OAuth dulu.",
    };
  }
  const t = tokens[0];
  const nowUtc = new Date().toISOString().slice(0, 19).replace("T", " ");
  if (t.expires_at !== "" && t.expires_at <= nowUtc) {
    if (!t.refresh_token) {
      return {
        ok: false,
        detail:
          "Token seller Lazada kedaluwarsa dan refresh token tidak tersedia — lakukan OAuth ulang.",
      };
    }
    const r = await refreshLazadaToken(t.refresh_token);
    if (!r.ok) {
      return {
        ok: false,
        detail: `Token seller Lazada kedaluwarsa dan refresh gagal: ${r.detail}`,
      };
    }
    // Refresh kadang tidak mengembalikan refresh_token baru — pertahankan
    // yang lama supaya penjadwal tetap bisa memperpanjang di masa depan.
    await saveLazadaSellerToken({
      seller_id: r.seller_id || t.seller_id,
      short_code: r.short_code || t.short_code,
      country: r.country || t.country,
      account: r.account || t.account,
      access_token: r.access_token,
      refresh_token: r.refresh_token || t.refresh_token,
      expires_at: r.expires_at,
      refresh_expires_at: r.refresh_expires_at,
    });
    return {
      ok: true,
      appKey: env.appKey,
      appSecret: env.appSecret,
      accessToken: r.access_token,
      shortCode: r.short_code || t.short_code,
      sellerId: r.seller_id || t.seller_id,
      account: r.account || t.account,
    };
  }
  return {
    ok: true,
    appKey: env.appKey,
    appSecret: env.appSecret,
    accessToken: t.access_token,
    shortCode: t.short_code,
    sellerId: t.seller_id,
    account: t.account,
  };
}

/** Panggil business API Lazada: tandatangani semua param (app_key, timestamp,
 *  access_token, ...) dengan HMAC-SHA256 lalu GET (default) atau POST form.
 *  Kembalikan `data` bila kode respons "0". */
async function callLazadaApi<T>(
  apiPath: string,
  params: Record<string, string>,
  method: "GET" | "POST" = "GET",
): Promise<LazadaResult<T>> {
  const ctx = await getLazadaCtx();
  if (!ctx.ok) return { ok: false, detail: ctx.detail };

  const signed: Record<string, string> = {
    app_key: ctx.appKey,
    timestamp: Date.now().toString(),
    sign_method: "sha256",
    access_token: ctx.accessToken,
    ...params,
  };
  signed.sign = signLazada(ctx.appSecret, apiPath, signed);

  try {
    let res: Response;
    if (method === "POST") {
      const body = new URLSearchParams(signed);
      res = await fetch(API_HOST + apiPath, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        cache: "no-store",
      });
    } else {
      const url = new URL(API_HOST + apiPath);
      for (const [k, v] of Object.entries(signed)) url.searchParams.set(k, v);
      res = await fetch(url.toString(), { method: "GET", cache: "no-store" });
    }
    const data = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const code = String(data.code ?? "");
    if (!res.ok || (code !== "" && code !== "0")) {
      const msg = String(data.message ?? data.msg ?? code ?? res.status);
      return {
        ok: false,
        detail: `Lazada API ${apiPath} gagal (${code || res.status}): ${msg}`,
        code: code || String(res.status),
      };
    }
    return { ok: true, data: data.data as T };
  } catch (e) {
    return {
      ok: false,
      detail: `Gagal menghubungi server Lazada: ${
        e instanceof Error ? e.message : "kesalahan tidak dikenal"
      }`,
    };
  }
}

// ---------- Pesanan ----------

/** Satu pesanan dari /orders/get (data.orders). statuses[] memuat status
 *  berbahasa Inggris (unpaid/pending/packed/ready_to_ship/shipped/
 *  delivered/canceled/returned/failed/to_pack/to_ship/lost). */
export type LazadaOrderRow = {
  order_id: string;
  order_number: string;
  statuses: string[];
  items_count: number;
  price: string;
  address_shipping?: {
    first_name?: string;
    last_name?: string;
    phone?: string;
    phone2?: string;
    address1?: string;
    address2?: string;
    address3?: string;
    address4?: string;
    address5?: string;
    city?: string;
    post_code?: string;
    country?: string;
  };
  created_at: string;
  updated_at: string;
};

/** Filter /orders/get — rentang tanggal berformat ISO8601 (mis.
 *  new Date().toISOString()). Satu status per panggilan; kosongkan status
 *  untuk menarik semua pesanan di rentang. limit maksimal 100. */
export type LazadaOrdersFilter = {
  created_after?: string;
  created_before?: string;
  update_after?: string;
  update_before?: string;
  status?: string;
  sort_by?: "created_at" | "updated_at";
  sort_direction?: "ASC" | "DESC";
  offset?: number;
  limit?: number;
};

/** GET /orders/get — daftar pesanan terbaru (semua status bila status
 *  kosong). countTotal = jumlah total di rentang (bukan di halaman ini). */
export async function getLazadaOrders(
  filter: LazadaOrdersFilter = {},
): Promise<
  LazadaResult<{ countTotal: number; count: number; orders: LazadaOrderRow[] }>
> {
  const params: Record<string, string> = {
    sort_by: filter.sort_by ?? "created_at",
    sort_direction: filter.sort_direction ?? "DESC",
    offset: String(filter.offset ?? 0),
    limit: String(Math.min(filter.limit ?? 100, 100)),
  };
  if (filter.created_after) params.created_after = filter.created_after;
  if (filter.created_before) params.created_before = filter.created_before;
  if (filter.update_after) params.update_after = filter.update_after;
  if (filter.update_before) params.update_before = filter.update_before;
  if (filter.status) params.status = filter.status;

  const r = await callLazadaApi<{
    countTotal?: number;
    count?: number;
    orders?: LazadaOrderRow[];
  }>("/orders/get", params);
  if (!r.ok) return r;
  return {
    ok: true,
    data: {
      countTotal: Number(r.data.countTotal ?? 0),
      count: Number(r.data.count ?? 0),
      orders: (r.data.orders ?? []).map((o) => ({
        ...o,
        // API mengembalikan order_id/order_number sebagai ANGKA — kolom
        // tabel seen menyimpannya sebagai teks. Tanpa normalisasi ke string,
        // perbandingan `seen.order_id === orderId` selalu gagal dan setiap
        // ronde pengecekan menganggap pesanan itu baru (notif WA berulang).
        order_id: String(o.order_id ?? ""),
        order_number: String(o.order_number ?? ""),
        statuses: Array.isArray(o.statuses) ? o.statuses : [],
        items_count: Number(o.items_count ?? 0),
        // API Lazada ID mengembalikan waktu lokal ber-offset (mis.
        // "2026-10-13 06:24:54 +0700") — normalisasi ke UTC murni karena
        // semua kode hilir (tabel pesanan, keuangan) mengasumsikan UTC.
        created_at: lazadaTimeUtc(o.created_at),
        updated_at: lazadaTimeUtc(o.updated_at),
      })),
    },
  };
}

/** Normalisasi stempel waktu Lazada ("YYYY-MM-DD HH:MM:SS [+HHMM]") menjadi
 *  UTC murni "YYYY-MM-DD HH:MM:SS". Tanpa offset dianggap sudah UTC; input
 *  yang bukan pola ini dikembalikan apa adanya. Idempotent. */
export function lazadaTimeUtc(s: string): string {
  if (!s) return "";
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?: ([+-])(\d{2}):?(\d{2}))?$/.exec(
    s.trim(),
  );
  if (!m) return s;
  const base = Date.parse(m[1] + "T" + m[2] + "Z");
  if (!Number.isFinite(base)) return s;
  const shiftMin = m[3]
    ? (m[3] === "+" ? 1 : -1) * (Number(m[4]) * 60 + Number(m[5] ?? 0))
    : 0;
  const d = new Date(base - shiftMin * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** Satu order item dari /order/items/get — Lazada menulis SATU baris per
 *  unit yang dibeli (qty 2 = dua baris dengan order_item_id berbeda).
 *  status item = status pengiriman per unit. */
export type LazadaOrderItemRow = {
  order_item_id: string;
  order_id: string;
  name: string;
  sku: string;
  shop_sku: string;
  seller_sku: string;
  item_price: string;
  paid_price: string;
  status: string;
  variation: string;
  order_type: string;
  shipping_type: string;
  shipment_provider: string;
  tracking_code: string;
  sla_time_stamp: string;
};

/** GET /order/items/get — rincian item satu pesanan (data langsung berupa
 *  array order item). Semua kolom dinormalisasi ke string karena API
 *  mengembalikan id numerik (order_item_id/order_id) — kunci tabel
 *  lazada_order_seen berupa teks, perbandingan number vs string selalu
 *  salah dan membuat notif pesanan baru terkirim berulang-ulang. */
export async function getLazadaOrderItems(
  orderId: string,
): Promise<LazadaResult<LazadaOrderItemRow[]>> {
  const r = await callLazadaApi<unknown>("/order/items/get", {
    order_id: orderId,
  });
  if (!r.ok) return r;
  if (!Array.isArray(r.data)) return { ok: true, data: [] };
  const toStr = (v: unknown): string =>
    v === null || v === undefined ? "" : String(v);
  const raw = r.data as Record<string, unknown>[];
  return {
    ok: true,
    data: raw.map((it) => ({
      order_item_id: toStr(it.order_item_id),
      order_id: toStr(it.order_id),
      name: toStr(it.name),
      sku: toStr(it.sku),
      shop_sku: toStr(it.shop_sku),
      seller_sku: toStr(it.seller_sku),
      item_price: toStr(it.item_price),
      paid_price: toStr(it.paid_price),
      status: toStr(it.status),
      variation: toStr(it.variation),
      order_type: toStr(it.order_type),
      shipping_type: toStr(it.shipping_type),
      shipment_provider: toStr(it.shipment_provider),
      tracking_code: toStr(it.tracking_code),
      sla_time_stamp: toStr(it.sla_time_stamp),
    })),
  };
}

// ---------- Fulfillment (pack → rts → label) ----------

/** Satu penyedia pengiriman dari GET /shipment/providers/get. `name` adalah
 *  nilai yang dikirim sebagai ShippingProvider/shipment_provider. */
export type LazadaShipmentProvider = {
  name: string;
  is_default: string;
  api_integration: string;
  cod: string;
  tracking_code_validation_regex: string;
  tracking_code_example: string;
  enabled_delivery_options: string;
};

/** GET /shipment/providers/get — daftar penyedia pengiriman yang tersedia
 *  untuk toko. Wajib sebagai bahan pack/rts dropship. */
export async function getLazadaShipmentProviders(): Promise<
  LazadaResult<LazadaShipmentProvider[]>
> {
  const r = await callLazadaApi<{ shipment_providers?: unknown }>(
    "/shipment/providers/get",
    {},
  );
  if (!r.ok) return r;
  const raw = Array.isArray(r.data.shipment_providers)
    ? (r.data.shipment_providers as Record<string, unknown>[])
    : [];
  return {
    ok: true,
    data: raw.map((p) => ({
      name: String(p.name ?? ""),
      is_default: String(p.is_default ?? ""),
      api_integration: String(p.api_integration ?? ""),
      cod: String(p.cod ?? ""),
      tracking_code_validation_regex: String(
        p.tracking_code_validation_regex ?? "",
      ),
      tracking_code_example: String(p.tracking_code_example ?? ""),
      enabled_delivery_options: String(p.enabled_delivery_options ?? ""),
    })),
  };
}

/** POST /order/pack (SetStatusToPackedByMarketplace) — kemas item dropship.
 *  Syarat: item masih Pending/Ready To Ship (E073). Response berisi
 *  package_id + tracking_number (dihasilkan Lazada; tetap diganti saat rts). */
export async function packLazadaOrder(
  orderItemIds: string[],
  shipmentProvider: string,
): Promise<LazadaResult<{ packageId: string; trackingNumber: string }>> {
  const r = await callLazadaApi<Record<string, unknown>>(
    "/order/pack",
    {
      OrderItemIds: JSON.stringify(orderItemIds),
      DeliveryType: "dropship",
      ShippingProvider: shipmentProvider,
    },
    "POST",
  );
  if (!r.ok) return r;
  return {
    ok: true,
    data: {
      packageId: String(r.data.package_id ?? r.data.PackageId ?? ""),
      trackingNumber: String(
        r.data.tracking_number ?? r.data.TrackingNumber ?? "",
      ),
    },
  };
}

/** POST /order/rts (SetStatusToReadyToShip) — terbitkan resi dropship
 *  dengan nomor resi PENJUAL (KT...). Syarat: item sudah packed; nomor resi
 *  wajib unik (E063 bila duplikat). */
export async function rtsLazadaOrder(
  orderItemIds: string[],
  shipmentProvider: string,
  trackingNumber: string,
): Promise<LazadaResult<Record<string, unknown>>> {
  return callLazadaApi<Record<string, unknown>>(
    "/order/rts",
    {
      delivery_type: "dropship",
      order_item_ids: JSON.stringify(orderItemIds),
      shipment_provider: shipmentProvider,
      tracking_number: trackingNumber,
    },
    "POST",
  );
}

/** GET /order/document/get — unduh dokumen (label pengiriman) base64.
 *  Syarat: item sudah packed (E034 bila belum). */
export async function getLazadaDocument(
  orderItemIds: string[],
  docType = "shippingLabel",
): Promise<LazadaResult<{ base64: string; mimeType: string }>> {
  const r = await callLazadaApi<{
    document?: { file?: string; mime_type?: string };
  }>("/order/document/get", {
    doc_type: docType,
    // Format resmi (docs Open Platform, contoh Java/CURL): daftar id dalam
    // kurung siku TANPA tanda kutip — "[279709, 279709]". JSON.stringify
    // menambah tanda kutip di sekitar id, membuat Lazada gagal parse
    // (code 6 "For input string: \"...\"") atau membalas file kosong
    // (peristiwa 17 Okt 2026: label shippingLabel 1 byte, invoice code 6).
    order_item_ids: "[" + orderItemIds.join(", ") + "]",
  });
  if (!r.ok) return r;
  const doc = r.data.document ?? {};
  const base64 = String(doc.file ?? "");
  if (base64 === "") {
    return { ok: false, detail: "Dokumen tidak dikembalikan server (file kosong)" };
  }
  return { ok: true, data: { base64, mimeType: String(doc.mime_type ?? "") } };
}

/** Label PDF yang sudah dipastikan valid (bukan file rusak/kosong). */
type LazadaLabelPdf = { pdf: Buffer; pageCount: number; docType: string };

/** Unduh label pengiriman dan PASTIKAN PDF valid. API kadang membalas
 *  code 0 dengan file rusak/kosong — peristiwa 17 Okt 2026: document/get
 *  membalas 1 byte, label itu diteruskan ke pembayaran Aneka lalu ditolak
 *  situs PADAHAL saldo/varian/stock aman. Validasi di sini memastikan
 *  kegagalan label terjadi SEBELUM saldo dipindahkan, bukan sesudah.
 *  Dicoba sampai 3 ronde dengan jeda; tiap ronde mencoba beberapa
 *  doc_type — shippingLabel dulu (label standar), lalu thermalPrintedLabel
 *  (format thermal 10x15 yang diminta Aneka), airWayBill, invoice, dan
 *  carInvoice. Pesanan own-logistics kadang hanya punya sebagian jenis
 *  dokumen, jadi mencoba banyak jenis menaikkan peluang dapat label. */
export async function getLazadaLabelPdf(
  orderItemIds: string[],
): Promise<LazadaResult<LazadaLabelPdf>> {
  const docTypes = [
    "shippingLabel",
    "thermalPrintedLabel",
    "airWayBill",
    "invoice",
    "carInvoice",
  ];
  const keterangan: string[] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    for (const docType of docTypes) {
      const doc = await getLazadaDocument(orderItemIds, docType);
      if (!doc.ok) {
        keterangan.push(`${docType}: ${doc.detail}`);
        continue;
      }
      try {
        const pdf = Buffer.from(doc.data.base64, "base64");
        if (pdf.length < 5 || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
          keterangan.push(
            `${docType}: bukan PDF valid (${pdf.length} byte, mime ${doc.data.mimeType || "?"})`,
          );
          continue;
        }
        let pageCount = 1;
        try {
          const parsed = await PDFDocument.load(pdf, { ignoreEncryption: true });
          pageCount = parsed.getPageCount();
        } catch {
          // Header PDF valid tetapi badan tidak bisa dibaca — tetap pakai;
          // hanya jumlah halaman yang tidak diketahui.
        }
        return { ok: true, data: { pdf, pageCount, docType } };
      } catch (e) {
        keterangan.push(
          `${docType}: gagal membaca file (${e instanceof Error ? e.message : "tidak dikenal"})`,
        );
      }
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
  }
  return {
    ok: false,
    detail: `Label pengiriman tidak valid (${keterangan.join("; ")})`,
  };
}

/** Rantai fulfill satu paket pesanan Lazada (own-logistics dropship):
 *  pack → ready-to-ship dengan nomor resi penjual → unduh label PDF.
 *  Penyedia pengiriman: env LAZADA_SHIPMENT_PROVIDER bila diatur, kalau
 *  tidak penyedia ber-is_default dari GetShipmentProviders, kalau tidak
 *  penyedia pertama. Nomor resi awal = LAZADA_TRACKING_PREFIX (default
 *  "KT") + order_id — tetapi untuk kurir TERINTEGRASI (mis. LEX ID)
 *  Lazada membuat AWB sendiri dan mengabaikan nomor penjual, jadi setelah
 *  rts nomor resi dibaca ulang dari tracking_code item (peristiwa 17 Okt
 *  2026: rts pakai KT... tetapi pesanan ber-AWB LXAD-...).
 *  Dipakai lazada-resi.ts (jalur kirim resi ke WA) dan lazada-exec.ts
 *  (pemenuhan saat pemilik menyetujui eksekusi). */
export async function fulfillLazadaOrderForItems(
  orderItemIds: string[],
  orderId: string,
): Promise<
  | { ok: true; pdf: Buffer; pageCount: number; trackingNumber: string }
  | { ok: false; detail: string; rtsDone?: boolean; trackingNumber?: string }
> {
  if (orderItemIds.length === 0) {
    return { ok: false, detail: "Daftar item pesanan kosong — tidak bisa diproses" };
  }
  const provs = await getLazadaShipmentProviders();
  if (!provs.ok) return { ok: false, detail: provs.detail };
  const provider =
    (process.env.LAZADA_SHIPMENT_PROVIDER ?? "").trim() ||
    provs.data.find((p) => p.is_default === "1")?.name ||
    provs.data[0]?.name ||
    "";
  if (provider === "") {
    return {
      ok: false,
      detail:
        "Tidak ada penyedia pengiriman yang tersedia (GetShipmentProviders kosong)",
    };
  }
  const tracking = `${(process.env.LAZADA_TRACKING_PREFIX ?? "KT").trim()}${orderId}`;

  const pack = await packLazadaOrder(orderItemIds, provider);
  let packErr = "";
  if (!pack.ok) {
    // Percobaan ulang setelah pack sudah pernah berhasil akan ditolak
    // (item tidak lagi Pending) — jangan langsung gagal: coba lanjut ke
    // rts, kalau rts lolos berarti paket memang sudah dikemas sebelumnya.
    packErr = pack.detail;
  }
  const rts = await rtsLazadaOrder(orderItemIds, provider, tracking);
  if (!rts.ok) {
    const awal = packErr !== "" ? `Gagal pack (${provider}): ${packErr} — dan ` : "";
    return {
      ok: false,
      detail: `${awal}gagal ready-to-ship (resi ${tracking}): ${rts.detail}`,
    };
  }
  // Kurir terintegrasi membuat AWB sendiri — baca nomor resi ASLI dari item
  // supaya label/Aneka cocok dengan pelacakan Lazada; bila kosong (kurir
  // non-integrated), nomor resi penjual di atas tetap dipakai.
  let trackingFinal = tracking;
  try {
    const its = await getLazadaOrderItems(orderId);
    if (its.ok) {
      const asli = its.data
        .map((x) => (x.tracking_code ?? "").trim())
        .find((x) => x !== "");
      if (asli) trackingFinal = asli;
    }
  } catch {
    // Biarkan — nomor resi penjual tetap sah sebagai cadangan.
  }
  const doc = await getLazadaLabelPdf(orderItemIds);
  if (!doc.ok) {
    // rts SUDAH berhasil — pesanan siap kirim, hanya label resmi yang
    // tidak tersedia. rtsDone memberi tahu pemanggil bahwa boleh memakai
    // resi PDF buatan sendiri (dropship own-logistics).
    return {
      ok: false,
      detail: `Gagal unduh label: ${doc.detail}`,
      rtsDone: true,
      trackingNumber: trackingFinal,
    };
  }
  return { ok: true, pdf: doc.data.pdf, pageCount: doc.data.pageCount, trackingNumber: trackingFinal };
}

// ---------- Produk ----------

/** Satu SKU produk dari /products/get (skus[]). SellerSku = kunci pemetaan
 *  produk ke Aneka. */
export type LazadaProductSku = {
  SellerSku: string;
  SkuId: string;
  price: string;
  special_price: string;
  quantity: number;
  Status: string;
};

/** Satu produk dari /products/get (data.products). */
export type LazadaProductRow = {
  item_id: string;
  status: string;
  images: string[];
  primary_category: string;
  attributes?: { name?: string };
  skus?: LazadaProductSku[];
};

export type LazadaProductsFilter = {
  filter?: "all" | "live" | "inactive" | "sold-out";
  sku_seller_list?: string[];
  offset?: number;
  limit?: number;
};

/** GET /products/get — daftar produk (maks 50/halaman). sku_seller_list
 *  membatasi ke SKU tertentu (maks 100, JSON array). */
export async function getLazadaProducts(
  filter: LazadaProductsFilter = {},
): Promise<LazadaResult<{ total: number; products: LazadaProductRow[] }>> {
  const params: Record<string, string> = {
    filter: filter.filter ?? "all",
    offset: String(filter.offset ?? 0),
    limit: String(Math.min(filter.limit ?? 50, 50)),
  };
  if (filter.sku_seller_list && filter.sku_seller_list.length > 0) {
    params.sku_seller_list = JSON.stringify(filter.sku_seller_list.slice(0, 100));
  }
  const r = await callLazadaApi<{
    total_products?: number;
    products?: LazadaProductRow[];
  }>("/products/get", params);
  if (!r.ok) return r;
  return {
    ok: true,
    data: {
      total: Number(r.data.total_products ?? 0),
      products: (r.data.products ?? []).map((p) => ({
        ...p,
        images: Array.isArray(p.images) ? p.images : [],
        skus: Array.isArray(p.skus) ? p.skus : [],
      })),
    },
  };
}

/** POST /product/price_quantity/update — update massal harga/stok. `payload`
 *  = string XML Request/Product (maks 50 produk, disarankan 20 per request).
 *  Sukses = kode "0" (tanpa data berarti). */
export async function updateLazadaPriceQuantity(
  payload: string,
): Promise<LazadaResult<Record<string, unknown>>> {
  return callLazadaApi<Record<string, unknown>>(
    "/product/price_quantity/update",
    { payload },
    "POST",
  );
}
