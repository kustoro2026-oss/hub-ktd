// Mesin pengiriman broadcast — dipakai bersama oleh tombol "Kirim sekarang"
// di halaman detail kampanye dan oleh penjadwal (kampanye terjadwal).
//
// Satu panggilan memproses sejumlah penerima terbatas (BROADCAST_BATCH,
// default 40) supaya aman untuk serverless Vercel yang membatasi durasi
// fungsi. Bila penerima belum habis, status broadcast tetap "sending" dan
// panggilan berikutnya melanjutkan. Item yang sedang diproses di-claim
// lebih dulu (status "queued") sehingga dua ronde yang berjalan beriringan
// tidak mengirim pesan yang sama dua kali.
import {
  broadcastProgress,
  claimPendingBroadcastItems,
  getBroadcast,
  listDueScheduledBroadcasts,
  markBroadcastItem,
  requeueStaleQueuedItems,
  setBroadcastStatus,
  setContactWaStatus,
} from "@/lib/db";
import { getTemplateStatus, getWaEnv, sendTemplate, sendTemplateParams } from "@/lib/wa";

const DELAY_MS = 1200; // jeda antar pesan — hormati rate limit Meta
const BATCH_SIZE = Number(process.env.BROADCAST_BATCH ?? 40) || 40;

export type BroadcastRunResult = {
  ok: boolean;
  error?: string;
  sentNow?: number;
  failedNow?: number;
  sent?: number;
  failed?: number;
  pending?: number;
  status?: string;
};

export async function runBroadcast(id: number): Promise<BroadcastRunResult> {
  const broadcast = await getBroadcast(id);
  if (!broadcast) {
    return { ok: false, error: "Broadcast tidak ditemukan" };
  }
  if (!getWaEnv()) {
    return {
      ok: false,
      error: "WA_TOKEN / WA_PHONE_NUMBER_ID belum diatur",
    };
  }
  if (broadcast.status === "done") {
    return { ok: true, sentNow: 0, failedNow: 0, ...(await broadcastProgress(id)) };
  }

  // Template yang belum disetujui Meta pasti gagal — tolak lebih awal
  // supaya tidak membakar limit panggilan API dengan percobaan sia-sia.
  // Kampanye terjadwal yang menemui template belum disetujui dibiarkan
  // tetap "draft" dan dicoba lagi pada tick berikutnya.
  const tplStatus = await getTemplateStatus(broadcast.template);
  if (tplStatus && tplStatus !== "APPROVED") {
    return {
      ok: false,
      error: `Template "${broadcast.template}" masih berstatus ${tplStatus} di Meta — tunggu sampai disetujui sebelum mengirim.`,
    };
  }

  await requeueStaleQueuedItems(broadcast.id);

  const items = await claimPendingBroadcastItems(broadcast.id, BATCH_SIZE);
  if (items.length === 0) {
    await setBroadcastStatus(
      broadcast.id,
      "done",
      broadcast.sent,
      broadcast.failed,
    );
    return {
      ok: true,
      sentNow: 0,
      failedNow: 0,
      ...(await broadcastProgress(broadcast.id)),
    };
  }

  await setBroadcastStatus(
    broadcast.id,
    "sending",
    broadcast.sent,
    broadcast.failed,
  );

  let sentNow = 0;
  let failedNow = 0;
  // Nilai variabel {{1}}, {{2}}… kampanye (mis. link produk) — JSON array
  // di kolom broadcasts.vars, dibuat saat kampanye dibentuk.
  let tplParams: string[] = [];
  try {
    const raw = JSON.parse(broadcast.vars || "[]");
    if (Array.isArray(raw)) tplParams = raw.map(String);
  } catch {
    tplParams = [];
  }
  for (const item of items) {
    const res =
      tplParams.length > 0
        ? await sendTemplateParams(item.phone, broadcast.template, tplParams, broadcast.lang || "id")
        : await sendTemplate(item.phone, broadcast.template);
    if (res.ok) {
      await markBroadcastItem(item.id, "sent", "", res.waId ?? "");
      sentNow++;
    } else {
      await markBroadcastItem(item.id, "failed", res.error ?? "gagal");
      failedNow++;
      // Nomor tidak terdaftar WhatsApp → tandai kontaknya invalid supaya
      // bisa difilter di menu Verifikasi / kiriman berikutnya.
      if (res.notOnWa && item.contact_id != null) {
        await setContactWaStatus(item.contact_id, "invalid");
      }
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  const progress = await broadcastProgress(broadcast.id);
  await setBroadcastStatus(
    broadcast.id,
    progress.pending === 0 ? "done" : "sending",
    progress.sent,
    progress.failed,
  );

  return { ok: true, sentNow, failedNow, ...progress };
}

// Jalankan kampanye terjadwal yang waktunya sudah tiba. Dipanggil dari
// titik-titik ringan — halaman admin dibuka, tab admin yang terbuka
// (tick per menit), webhook pesan masuk, atau cron Vercel — supaya kiriman
// berjalan tepat waktu tanpa ada yang menekan tombol kirim.
export async function runDueScheduledBroadcasts(): Promise<{
  started: number;
  results: { id: number; ok: boolean; error?: string }[];
}> {
  const due = await listDueScheduledBroadcasts();
  const results: { id: number; ok: boolean; error?: string }[] = [];
  for (const bc of due) {
    const res = await runBroadcast(bc.id);
    results.push({ id: bc.id, ok: res.ok, error: res.error });
  }
  return { started: due.length, results };
}
