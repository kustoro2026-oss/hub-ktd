// Webhook statistik Brevo (publik). Brevo mengirim satu event per
// payload: delivered / opened / click / hard_bounce / soft_bounce /
// unsubscribed / complaint. Event dipetakan ke item kampanye lewat tag
// "email-item-<id>" yang disematkan saat kirim; fallback lewat message-id
// Brevo yang tersimpan di kolom brevo_message_id.
//
// Keamanan: Brevo tidak mengirim header signature untuk webhook
// transaksional — secret disematkan di URL webhook
// (https://admin.kustoro2026.com/api/email/webhook?secret=...). Bila
// secret tidak cocok atau env belum diatur, panggilan ditolak.
import { applyEmailEvent, getEmailCampaignItemByMessageId } from "@/lib/db";
import { verifyWebhookSecret } from "@/lib/brevo";

export async function POST(request: Request) {
  const url = new URL(request.url);
  if (!verifyWebhookSecret(url.searchParams.get("secret"))) {
    return Response.json({ ok: false, detail: "Secret salah" }, { status: 401 });
  }

  let body: {
    event?: string;
    email?: string;
    reason?: string;
    detail?: string;
    tags?: string[];
    ["message-id"]?: string;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json(
      { ok: false, detail: "Body tidak valid" },
      { status: 400 },
    );
  }
  const event = (body.event ?? "").trim();
  if (!event) {
    return Response.json({ ok: true, skipped: "tanpa event" });
  }

  // Correlator utama: tag email-item-<id>.
  const tags = Array.isArray(body.tags) ? body.tags : [];
  const itemTag = tags.find((t) => /^email-item-\d+$/.test(t));
  let itemId = itemTag ? Number(itemTag.slice("email-item-".length)) : 0;

  // Fallback: message-id Brevo → kolom brevo_message_id.
  if (!itemId) {
    const mid = (body["message-id"] ?? "").trim();
    if (mid) {
      const item = await getEmailCampaignItemByMessageId(mid);
      if (item) itemId = item.id;
    }
  }
  if (!itemId) {
    // Kiriman di luar KTD Hub (mis. uji dari dashboard Brevo) — abaikan.
    return Response.json({ ok: true, skipped: "item tidak dikenal" });
  }

  const detail = (body.detail ?? body.reason ?? "").slice(0, 300);
  await applyEmailEvent(itemId, event, detail);
  return Response.json({ ok: true, itemId, event });
}
