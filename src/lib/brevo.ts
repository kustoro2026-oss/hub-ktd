// Klien Email Marketing Brevo (API v3) untuk KTD Hub — kirim email
// transaksional per penerima (dasar kampanye massal) dan verifikasi
// webhook statistik. Kredensial dibaca dari env: BREVO_API_KEY,
// BREVO_SENDER_EMAIL, BREVO_WEBHOOK_SECRET.
//
// Batas akun gratis Brevo: 300 email/hari — panel kuota di halaman
// kampanye menghitung kiriman dari tabel email_campaign_items.
import crypto from "node:crypto";

const BREVO_API = "https://api.brevo.com/v3";

export type BrevoEnv = { apiKey: string; senderEmail: string };

export function getBrevoEnv(): BrevoEnv | null {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  if (!apiKey || !senderEmail) return null;
  return { apiKey, senderEmail };
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

/** Kirim satu email lewat endpoint transaksional Brevo. `tags` memuat
 *  penanda kampanye + item supaya webhook statistik bisa memetakan event
 *  kembali ke penerima yang tepat. */
export async function sendEmail(opts: {
  to: string;
  name: string;
  subject: string;
  html: string;
  tags: string[];
}): Promise<SendEmailResult> {
  const env = getBrevoEnv();
  if (!env) {
    return {
      ok: false,
      error: "BREVO_API_KEY / BREVO_SENDER_EMAIL belum diatur",
    };
  }
  let res: Response;
  try {
    res = await fetch(`${BREVO_API}/smtp/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": env.apiKey,
        accept: "application/json",
      },
      body: JSON.stringify({
        sender: { name: "KTD Store", email: env.senderEmail },
        to: [{ email: opts.to, name: opts.name || undefined }],
        subject: opts.subject,
        htmlContent: opts.html,
        tags: opts.tags,
      }),
    });
  } catch {
    return { ok: false, error: "Tidak dapat terhubung ke API Brevo" };
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const d = (await res.json()) as { message?: string };
      detail = d.message ?? JSON.stringify(d).slice(0, 300);
    } catch {
      // Body bukan JSON — pakai kode status saja.
    }
    return { ok: false, error: detail };
  }
  const data = (await res.json().catch(() => ({}))) as {
    messageId?: string;
  };
  return { ok: true, messageId: data.messageId };
}

/** Token berhenti berlangganan — HMAC alamat email dengan secret aplikasi
 *  (AUTH_SECRET atau BREVO_WEBHOOK_SECRET). Dipasang di link footer tiap
 *  email sehingga tanpa token orang lain tidak bisa meng-unsubscribe
 *  alamat orang lain. */
export function unsubscribeToken(email: string): string {
  const secret =
    process.env.AUTH_SECRET || process.env.BREVO_WEBHOOK_SECRET || "ktd-email";
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

/** Verifikasi secret webhook Brevo. Brevo tidak mengirim header signature
 *  untuk webhook transaksional — secret disematkan di URL webhook
 *  (https://admin.kustoro2026.com/api/email/webhook?secret=...). Bila env
 *  belum diatur, tolak semua panggilan (fail-closed). */
export function verifyWebhookSecret(given: string | null): boolean {
  const secret = process.env.BREVO_WEBHOOK_SECRET;
  if (!secret || !given) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(given);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
