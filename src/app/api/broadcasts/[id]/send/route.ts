// Kirim broadcast (lanjutkan bila masih ada yang pending).
//
// Satu permintaan memproses sejumlah penerima terbatas (default 40, atur via
// env BROADCAST_BATCH) — aman untuk serverless Vercel yang membatasi durasi
// fungsi. Bila penerima belum habis, status broadcast tetap "sending" dan
// halaman detail menyediakan tombol lanjut.
import { isAuthed } from "@/lib/auth";
import {
  broadcastProgress,
  getBroadcast,
  markBroadcastItem,
  pendingBroadcastItems,
  setBroadcastStatus,
} from "@/lib/db";
import { getTemplateStatus, getWaEnv, sendTemplate } from "@/lib/wa";

const DELAY_MS = 1200; // jeda antar pesan — hormati rate limit Meta
const BATCH_SIZE = Number(process.env.BROADCAST_BATCH ?? 40) || 40;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const { id } = await params;
  const broadcast = getBroadcast(Number(id));
  if (!broadcast) {
    return Response.json({ error: "Broadcast tidak ditemukan" }, { status: 404 });
  }
  if (!getWaEnv()) {
    return Response.json(
      { error: "WA_TOKEN / WA_PHONE_NUMBER_ID belum diatur" },
      { status: 500 },
    );
  }

  // Template yang belum disetujui Meta pasti gagal — tolak lebih awal
  // supaya tidak membakar limit panggilan API dengan percobaan sia-sia.
  const tplStatus = await getTemplateStatus(broadcast.template);
  if (tplStatus && tplStatus !== "APPROVED") {
    return Response.json(
      {
        ok: false,
        error: `Template "${broadcast.template}" masih berstatus ${tplStatus} di Meta — tunggu sampai disetujui sebelum mengirim.`,
      },
      { status: 409 },
    );
  }

  const items = pendingBroadcastItems(broadcast.id, BATCH_SIZE);
  if (items.length === 0) {
    setBroadcastStatus(broadcast.id, "done", broadcast.sent, broadcast.failed);
    return Response.json({ ok: true, sentNow: 0, ...broadcastProgress(broadcast.id) });
  }

  setBroadcastStatus(broadcast.id, "sending", broadcast.sent, broadcast.failed);

  let sentNow = 0;
  let failedNow = 0;
  for (const item of items) {
    const res = await sendTemplate(item.phone, broadcast.template);
    if (res.ok) {
      markBroadcastItem(item.id, "sent");
      sentNow++;
    } else {
      markBroadcastItem(item.id, "failed", res.error ?? "gagal");
      failedNow++;
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  const progress = broadcastProgress(broadcast.id);
  setBroadcastStatus(
    broadcast.id,
    progress.pending === 0 ? "done" : "sending",
    progress.sent,
    progress.failed,
  );

  return Response.json({
    ok: true,
    sentNow,
    failedNow,
    ...progress,
  });
}
