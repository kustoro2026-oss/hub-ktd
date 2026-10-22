// Kirim / lanjutkan / jedakan kampanye email.
//
// Logika pengiriman ada di src/lib/email-send.ts. Satu permintaan =
// satu slice berbatas waktu; klien memanggil berulang sampai
// `shouldContinue` false. Dengan begitu pengguna cukup satu klik untuk
// ratusan email, sementara setiap request tetap aman di serverless.
//
// body { action?: "start" | "pause" } — default "start".
import { isAuthed } from "@/lib/auth";
import {
  getEmailCampaign,
  pauseEmailCampaign,
  resumeEmailCampaign,
} from "@/lib/db";
import { runEmailCampaign } from "@/lib/email-send";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isFinite(campaignId) || campaignId <= 0) {
    return Response.json({ error: "id kampanye tidak valid" }, { status: 400 });
  }

  let body: { action?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  if (body.action === "pause") {
    const campaign = await getEmailCampaign(campaignId);
    if (!campaign) {
      return Response.json(
        { error: "Kampanye tidak ditemukan" },
        { status: 404 },
      );
    }
    await pauseEmailCampaign(campaignId, "manual");
    return Response.json({ ok: true, paused: true, status: "paused" });
  }

  const campaign = await getEmailCampaign(campaignId);
  if (!campaign) {
    return Response.json(
      { error: "Kampanye tidak ditemukan" },
      { status: 404 },
    );
  }

  // "start" eksplisit: lepaskan jeda manual/fatal dan status draft.
  if (body.action === "start" && campaign.status !== "done") {
    await resumeEmailCampaign(campaignId);
  }

  const res = await runEmailCampaign(campaignId);
  // Galat pengiriman (mis. akun SMTP salah) dikembalikan sebagai data,
  // bukan HTTP error — klien butuh progres + alasan untuk ditampilkan.
  return Response.json(res);
}
