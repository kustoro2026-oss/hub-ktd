// Klien SMTP Email Marketing KTD Hub — mendukung banyak akun SMTP
// (Gmail, Outlook, SMTP kustom) yang masing-masing punya aturan kirim
// sendiri: ukuran batch, jeda antar batch, jeda antar email, dan batas
// harian. Kredensial dibaca dari tabel email_smtp_accounts sehingga akun
// bisa diganti dari UI tanpa redeploy.
//
// Gmail tidak menyediakan webhook statistik, jadi "dibuka" dilacak lewat
// pixel 1x1 di badan email (lihat /api/email/open/[id]/[token]).
import crypto from "node:crypto";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { EmailSmtpAccount, EmailSmtpAccountInput } from "@/lib/db";

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Normalisasi input form akun SMTP. Password kosong = pertahankan yang
 *  lama (saat mengedit). Nilai aturan kirim dijepit ke rentang aman. */
export function sanitizeSmtpAccountInput(
  raw: Record<string, unknown>,
  current?: EmailSmtpAccount,
): EmailSmtpAccountInput {
  const str = (k: string): string =>
    typeof raw[k] === "string" ? (raw[k] as string).trim() : "";
  const username = str("username");
  // PATCH parsial (misal hanya toggle aktif) tidak boleh menimpa port/secure
  // yang sudah tersimpan — kalau tidak, akun SMTP 587 STARTTLS berubah jadi
  // 465 SSL dan koneksi langsung gagal.
  const portProvided =
    raw.port !== undefined && raw.port !== null && raw.port !== "";
  const port = clampInt(raw.port, 1, 65535, current?.port ?? 465);
  const secureRaw = raw.secure;
  const secureProvided =
    secureRaw !== undefined && secureRaw !== null && secureRaw !== "";
  const secure = secureProvided
    ? secureRaw === true || secureRaw === 1 || secureRaw === "1"
      ? 1
      : 0
    : portProvided
      ? port === 465
        ? 1
        : 0
      : (current?.secure ?? (port === 465 ? 1 : 0));
  const password = str("password") || current?.password || "";
  return {
    name: str("name") || current?.name || username,
    host: str("host") || current?.host || "",
    port,
    secure,
    username: username || current?.username || "",
    password,
    sender_email: str("sender_email") || current?.sender_email || username,
    sender_name: str("sender_name") || current?.sender_name || "KTD Store",
    batch_size: clampInt(raw.batch_size, 1, 1000, current?.batch_size ?? 40),
    batch_pause_seconds: clampInt(
      raw.batch_pause_seconds,
      0,
      86_400,
      current?.batch_pause_seconds ?? 60,
    ),
    delay_ms: clampInt(raw.delay_ms, 0, 60_000, current?.delay_ms ?? 1000),
    daily_limit: clampInt(
      raw.daily_limit,
      0,
      1_000_000,
      current?.daily_limit ?? 500,
    ),
    active:
      raw.active === undefined
        ? (current?.active ?? 1)
        : raw.active === true || raw.active === 1 || raw.active === "1"
          ? 1
          : 0,
  };
}

/** Ganti placeholder {{variabel}} di subject/body dengan nilai. Variabel
 *  yang tidak dikenali dibiarkan apa adanya supaya mudah kelihatan. */
export function fillVars(
  text: string,
  values: Record<string, string>,
): string {
  return text.replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (_m, k: string) => values[k] ?? `{{${k}}}`,
  );
}

/** Token berhenti berlangganan — HMAC alamat email dengan secret aplikasi
 *  (AUTH_SECRET). Dipasang di link footer tiap email sehingga tanpa token
 *  orang lain tidak bisa meng-unsubscribe alamat orang lain. */
export function unsubscribeToken(email: string): string {
  const secret = process.env.AUTH_SECRET || "ktd-email";
  return crypto
    .createHmac("sha256", secret)
    .update(email.trim().toLowerCase())
    .digest("hex")
    .slice(0, 32);
}

export function verifyUnsubscribeToken(email: string, token: string): boolean {
  const a = Buffer.from(unsubscribeToken(email));
  const b = Buffer.from(token ?? "");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Token pixel pelacak "dibuka" — HMAC id item dengan AUTH_SECRET supaya
 *  URL pixel tidak bisa dipalsukan untuk menandai item lain sebagai dibuka. */
export function openPixelToken(itemId: number): string {
  const secret = process.env.AUTH_SECRET || "ktd-email";
  return crypto
    .createHmac("sha256", `${secret}||ktd-email-open`)
    .update(String(itemId))
    .digest("hex")
    .slice(0, 32);
}

export function verifyOpenPixelToken(
  itemId: number,
  token: string,
): boolean {
  const a = Buffer.from(openPixelToken(itemId));
  const b = Buffer.from(token ?? "");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Transport dipakai ulang antar kiriman (koneksi SSL mahal dibuat). Kunci
// cache memuat seluruh konfigurasi akun, jadi begitu akun diubah dari UI
// transport lama otomatis dibuang.
const transporters = new Map<string, Transporter>();

function transportKey(account: EmailSmtpAccount): string {
  return [
    account.id,
    account.host,
    account.port,
    account.secure,
    account.username,
    account.password,
  ].join("|");
}

export function getSmtpTransport(account: EmailSmtpAccount): Transporter {
  const key = transportKey(account);
  let transport = transporters.get(key);
  if (!transport) {
    transport = nodemailer.createTransport({
      host: account.host,
      port: account.port,
      secure: account.secure === 1,
      requireTLS: account.secure !== 1,
      auth: { user: account.username, pass: account.password },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 25_000,
    });
    transporters.set(key, transport);
  }
  return transport;
}

/** Buang koneksi cache satu akun (dipanggil saat akun diubah/dihapus). */
export function clearSmtpTransport(accountId: number): void {
  for (const key of [...transporters.keys()]) {
    if (key.startsWith(`${accountId}|`)) {
      const transport = transporters.get(key);
      transporters.delete(key);
      try {
        transport?.close();
      } catch {
        // abaikan — koneksi memang sedang dibuang
      }
    }
  }
}

/** Galat yang berarti konfigurasi akun salah (bukan salah alamat penerima).
 *  Kampanye dijeda supaya tidak menghabiskan sisa antrean dengan galat sama. */
export function isFatalSmtpError(message: string): boolean {
  const m = (message || "").toLowerCase();
  return (
    m.includes("eauth") ||
    m.includes("invalid login") ||
    m.includes("username and password not accepted") ||
    m.includes("authentication") ||
    m.includes("5.7.8") ||
    m.includes("enotfound") ||
    m.includes("econnection") ||
    m.includes("econnrefused") ||
    m.includes("etls") ||
    m.includes("certificate") ||
    m.includes("tidak punya kata sandi") ||
    m.includes("missing credentials")
  );
}

export type SendEmailResult = {
  ok: boolean;
  messageId?: string;
  error?: string;
  fatal?: boolean;
};

/** Kirim satu email lewat akun SMTP tertentu. `listUnsubscribe` dipasang
 *  sebagai header List-Unsubscribe supaya diperlakukan sebagai kiriman
 *  massal yang patuh (mengurangi risiko masuk spam). */
export async function sendEmailWithAccount(
  account: EmailSmtpAccount,
  opts: {
    to: string;
    name: string;
    subject: string;
    html: string;
    listUnsubscribe?: string;
  },
): Promise<SendEmailResult> {
  if (!account.host || !account.username || !account.password) {
    return {
      ok: false,
      fatal: true,
      error: `Akun SMTP "${account.name || account.id}" belum lengkap — isi host, username, dan password.`,
    };
  }
  const senderEmail = account.sender_email || account.username;
  const senderName = (account.sender_name || "KTD Store").replace(/["\\]/g, "");
  try {
    const info = await getSmtpTransport(account).sendMail({
      from: `"${senderName}" <${senderEmail}>`,
      to: opts.name
        ? `"${opts.name.replace(/["\\]/g, "")}" <${opts.to}>`
        : opts.to,
      // Subject tidak boleh mengandung baris baru (header injection).
      subject: opts.subject.replace(/[\r\n]+/g, " ").slice(0, 300),
      html: opts.html,
      headers: opts.listUnsubscribe
        ? { "List-Unsubscribe": `<${opts.listUnsubscribe}>` }
        : undefined,
    });
    return { ok: true, messageId: info.messageId };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    return { ok: false, error: msg, fatal: isFatalSmtpError(msg) };
  }
}

/** Tes koneksi + login akun SMTP tanpa mengirim email. */
export async function testSmtpAccount(
  account: EmailSmtpAccount,
): Promise<{ ok: boolean; error?: string }> {
  if (!account.host || !account.username || !account.password) {
    return { ok: false, error: "Host, username, dan password wajib diisi." };
  }
  try {
    await getSmtpTransport(account).verify();
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.slice(0, 300) };
  }
}
