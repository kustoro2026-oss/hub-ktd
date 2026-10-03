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

// ---------- Notifikasi pesanan ke admin toko ----------

/** Template utility notifikasi pesanan (bebas window 24 jam) — dibuat
 *  melalui WhatsApp Manager / API dan menunggu persetujuan Meta. */
const NOTIF_TEMPLATE = "order_alert_ktd2";

/** Nomor admin penerima notifikasi pesanan baru — default nomor CS toko
 *  085171157938; bisa diganti lewat env OWNER_WA_NUMBER (format 62...). */
export function ownerNumber(): string | null {
  return normalizePhone(process.env.OWNER_WA_NUMBER ?? "6285171157938");
}

/** Susun teks notifikasi pesanan untuk dikirim ke nomor admin. */
export function buildOrderNotification(from: string, body: string): string {
  return `Pesanan baru masuk — KTD Hub
Dari: ${from}
Lihat & balas: https://admin.kustoro2026.com/pesan/${from}

${body}`;
}

/** Kirim pesan template dengan parameter teks (untuk body berisi {{1}} dst). */
export async function sendTemplateParams(
  to: string,
  template: string,
  params: string[],
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
        template: {
          name: template,
          language: { code: language },
          components: [
            {
              type: "body",
              parameters: params.map((p) => ({ type: "text", text: p })),
            },
          ],
        },
      }),
    },
  );
  if (!res.ok) {
    const err = await res.text();
    return { ok: false, error: `HTTP ${res.status} ${err.slice(0, 200)}` };
  }
  const data = (await res.json()) as { messages?: { id?: string }[] };
  return { ok: true, waId: data.messages?.[0]?.id };
}

/** Teruskan pesan berisi data pesanan pelanggan ke nomor admin toko.
 *  Jalur: teks bebas dulu (membawa tautan Hub, sah 24 jam setelah admin
 *  chat ke bot); bila ditolak Meta, coba template utility (bebas window).
 *  Hasil: "skip" bila pengirim adalah nomor admin sendiri, "ok" / "ok
 *  (template)" bila terkirim, atau "gagal: ..." bila kedua jalur ditolak. */
export async function notifyOrderOwner(
  from: string,
  body: string,
): Promise<string> {
  const owner = ownerNumber();
  if (!owner) return "";
  if (owner === normalizePhone(from)) return "skip"; // pengirim = nomor admin sendiri
  const res = await sendText(owner, buildOrderNotification(from, body));
  if (res.ok) return "ok";
  // Window 24 jam tidak terbuka — template utility tetap bisa masuk kapan saja.
  const detail = `Dari: ${from}\n\n${body}`;
  const tpl = await sendTemplateParams(owner, NOTIF_TEMPLATE, [
    detail.length > 900 ? `${detail.slice(0, 900)}...` : detail,
  ]);
  if (tpl.ok) return "ok (template)";
  return `gagal: ${res.error ?? "teks ditolak"} | template: ${tpl.error ?? "ditolak"}`;
}
