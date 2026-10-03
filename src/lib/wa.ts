// Klien WhatsApp Cloud API untuk KTD Hub — kirim template broadcast dan
// balasan teks. Kredensial dibaca dari env (WA_TOKEN, WA_PHONE_NUMBER_ID).
const GRAPH_VERSION = "v24.0";

export type WaEnv = { token: string; phoneNumberId: string };

export function getWaEnv(): WaEnv | null {
  const token = process.env.WA_TOKEN;
  const phoneNumberId = process.env.WA_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) return null;
  return { token, phoneNumberId };
}

/** Normalisasi nomor HP Indonesia → format 62xxxxxxxxxxx. */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (digits.startsWith("62") && digits.length >= 10) return digits;
  if (digits.startsWith("0") && digits.length >= 10) return `62${digits.slice(1)}`;
  if (digits.length >= 9) return `62${digits}`;
  return null;
}

/** Awalan + untuk kode negara — dokumen Meta menyarankan selalu menyertakan
 *  tanda plus + kode negara di field `to` agar tidak salah normalisasi. */
function withPlus(to: string): string {
  return to.startsWith("+") ? to : `+${to}`;
}

/** Status template di Meta (APPROVED / PENDING / REJECTED / ...).
 *  Template yang belum APPROVED tidak bisa dipakai kirim. */
export async function getTemplateStatus(name: string): Promise<string | null> {
  const env = getWaEnv();
  const wabaId = process.env.WA_WABA_ID;
  if (!env || !wabaId) return null;
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/message_templates?name=${encodeURIComponent(name)}`,
    { headers: { Authorization: `Bearer ${env.token}` } },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { data?: { status?: string }[] };
  return data.data?.[0]?.status ?? null;
}

/** Kirim pesan template (mis. info_promo_v2) ke satu nomor. */
export async function sendTemplate(
  to: string,
  template = "info_promo_v2",
  language = "id",
): Promise<{ ok: boolean; error?: string; waId?: string }> {
  const env = getWaEnv();
  if (!env) return { ok: false, error: "WA_TOKEN / WA_PHONE_NUMBER_ID belum diatur" };
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${env.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: withPlus(to),
        type: "template",
        template: { name: template, language: { code: language } },
      }),
    },
  );
  if (!res.ok) {
    const err = await res.text();
    return { ok: false, error: `HTTP ${res.status} ${err.slice(0, 300)}` };
  }
  const data = (await res.json()) as { messages?: { id?: string }[] };
  return { ok: true, waId: data.messages?.[0]?.id };
}

/** Kirim pesan teks bebas (hanya sah dalam window 24 jam chat masuk). */
export async function sendText(
  to: string,
  body: string,
): Promise<{ ok: boolean; error?: string; waId?: string }> {
  const env = getWaEnv();
  if (!env) return { ok: false, error: "WA_TOKEN / WA_PHONE_NUMBER_ID belum diatur" };
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${env.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: withPlus(to),
        type: "text",
        text: { body },
      }),
    },
  );
  if (!res.ok) {
    const err = await res.text();
    return { ok: false, error: `HTTP ${res.status} ${err.slice(0, 300)}` };
  }
  const data = (await res.json()) as { messages?: { id?: string }[] };
  return { ok: true, waId: data.messages?.[0]?.id };
}
