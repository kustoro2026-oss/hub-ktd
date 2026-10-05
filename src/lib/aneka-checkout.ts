// Modul checkout Aneka untuk eksekusi pesanan TikTok Shop → Anekadropship
// (Fase 2, mode semi-otomatis). Situs Aneka adalah Laravel + Alpine.js TANPA
// API publik — alurnya ditiru persis dari form asli (ditemukan lewat probe):
//
//   login → POST /payment/create (JSON kosong, header X-CSRF-TOKEN) →
//   GET /products/{id} (resolve varian bila produk ber-varian) →
//   POST /variant/save (FormData per produk) → GET /checkout-barang/{id}
//   (token _token + id baris item_resi[]) → POST /pembayaran/process
//   (multipart: resi_number[i], resi_file[i], item_resi[jual_id]=1,
//   payment_category=wallet, wallet_source=wallet) → verifikasi kode
//   ORDER-{payment_id}-... di /riwayat-pemesanan.
//
// Catatan perilaku situs (hasil probe 2026-10):
//   - /payment/create SELALU membuat payment baru (bukan reuse).
//   - /variant/save MENIMPA qty produk yang sama (aman diulang); menolak
//     produk ber-varian tanpa variant_id[pid]; jumlah_resi[pid]=0 valid.
//   - Gagal validasi /pembayaran/process = 302 kembali ke checkout-barang.
//   - Riwayat menampilkan kode ORDER-{payment_id}-{timestamp} sebagai teks
//     polos (tanpa tautan detail).
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

/** Tentukan variant_id untuk produk Aneka (data varian disematkan sebagai
 *  JSON di atribut onclick halaman produk — harus login). Tanpa varian →
 *  ok tanpa variantId. Satu varian → dipakai langsung. Banyak varian →
 *  dicocokkan ukuran dari nama produk TikTok (mis. "100 ml" → size "100"). */
export async function anekaResolveVariant(
  s: AnekaSession,
  productId: string,
  tiktokName: string,
): Promise<
  { ok: true; variantId?: string; label?: string } | { ok: false; detail: string }
> {
  try {
    const res = await fetchRetry(s.cookie, `${BASE}/products/${productId}`, {
      redirect: "manual",
    });
    if (res.status >= 400) {
      return {
        ok: false,
        detail: `Halaman produk ${productId} tidak terbuka (status ${res.status})`,
      };
    }
    const html = await res.text();
    const re = new RegExp(
      `&quot;id&quot;:${productId},[\\s\\S]{0,300}?&quot;has_variants&quot;:(true|false)[\\s\\S]{0,300}?&quot;variants&quot;:(\\[[^\\]]*\\])`,
    );
    const m = re.exec(html);
    if (!m) {
      return {
        ok: false,
        detail: `Data varian produk ${productId} tidak ditemukan di halaman produk`,
      };
    }
    if (m[1] !== "true") return { ok: true }; // produk tanpa varian (spt #57)
    const json = m[2]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&#0?39;/g, "'")
      .replace(/\\\//g, "/");
    let variants: {
      id: number | string;
      name?: string;
      size?: string | null;
      label?: string;
      stock?: number | null;
    }[];
    try {
      variants = JSON.parse(json);
    } catch {
      return {
        ok: false,
        detail: `Data varian produk ${productId} tidak bisa dibaca`,
      };
    }
    const aktif = variants.filter(
      (v) => v.stock === null || v.stock === undefined || Number(v.stock) > 0,
    );
    const list = aktif.length > 0 ? aktif : variants;
    if (list.length === 0) {
      return { ok: false, detail: `Produk ${productId} tidak punya varian aktif` };
    }
    if (list.length === 1) {
      const v = list[0];
      return { ok: true, variantId: String(v.id), label: v.label ?? v.name };
    }
    // Banyak varian → cocokkan ukuran dari nama produk TikTok.
    const sizeTok =
      /(\d+(?:[.,]\d+)?)\s*(ml|milliliter|mililiter|gram|gr|g|kg|kilogram|l|liter|pcs|sachet|sak|butir|cm)\b/i.exec(
        tiktokName,
      );
    if (sizeTok) {
      const num = sizeTok[1].toLowerCase();
      const unit = sizeTok[2].toLowerCase();
      const hits = list.filter((v) => {
        const size = String(v.size ?? "").trim().toLowerCase().replace(/\s+/g, "");
        const label = String(v.label ?? "").toLowerCase();
        const name = String(v.name ?? "").toLowerCase();
        return (
          size === num + unit ||
          size === num ||
          label.includes(num) ||
          name.includes(num)
        );
      });
      if (hits.length === 1) {
        const v = hits[0];
        return { ok: true, variantId: String(v.id), label: v.label ?? v.name };
      }
    }
    return {
      ok: false,
      detail: `Produk ${productId} punya ${list.length} varian dan ukuran tidak jelas dari nama TikTok "${tiktokName}". Pilihan: ${list
        .map((v) => `${v.id} = ${v.label ?? v.name ?? "?"}`)
        .join("; ")}`,
    };
  } catch (e) {
    return {
      ok: false,
      detail: `Gagal membaca varian produk ${productId}: ${e instanceof Error ? e.message : "kesalahan tidak dikenal"}`,
    };
  }
}

/** Token _token dari form /pembayaran/process di halaman checkout, plus id
 *  baris keranjang (jual) untuk penugasan resi item_resi[jual_id]. */
export async function anekaCheckoutToken(
  s: AnekaSession,
  paymentId: string,
): Promise<
  { ok: true; token: string; itemResiIds: string[] } | { ok: false; detail: string }
> {
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
    const itemResiIds = [...html.matchAll(/name="item_resi\[(\d+)\]"/g)].map(
      (m) => m[1],
    );
    return { ok: true, token, itemResiIds };
  } catch (e) {
    return {
      ok: false,
      detail: `Gagal membuka halaman checkout: ${e instanceof Error ? e.message : "kesalahan tidak dikenal"}`,
    };
  }
}

/** Kirim pembayaran akhir: upload label resi + bayar pakai saldo (wallet).
 *  itemResiIds = id baris keranjang dari halaman checkout (item_resi[jual_id]
 *  di form asli; semua ditugaskan ke slot resi 1 = satu paket). */
export async function anekaProcessPayment(
  s: AnekaSession,
  paymentId: string,
  token: string,
  itemResiIds: string[],
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
    for (const id of itemResiIds) fd.append(`item_resi[${id}]`, "1");

    const res = await fetchRetry(s.cookie, `${BASE}/pembayaran/process`, {
      method: "POST",
      redirect: "manual",
      body: fd,
    });

    // Sukses = JSON success ATAU pengalihan ke halaman sukses. Gagal
    // validasi = 302 kembali ke checkout-barang (terbukti lewat probe).
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
    if (res.status >= 400) {
      const body = await res.text();
      const pesan =
        /(?:error|gagal)[^<]{0,160}/i.exec(body)?.[0]?.trim() || "";
      return {
        ok: false,
        detail: `Pembayaran gagal (status ${res.status}): ${pesan || "tanpa keterangan"}`,
      };
    }
    if (loc.includes("checkout-barang") || loc.includes("/login")) {
      return {
        ok: false,
        detail: "Pembayaran ditolak situs (kembali ke halaman checkout) — periksa saldo wallet, varian, dan jumlah resi",
      };
    }
    if (
      loc.includes("riwayat") ||
      loc.includes("sukses") ||
      loc.includes("berhasil")
    ) {
      return { ok: true };
    }
    // Respons tak dikenali → pastikan lewat riwayat (kode ORDER-{payment_id})
    // sebelum menyatakan gagal, supaya coba-ulang tidak membayar dua kali.
    const found = await anekaFindOrderByPayment(s, paymentId);
    if (found.ok && found.orderCode) return { ok: true };
    return {
      ok: false,
      detail: "Respons pembayaran tak dikenali dan pesanan belum tampak di riwayat — periksa manual sebelum mencoba lagi",
    };
  } catch (e) {
    return {
      ok: false,
      detail: `Pembayaran gagal: ${e instanceof Error ? e.message : "kesalahan tidak dikenal"}`,
    };
  }
}

/** Cari kode pesanan di riwayat berdasarkan payment_id (ORDER-{id}-{ts}). */
export async function anekaFindOrderByPayment(
  s: AnekaSession,
  paymentId: string,
): Promise<{ ok: true; orderCode: string } | { ok: false; detail: string }> {
  try {
    const res = await fetchRetry(
      s.cookie,
      `${BASE}/riwayat-pemesanan`,
      { redirect: "manual" },
    );
    const html = await res.text();
    const m = new RegExp(`ORDER-${paymentId}-\\d{6,}`).exec(html);
    return { ok: true, orderCode: m?.[0] ?? "" };
  } catch (e) {
    return {
      ok: false,
      detail: `Gagal membaca riwayat: ${e instanceof Error ? e.message : "kesalahan tidak dikenal"}`,
    };
  }
}

/** Kode pesanan Aneka TERBARU dari halaman riwayat (baris teratas). */
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
    const m = /ORDER-(\d{4,})-(\d{10})/.exec(html);
    return { ok: true, orderId: m?.[0] ?? "" };
  } catch (e) {
    return {
      ok: false,
      detail: `Gagal membaca riwayat: ${e instanceof Error ? e.message : "kesalahan tidak dikenal"}`,
    };
  }
}
