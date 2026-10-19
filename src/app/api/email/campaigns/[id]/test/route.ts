// Kirim uji satu email dari template ke alamat pilihan (default: alamat
// pengirim sendiri = GMAIL_SENDER_EMAIL). Tidak menyentuh data kampanye —
// murni cek tampilan subject + isi + variabel sebelum blast.
//
// Dua mode:
//   /api/email/campaigns/0/test + body {templateId,...} — dari form buat
//   kampanye (kampanye belum ada, template dipilih manual).
//   /api/email/campaigns/<id>/test — dari halaman detail: template,
//   subject, dan variabel diambil dari kampanye; body boleh menimpanya.
import { isAuthed } from "@/lib/auth";
import { getEmailCampaign, getEmailTemplate } from "@/lib/db";
import { fillVars, getGmailEnv, sendEmail } from "@/lib/gmail";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  let body: { templateId?: number; subject?: string; email?: string; vars?: Record<string, string> } =
    {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body tidak valid" }, { status: 400 });
  }

  // Mode kampanye: ambil template/subject/vars dari kampanye bila ada.
  const { id } = await params;
  const campaignId = Number(id);
  if (campaignId > 0) {
    const campaign = await getEmailCampaign(campaignId);
    if (!campaign) {
      return Response.json(
        { error: "Kampanye tidak ditemukan" },
        { status: 404 },
      );
    }
    if (!body.templateId) body.templateId = campaign.template_id;
    if (!body.subject) body.subject = campaign.subject;
    if (!body.vars) {
      try {
        const v = JSON.parse(campaign.vars || "{}");
        if (v && typeof v === "object" && !Array.isArray(v)) {
          body.vars = v as Record<string, string>;
        }
      } catch {
        // vars korup — kirim uji tanpa variabel kampanye.
      }
    }
  }

  if (!body.templateId) {
    return Response.json({ error: "templateId wajib diisi" }, { status: 400 });
  }
  const tpl = await getEmailTemplate(body.templateId);
  if (!tpl) {
    return Response.json({ error: "Template tidak ditemukan" }, { status: 400 });
  }
  const env = await getGmailEnv();
  const to = (body.email ?? "").trim() || (env?.senderEmail ?? "");
  if (!to) {
    return Response.json(
      { error: "Akun SMTP Gmail belum diatur — isi alamat email tujuan" },
      { status: 400 },
    );
  }
  const values: Record<string, string> = {};
  if (body.vars && typeof body.vars === "object") {
    for (const [k, v] of Object.entries(body.vars)) {
      if (typeof v === "string") values[k] = v.trim();
    }
  }
  values.nama = values.nama ?? "Pelanggan";
  values.email = values.email ?? to;

  const res = await sendEmail({
    to,
    name: "Uji Kirim",
    subject: fillVars((body.subject ?? tpl.subject).trim() || tpl.subject, values),
    html: fillVars(tpl.html_body, values),
  });
  if (!res.ok) {
    return Response.json({ ok: false, error: res.error }, { status: 409 });
  }
  return Response.json({
    ok: true,
    detail: "Email uji terkirim",
    to,
    messageId: res.messageId ?? "",
  });
}
