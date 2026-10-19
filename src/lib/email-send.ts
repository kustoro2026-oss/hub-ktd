// Mesin pengiriman kampanye email — pola sama dengan broadcast-send.ts.
// Dipakai bersama oleh tombol "Kirim sekarang" di halaman detail kampanye
// dan oleh penjadwal (kampanye terjadwal).
//
// Satu panggilan memproses sejumlah penerima terbatas (EMAIL_BATCH,
// default 40) supaya aman untuk serverless Vercel. Item di-claim atomik
// (status "queued") sehingga dua ronde beriringan tidak mengirim email
// yang sama dua kali. Setiap email ditambahi footer berisi link berhenti
// berlangganan per penerima (token HMAC alamatnya).
import {
  claimPendingEmailItems,
  emailCampaignProgress,
  getEmailCampaign,
  getEmailTemplate,
  listDueScheduledEmailCampaigns,
  markEmailCampaignItem,
  requeueStaleQueuedEmailItems,
  setEmailCampaignStatus,
} from "@/lib/db";
import { fillVars, getBrevoEnv, sendEmail, unsubscribeToken } from "@/lib/brevo";

const DELAY_MS = 1000; // jeda antar email — aman untuk API Brevo
const BATCH_SIZE = Number(process.env.EMAIL_BATCH ?? 40) || 40;

export type EmailRunResult = {
  ok: boolean;
  error?: string;
  sentNow?: number;
  failedNow?: number;
  sent?: number;
  failed?: number;
  pending?: number;
  status?: string;
};

/** URL publik KTD Hub — dipakai di link berhenti berlangganan. */
function publicBase(): string {
  return (
    process.env.EMAIL_PUBLIC_BASE || "https://admin.kustoro2026.com"
  ).replace(/\/+$/, "");
}

/** Footer berhenti berlangganan per penerima (token HMAC alamat email). */
function unsubscribeFooter(email: string): string {
  const token = unsubscribeToken(email);
  const url = `${publicBase()}/api/email/unsubscribe?email=${encodeURIComponent(email)}&token=${token}`;
  return (
    `<div style="margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;">` +
    `Anda menerima email ini karena terdaftar sebagai pelanggan KTD Store. ` +
    `<a href="${url}" style="color:#94a3b8;">Berhenti berlangganan</a></div>`
  );
}

export async function runEmailCampaign(id: number): Promise<EmailRunResult> {
  const campaign = await getEmailCampaign(id);
  if (!campaign) {
    return { ok: false, error: "Kampanye tidak ditemukan" };
  }
  if (!getBrevoEnv()) {
    return {
      ok: false,
      error: "BREVO_API_KEY / BREVO_SENDER_EMAIL belum diatur",
    };
  }
  if (campaign.status === "done") {
    return {
      ok: true,
      sentNow: 0,
      failedNow: 0,
      ...(await emailCampaignProgress(id)),
    };
  }

  const tpl = await getEmailTemplate(campaign.template_id);
  if (!tpl) {
    return { ok: false, error: "Template email tidak ditemukan" };
  }

  await requeueStaleQueuedEmailItems(campaign.id);

  const items = await claimPendingEmailItems(campaign.id, BATCH_SIZE);
  if (items.length === 0) {
    await setEmailCampaignStatus(
      campaign.id,
      "done",
      campaign.sent,
      campaign.failed,
    );
    return {
      ok: true,
      sentNow: 0,
      failedNow: 0,
      ...(await emailCampaignProgress(campaign.id)),
    };
  }

  await setEmailCampaignStatus(
    campaign.id,
    "sending",
    campaign.sent,
    campaign.failed,
  );

  // Nilai variabel kampanye — JSON objek { namaVariabel: nilai }. Variabel
  // khusus {{nama}} dan {{email}} diisi otomatis per penerima.
  let varValues: Record<string, string> = {};
  try {
    const raw = JSON.parse(campaign.vars || "{}");
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      varValues = raw as Record<string, string>;
    }
  } catch {
    varValues = {};
  }

  let sentNow = 0;
  let failedNow = 0;
  for (const item of items) {
    const values = { ...varValues, nama: item.name, email: item.email };
    const subject = fillVars(campaign.subject || tpl.subject, values);
    const html =
      fillVars(tpl.html_body, values) + unsubscribeFooter(item.email);
    const res = await sendEmail({
      to: item.email,
      name: item.name,
      subject,
      html,
      tags: [`ktd-email-${campaign.id}`, `email-item-${item.id}`],
    });
    if (res.ok) {
      await markEmailCampaignItem(item.id, "sent", "", res.messageId ?? "");
      sentNow++;
    } else {
      await markEmailCampaignItem(item.id, "failed", res.error ?? "gagal");
      failedNow++;
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  const progress = await emailCampaignProgress(campaign.id);
  await setEmailCampaignStatus(
    campaign.id,
    progress.pending === 0 ? "done" : "sending",
    progress.sent,
    progress.failed,
  );

  return { ok: true, sentNow, failedNow, ...progress };
}

// Jalankan kampanye email terjadwal yang waktunya sudah tiba. Dipanggil
// dari titik-titik ringan yang sama dengan broadcast WhatsApp: tick tab
// admin, cron Vercel harian.
export async function runDueScheduledEmailCampaigns(): Promise<{
  started: number;
  results: { id: number; ok: boolean; error?: string }[];
}> {
  const due = await listDueScheduledEmailCampaigns();
  const results: { id: number; ok: boolean; error?: string }[] = [];
  for (const c of due) {
    const res = await runEmailCampaign(c.id);
    results.push({ id: c.id, ok: res.ok, error: res.error });
  }
  return { started: due.length, results };
}
