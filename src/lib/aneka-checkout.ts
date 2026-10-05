// Modul checkout Aneka untuk eksekusi pesanan TikTok Shop → Anekadropship
// (Fase 2, mode semi-otomatis). Situs Aneka adalah Laravel + Alpine.js TANPA
// API publik — alurnya ditiru persis dari form asli (ditemukan lewat probe):
//
//   login → POST /payment/create (JSON kosong, header X-CSRF-TOKEN) →
//   POST /variant/save (FormData per produk) → GET /checkout-barang/{id} →
//   POST /pembayaran/process (multipart: resi_number[i], resi_file[i],
//   payment_category=wallet, wallet_source=wallet).
//
// Situs sering error saat beban tinggi (Cloudflare 522) — setiap fetch
// dibungkus coba-ulang dengan jeda. Sesi (cookie + token CSRF) hidup hanya
// dalam satu pemanggilan serverless: setiap fase membuat sesi baru.
import { PDFDocument } from "pdf-lib";

const BASE = "https://anekadropship.id";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Kredensial login Aneka dari env (password bisa base64). */
function anekaCreds(): { email: string; password: string } | { error: string } {
  const email = process.env.ANEKA_EMAIL ?? "";
  const b64 = process.env.ANEKA_PASSWORD_B64 ?? "";
  const password = b64
    ? Buffer.from(b64, "base64").toString("utf8")
    : (process.env.ANEKA_PASSWORD ?? "");
  if (!email || !password) {
    return {
      error: "ANEKA_EMAIL / ANEKA_PASSWORD_B64 belum diatur di env",
    };
  }
  return { email, password };
}

export type AnekaSession = {
  cookie: string;
  /** Token CSRF dari <meta name="csrf-token"> (dipakai /payment/create). */
  csrf: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Gabungkan cookie Set-Cookie baru ke jar cookie. */
function grabCookie(cookie: string, res: Response): string {
  let jar = cookie;
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const pair = c.split(";")[0];
    const name = pair.split("=")[0];
    jar = jar.replace(new RegExp(`${name}=[^;]*;?`), "") + pair + "; ";
  }
  return jar;
}

/** Fetch dengan coba-ulang untuk galat jaringan (situs sering 522/timeout). */
async function fetchRetry(
  cookie: string,
  url: string,
  init: RequestInit = {},
  attempts = 2,
): Promise<Response> {
  let lastErr: unknown = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, {
        ...init,
        headers: {
          "User-Agent": UA,
          ...(cookie ? { Cookie: cookie } : {}),
          ...(init.headers ?? {}),
        },
      });
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await sleep(1200 * (i + 1));
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("Network error saat mengakses anekadropship.id");
}

/** Login Laravel (form biasa) — kembalikan sesi siap pakai. */
export async function anekaLogin(): Promise<
  { ok: true; session: AnekaSession } | { ok: false; detail: string }
> {
  const creds = anekaCreds();
  if ("error" in creds) return { ok: false, detail: creds.error };

  let jar = "";
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      jar = "";
      const page = await fetchRetry(jar, `${BASE}/login`, {
        redirect: "manual",
      });
      jar = grabCookie(jar, page);
      const html = await page.text();
      const token = /name="_token"[^>]*value="([^"]+)"/.exec(html)?.[1] ?? "";
      if (!token) {
        lastErr = "Halaman login tanpa token CSRF (kemungkinan challenge Cloudflare)";
        await sleep(1200);
        continue;
      }
      const res = await fetchRetry(jar, `${BASE}/login`, {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          _token: token,
          email: creds.email,
          password: creds.password,
        }),
      });
      jar = grabCookie(jar, res);
      const loc = res.headers.get("location") ?? "";
      if (
        res.status === 419 ||
        (res.status >= 300 && res.status < 400 && loc.includes("/login"))
      ) {
        lastErr = "Login anekadropship gagal (kredensial ditolak atau sesi terblokir)";
        await sleep(1200);
        continue;
      }
      // Ambil token CSRF meta dari halaman setelah login.
      const home = await fetchRetry(jar, `${BASE}/user/home`);
      jar = grabCookie(jar, home);
      const homeHtml = await home.text();
      const csrf =
        /name="csrf-token"[^>]*content="([^"]+)"/.exec(homeHtml)?.[1] ?? "";
      if (!csrf) {
        return { ok: false, detail: "Token CSRF tidak ditemukan setelah login" };
      }
      return { ok: true, session: { cookie: jar, csrf } };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : "kesalahan tidak dikenal";
      await sleep(1200);
    }
  }
  return { ok: false, detail: lastErr || "Login anekadropship gagal" };
}

/** Buat payment kosong → payment_id (kunci satu transaksi checkout). */
export async function anekaCreatePayment(
  s: AnekaSession,
): Promise<{ ok: true; paymentId: string } | { ok: false; detail: string }> {
  try {
    const res = await fetchRetry(s.cookie, `${BASE}/payment/create`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "X-CSRF-TOKEN": s.csrf,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      payment_id?: unknown;
      message?: string;
    };
    if (!data.success || !data.payment_id) {
      return {
        ok: false,
        detail: `Gagal membuat payment: ${String(data.message ?? res.status)}`,
      };
    }
    return { ok: true, paymentId: String(data.payment_id) };
  } catch (e) {
    return {
      ok: false,
      detail: `Gagal membuat payment: ${e instanceof Error ? e.message : "kesalahan tidak dikenal"}`,
    };
  }
}

export type AnekaCartItem = {
  productId: string;
  variantId?: string;
  qty: number;
  /** Jumlah slot resi yang diwakili produk ini (biasanya 1 untuk produk
   *  pertama, 0 untuk sisanya — satu paket = satu resi). */
  resiCount: number;
};

/** Simpan satu produk ke payment (FormData PHP-array ala Laravel). */
async function anekaVariantSaveOne(
  s: AnekaSession,
  paymentId: string,
  item: AnekaCartItem,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  try {
    const fd = new FormData();
    fd.append("_token", s.csrf);
    fd.append("payment_id", paymentId);
    fd.append("product_id", item.productId);
    if (item.variantId) fd.append(`variant_id[${item.productId}]`, item.variantId);
    fd.append(`jumlah[${item.productId}]`, String(item.qty));
    fd.append(`jumlah_resi[${item.productId}]`, String(item.resiCount));
    const res = await fetchRetry(s.cookie, `${BASE}/variant/save`, {
      method: "POST",
      redirect: "manual",
      headers: {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: fd,
    });
    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      message?: string;
      redirect_url?: string;
    };
    if (!data.success) {
      return {
        ok: false,
        detail: `Gagal menyimpan produk ${item.productId}: ${String(data.message ?? res.status)}`,
      };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      detail: `Gagal menyimpan produk ${item.productId}: ${e instanceof Error ? e.message : "kesalahan tidak dikenal"}`,
    };
  }
}

/** Simpan semua produk pesanan ke payment. Produk pertama memegang slot
 *  resi tunggal (satu paket kirim), sisanya mengikuti slot itu. */
export async function anekaVariantSave(
  s: AnekaSession,
  paymentId: string,
  items: AnekaCartItem[],
): Promise<{ ok: true } | { ok: false; detail: string }> {
  for (const item of items) {
    const r = await anekaVariantSaveOne(s, paymentId, item);
    if (!r.ok) return r;
  }
  return { ok: true };
}

/** Token _token dari form /pembayaran/process di halaman checkout. */
export async function anekaCheckoutToken(
  s: AnekaSession,
  paymentId: string,
): Promise<{ ok: true; token: string } | { ok: false; detail: string }> {
  try {
    const res = await fetchRetry(
      s.cookie,
      `${BASE}/checkout-barang/${paymentId}`,
      { redirect: "manual" },
    );
    const html = await res.text();
    const token =
      /name="_token"[^>]*value="([^"]+)"/.exec(html)?.[1] ?? "";
    if (!token) {
      return {
        ok: false,
        detail: `Halaman checkout tidak memuat token (status ${res.status})`,
      };
    }
    return { ok: true, token };
  } catch (e) {
    return {
      ok: false,
      detail: `Gagal membuka halaman checkout: ${e instanceof Error ? e.message : "kesalahan tidak dikenal"}`,
    };
  }
}

/** Kirim pembayaran akhir: upload label resi + bayar pakai saldo (wallet). */
export async function anekaProcessPayment(
  s: AnekaSession,
  paymentId: string,
  token: string,
  resi: { number: string; pdf: Buffer },
): Promise<{ ok: true } | { ok: false; detail: string }> {
  try {
    // Bila label lebih dari 1 halaman (label + daftar pengemasan), situs
    // meminta centang "satu resi, halaman selebihnya lampiran".
    let lampiran = false;
    try {
      const doc = await PDFDocument.load(resi.pdf, { ignoreEncryption: true });
      lampiran = doc.getPageCount() > 1;
    } catch {
      lampiran = false;
    }

    const fd = new FormData();
    fd.append("_token", token);
    fd.append("payment_id", paymentId);
    fd.append("resi_number[0]", resi.number);
    fd.append(
      "resi_file[0]",
      new Blob([new Uint8Array(resi.pdf)], { type: "application/pdf" }),
      "resi.pdf",
    );
    if (lampiran) fd.append("resi_lampiran_diakui", "1");
    fd.append("payment_category", "wallet");
    fd.append("wallet_source", "wallet");

    const res = await fetchRetry(s.cookie, `${BASE}/pembayaran/process`, {
      method: "POST",
      redirect: "manual",
      body: fd,
    });
    // Sukses = JSON success ATAU pengalihan (riwayat/sukses) bukan kembali
    // ke halaman checkout/login.
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        message?: string;
      };
      if (data.success) return { ok: true };
      return {
        ok: false,
        detail: `Pembayaran ditolak: ${String(data.message ?? "tanpa keterangan")}`,
      };
    }
    const loc = res.headers.get("location") ?? "";
    if (res.status >= 200 && res.status < 400 && !loc.includes("login")) {
      return { ok: true };
    }
    const body = await res.text();
    const pesan =
      /(?:error|gagal)[^<]{0,160}/i.exec(body)?.[0]?.trim() || "";
    return {
      ok: false,
      detail: `Pembayaran gagal (status ${res.status}): ${pesan || "tanpa keterangan"}`,
    };
  } catch (e) {
    return {
      ok: false,
      detail: `Pembayaran gagal: ${e instanceof Error ? e.message : "kesalahan tidak dikenal"}`,
    };
  }
}

/** ID pesanan Aneka terbaru dari halaman riwayat (setelah pembayaran). */
export async function anekaNewestOrderId(
  s: AnekaSession,
): Promise<{ ok: true; orderId: string } | { ok: false; detail: string }> {
  try {
    const res = await fetchRetry(
      s.cookie,
      `${BASE}/riwayat-pemesanan`,
      { redirect: "manual" },
    );
    const html = await res.text();
    const m =
      /riwayat-pemesanan\/(\d{4,})/.exec(html) ??
      /(?:ID\s*Pesanan|Order\s*ID)[^\d]{0,20}(\d{4,})/i.exec(html);
    return { ok: true, orderId: m?.[1] ?? "" };
  } catch (e) {
    return {
      ok: false,
      detail: `Gagal membaca riwayat: ${e instanceof Error ? e.message : "kesalahan tidak dikenal"}`,
    };
  }
}
