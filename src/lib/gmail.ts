// Klien Email Marketing Gmail (SMTP) untuk KTD Hub — kirim email massal
// per penerima lewat smtp.gmail.com (port 465 SSL) dengan App Password.
//
// Kredensial disimpan di tabel email_settings (bisa ganti akun dari UI
// halaman Kampanye Email) dengan fallback env GMAIL_SMTP_USER /
// GMAIL_SMTP_PASS / GMAIL_SENDER_EMAIL.
//
// Batas Gmail pribadi: 500 email/hari — panel kuota di halaman kampanye
// menghitung kiriman dari tabel email_campaign_items. Gmail tidak
// menyediakan webhook statistik, jadi "dibuka" dilacak lewat pixel 1x1
// di badan email (lihat /api/email/open/[id]/[token]).
import crypto from "node:crypto";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { getEmailSettings } from "@/lib/db";

export type GmailEnv = {
  user: string;
  pass: string;
  senderEmail: string;
};

/** Baca kredensial SMTP — prioritas tabel email_settings (ganti akun dari
 *  UI), fallback env GMAIL_* (mis. di Vercel). */
export async function getGmailEnv(): Promise<GmailEnv | null> {
  const s = await getEmailSettings();
  const user = (
    s.gmail_smtp_user ??
    process.env.GMAIL_SMTP_USER ??
    ""
  ).trim();
  const pass = s.gmail_smtp_pass ?? process.env.GMAIL_SMTP_PASS ?? "";
  if (!user || !pass) return null;
  const sender = (
    s.gmail_sender_email ??
    process.env.GMAIL_SENDER_EMAIL ??
    ""
  ).trim();
  return { user, pass, senderEmail: sender || user };
}

// Transport SMTP dipakai ulang antar kiriman (koneksi SSL mahal dibuat).
// Dikunci pada pasangan user+pass — bila akun diganti dari UI, transport
// lama dibuang dan dibuat baru.
let transporter: Transporter | null = null;
let transporterKey = "";

function getTransport(env: GmailEnv): Transporter {
  const key = `${env.user}||${env.pass}`;
  if (!transporter || transporterKey !== key) {
    transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true, // SSL langsung, port 465
      auth: { user: env.user, pass: env.pass },
    });
    transporterKey = key;
  }
  return transporter;
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

export type SendEmailResult = {
  ok: boolean;
  messageId?: string;
  error?: string;
};

/** Kirim satu email lewat SMTP Gmail. `listUnsubscribe` dipasang sebagai
 *  header List-Unsubscribe supaya Gmail memperlakukan email sebagai
 *  kiriman massal yang patuh (mengurangi risiko masuk spam). */
export async function sendEmail(opts: {
  to: string;
  name: string;
  subject: string;
  html: string;
  listUnsubscribe?: string;
}): Promise<SendEmailResult> {
  const env = await getGmailEnv();
  if (!env) {
    return {
      ok: false,
      error: "Akun SMTP Gmail belum diatur — isi di panel Pengaturan SMTP",
    };
  }
  try {
    const info = await getTransport(env).sendMail({
      from: `"KTD Store" <${env.senderEmail}>`,
      to: `"${(opts.name || "").replace(/["\\]/g, "")}" <${opts.to}>`,
      subject: opts.subject,
      html: opts.html,
      headers: opts.listUnsubscribe
        ? { "List-Unsubscribe": `<${opts.listUnsubscribe}>` }
        : undefined,
    });
    return { ok: true, messageId: info.messageId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.slice(0, 300) };
  }
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
