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

// ---------- Kelola template (Business Management API) ----------

export type WaTemplate = {
  id: string;
  name: string;
  status: string;
  category: string;
  language: string;
  rejected_reason?: string;
};

/** Daftar template pesan milik WABA beserta status review-nya. */
export async function listTemplates(): Promise<{
  ok: boolean;
  templates?: WaTemplate[];
  detail?: string;
}> {
  const env = getWaEnv();
  const wabaId = process.env.WA_WABA_ID;
  if (!env || !wabaId)
    return { ok: false, detail: "WA_TOKEN / WA_WABA_ID belum diatur" };
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/message_templates?fields=name,status,category,language,rejected_reason&limit=100`,
    { headers: { Authorization: `Bearer ${env.token}` } },
  );
  if (!res.ok) {
    const err = await res.text();
    return { ok: false, detail: `HTTP ${res.status} ${err.slice(0, 300)}` };
  }
  const data = (await res.json()) as { data?: WaTemplate[] };
  return { ok: true, templates: data.data ?? [] };
}

/** Buat template baru. `example` = contoh nilai variabel {{1}}, {{2}}, ...
 *  — diletakkan DI DALAM komponen BODY (bukan top-level request). */
export async function createTemplate(opts: {
  name: string;
  category: string; // MARKETING | UTILITY
  language?: string;
  body: string;
  example?: string[];
}): Promise<{ ok: boolean; id?: string; detail?: string }> {
  const env = getWaEnv();
  const wabaId = process.env.WA_WABA_ID;
  if (!env || !wabaId)
    return { ok: false, detail: "WA_TOKEN / WA_WABA_ID belum diatur" };
  const components: Record<string, unknown>[] = [
    { type: "BODY", text: opts.body },
  ];
  if (opts.example && opts.example.length > 0) {
    components[0] = { ...components[0], example: { body_text: [opts.example] } };
  }
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/message_templates`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: opts.name,
        category: opts.category,
        language: opts.language ?? "id",
        components,
      }),
    },
  );
  const data = (await res.json().catch(() => ({}))) as {
    id?: string;
    error?: { message?: string };
  };
  if (!res.ok) {
    return { ok: false, detail: data.error?.message ?? `HTTP ${res.status}` };
  }
  return { ok: true, id: data.id };
}

/** Hapus template berdasarkan nama. */
export async function deleteTemplate(
  name: string,
): Promise<{ ok: boolean; detail?: string }> {
  const env = getWaEnv();
  const wabaId = process.env.WA_WABA_ID;
  if (!env || !wabaId)
    return { ok: false, detail: "WA_TOKEN / WA_WABA_ID belum diatur" };
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/message_templates?name=${encodeURIComponent(name)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${env.token}` } },
  );
  if (!res.ok) {
    const err = await res.text();
    return { ok: false, detail: `HTTP ${res.status} ${err.slice(0, 300)}` };
  }
  return { ok: true };
}

/** Ajukan ulang (edit) template yang ditolak — isi baru masuk review lagi. */
export async function editTemplate(
  id: string,
  opts: { body: string; example?: string[] },
): Promise<{ ok: boolean; detail?: string }> {
  const env = getWaEnv();
  if (!env)
    return { ok: false, detail: "WA_TOKEN / WA_PHONE_NUMBER_ID belum diatur" };
  const components: Record<string, unknown>[] = [
    { type: "BODY", text: opts.body },
  ];
  if (opts.example && opts.example.length > 0) {
    components[0] = { ...components[0], example: { body_text: [opts.example] } };
  }
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${id}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ components }),
    },
  );
  const data = (await res.json().catch(() => ({}))) as {
    error?: { message?: string };
  };
  if (!res.ok) {
    return { ok: false, detail: data.error?.message ?? `HTTP ${res.status}` };
  }
  return { ok: true };
}

/** Kirim pesan template (mis. info_promo_v2) ke satu nomor. */
export async function sendTemplate(
  to: string,
  template = "info_promo_v2",
  language = "id",
): Promise<{ ok: boolean; error?: string; waId?: string; notOnWa?: boolean }> {
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
    // 131026 = nomor tujuan bukan nomor WhatsApp; 1013 = kode lama untuk
    // hal yang sama (kirim template ke nomor tanpa akun WhatsApp). Kiriman
    // seperti ini tidak dihitung kuota karena percakapan tidak pernah
    // terbuka — tandai supaya kontak bisa difilter dari kiriman berikutnya.
    const notOnWa = /131026|1013/.test(err);
    return { ok: false, error: `HTTP ${res.status} ${err.slice(0, 300)}`, notOnWa };
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

// ---------- Verifikasi nomor WhatsApp ----------

// Versi Graph yang dicoba untuk cek nomor. Endpoint contacts di versi baru
// bisa menolak dengan "Unsupported post request ... does not support this
// operation", jadi bila versi utama menolak, coba versi lama yang masih
// aktif (Graph mendukung ~2 tahun ke belakang).
const CONTACT_CHECK_VERSIONS = ["v24.0", "v23.0", "v22.0", "v21.0"];

/** Cek apakah satu nomor terdaftar di WhatsApp lewat endpoint contacts
 *  (gratis — tidak memakai kuota pesan, tidak mengirim apa pun ke nomor
 *  itu). Hasil: "valid" (terdaftar), "invalid" (tidak terdaftar), atau
 *  "error" (gagal/tak bisa ditentukan — bisa dicek ulang). */
export async function checkContactWa(
  to: string,
): Promise<{ status: "valid" | "invalid" | "error"; detail?: string }> {
  const env = getWaEnv();
  if (!env)
    return {
      status: "error",
      detail: "WA_TOKEN / WA_PHONE_NUMBER_ID belum diatur",
    };
  let lastDetail = "";
  for (const ver of CONTACT_CHECK_VERSIONS) {
    const res = await fetch(
      `https://graph.facebook.com/${ver}/${env.phoneNumberId}/contacts`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ blocking: "wait", contacts: [withPlus(to)] }),
      },
    );
    if (res.ok) {
      const data = (await res.json()) as {
        contacts?: { input?: string; status?: string; wa_id?: string }[];
      };
      const c = data.contacts?.[0];
      if (!c) return { status: "error", detail: "respons kosong" };
      if (c.status === "valid") return { status: "valid" };
      if (c.status === "invalid") return { status: "invalid" };
      return { status: "error", detail: `status ${c.status ?? "?"}` };
    }
    const err = await res.text();
    lastDetail = `${ver}: HTTP ${res.status} ${err.slice(0, 200)}`;
    // Bila versi ini tidak mendukung endpoint contacts, coba versi berikut.
    if (
      !/does not exist|Unsupported post request|does not support this operation|missing permissions/i.test(
        err,
      )
    ) {
      break;
    }
  }
  return { status: "error", detail: lastDetail };
}

// ---------- Status nama tampilan ----------

export type DisplayNameStatus = {
  ok: boolean;
  verifiedName?: string;
  nameStatus?: string;
  newDisplayName?: string;
  newNameStatus?: string;
  qualityRating?: string;
  messagingLimit?: string;
  detail?: string;
};

/** Baca status nama tampilan nomor API langsung dari Graph. UI WhatsApp
 *  Manager kadang menampilkan nama lama tanpa status review; field
 *  new_display_name/new_name_status memuat pengajuan nama yang sedang
 *  antre (PENDING_REVIEW) sampai disetujui/ditolak. */
export async function getDisplayNameStatus(): Promise<DisplayNameStatus> {
  const env = getWaEnv();
  if (!env)
    return { ok: false, detail: "WA_TOKEN / WA_PHONE_NUMBER_ID belum diatur" };
  const fields = [
    "verified_name",
    "name_status",
    "new_display_name",
    "new_name_status",
    "quality_rating",
    "whatsapp_business_manager_messaging_limit",
  ].join(",");
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${env.phoneNumberId}?fields=${fields}`,
    { headers: { Authorization: `Bearer ${env.token}` } },
  );
  if (!res.ok) {
    const err = await res.text();
    return { ok: false, detail: `HTTP ${res.status} ${err.slice(0, 200)}` };
  }
  const data = (await res.json()) as Record<string, string | undefined>;
  return {
    ok: true,
    verifiedName: data.verified_name,
    nameStatus: data.name_status,
    newDisplayName: data.new_display_name,
    newNameStatus: data.new_name_status,
    qualityRating: data.quality_rating,
    messagingLimit: data.whatsapp_business_manager_messaging_limit,
  };
}

/** Daftarkan ulang nomor API untuk menerapkan nama tampilan baru. Menurut
 *  dokumen Meta, setelah nama baru diproses, nomor harus di-register ulang
 *  dengan PIN verifikasi 2 langkah (6 digit) agar nama baru tampil ke
 *  pelanggan. Bila nomor belum pernah menyetel PIN 2 langkah, pin yang
 *  dikirim menjadi PIN baru. PIN tidak disimpan di server — hanya
 *  diteruskan sekali ke Graph API. */
export async function registerApplyName(
  pin: string,
): Promise<{ ok: boolean; detail?: string }> {
  const env = getWaEnv();
  if (!env)
    return { ok: false, detail: "WA_TOKEN / WA_PHONE_NUMBER_ID belum diatur" };
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${env.phoneNumberId}/register`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", pin }),
    },
  );
  if (!res.ok) {
    const err = await res.text();
    return { ok: false, detail: `HTTP ${res.status} ${err.slice(0, 300)}` };
  }
  return { ok: true };
}

/** Ajukan nama tampilan baru via API (Meta membatasi maks 10 perubahan per
 *  30 hari). Nama masuk antrean verifikasi — pantau lewat new_display_name /
 *  new_name_status, lalu terapkan dengan registerApplyName (PIN). */
export async function updateDisplayName(
  newName: string,
): Promise<{ ok: boolean; detail?: string }> {
  const env = getWaEnv();
  if (!env)
    return { ok: false, detail: "WA_TOKEN / WA_PHONE_NUMBER_ID belum diatur" };
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${env.phoneNumberId}?new_display_name=${encodeURIComponent(newName)}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${env.token}` },
    },
  );
  if (!res.ok) {
    const err = await res.text();
    return { ok: false, detail: `HTTP ${res.status} ${err.slice(0, 300)}` };
  }
  return { ok: true };
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

/** Waktu sekarang dalam WIB (UTC+7), format "DD/MM/YYYY HH.MM WIB". */
export function nowWib(): string {
  const w = new Date(Date.now() + 7 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(w.getUTCDate())}/${p(w.getUTCMonth() + 1)}/${w.getUTCFullYear()} ${p(w.getUTCHours())}.${p(w.getUTCMinutes())} WIB`;
}

/** Susun teks notifikasi pesanan untuk dikirim ke nomor admin. */
export function buildOrderNotification(
  from: string,
  body: string,
  time: string,
): string {
  return `Pesanan baru masuk — KTD Hub
Dari: ${from}
Waktu: ${time}
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
  const time = nowWib();
  const res = await sendText(owner, buildOrderNotification(from, body, time));
  if (res.ok) return "ok";
  // Window 24 jam tidak terbuka — template utility tetap bisa masuk kapan saja.
  const detail = `Dari: ${from}\nWaktu: ${time}\n\n${body}`;
  const tpl = await sendTemplateParams(owner, NOTIF_TEMPLATE, [
    detail.length > 900 ? `${detail.slice(0, 900)}...` : detail,
  ]);
  if (tpl.ok) return "ok (template)";
  return `gagal: ${res.error ?? "teks ditolak"} | template: ${tpl.error ?? "ditolak"}`;
}
