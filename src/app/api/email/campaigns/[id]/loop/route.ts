// Matikan/aktifkan loop harian kampanye email yang sudah dibuat.
// body { repeat_daily: 0 | 1 } — kontrol ini melengkapi tombol jeda:
// jeda hanya menghentikan siklus berjalan, loop harian memulai ulang.
import { isAuthed } from "@/lib/auth";
import { getEmailCampaign, setEmailCampaignRepeatDaily } from "@/lib/db";

export const dynamic = "force-dynamic";

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
  const campaign = await getEmailCampaign(campaignId);
  if (!campaign) {
    return Response.json(
      { error: "Kampanye tidak ditemukan" },
      { status: 404 },
    );
  }

  let body: { repeat_daily?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const value = body.repeat_daily === 1 ? 1 : 0;
  await setEmailCampaignRepeatDaily(campaignId, value);
  return Response.json({ ok: true, repeat_daily: value });
}
