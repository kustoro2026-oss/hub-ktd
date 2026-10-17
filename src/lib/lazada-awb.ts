// Jembatan browser — cetak AWB RESMI Lazada lewat halaman Seller Center
// yang login, tanpa unggah manual.
//
// Latar belakang (17 Okt 2026): AWB pesanan kurir terintegrasi (LEX) tidak
// pernah tersedia lewat Open Platform, dan panggilan mtop dari server
// SELALU ditolak FAIL_SYS_SESSION_EXPIRED — sesi web Seller Center terikat
// sidik-jari browser (risk-control Alibaba). Satu-satunya cara resmi yang
// terbukti: memanggil mtop.lazada.seller.order.package.print dari DALAM
// halaman Seller Center yang sedang login (window.lib.mtop).
//
// Karena itu Hub tidak mencetak langsung — Hub hanya:
//   1. mengantrekan pekerjaan (tabel lazada_awb_jobs), dan
//   2. menerima PDF hasil dari engine kecil yang berjalan di dalam browser
//      login (skrip injeksi window.__lzdBridge) via route /api/lazada/awb.
// Engine memilih pekerjaan pending, mencetak, lalu mengirim PDF base64;
// hasilnya dicache ke payload baris eksekusi (label_pdf_base64) sehingga
// tombol Cetak Resi / Kirim Resi menyajikan dokumen resmi yang sama seperti
// unggahan pemilik.
import {
  completeLazadaAwbJob,
  enqueueLazadaAwbJob,
  failLazadaAwbJob,
  getLazadaAwbJob,
  getLazadaBridgeState,
  getLazadaOrderExec,
  listLazadaAwbJobsPending,
  touchLazadaBridge,
  updateLazadaOrderExecPayload,
} from "@/lib/db";

/** Batas percobaan cetak per pesanan — lewat batas ini pekerjaan berhenti
 *  diantrekan ulang otomatis (tetap bisa dipicu manual dari UI). */
const MAX_AWB_ATTEMPTS = 5;

/** Daftar pekerjaan menunggu untuk engine browser — item ids dalam bentuk
 *  array string (engine butuh order_item_ids asli). */
export async function awbPendingJobs(): Promise<
  { order_id: string; order_item_ids: string[] }[]
> {
  const jobs = await listLazadaAwbJobsPending();
  return jobs.map((j) => {
    let ids: string[] = [];
    try {
      ids = JSON.parse(j.order_item_ids) as string[];
    } catch {
      ids = [];
    }
    return { order_id: j.order_id, order_item_ids: ids };
  });
}

/** Antrekan cetak AWB satu pesanan (idempoten). Kembalikan keterangan untuk
 *  ditampilkan ke admin. */
export async function awbEnqueue(
  orderId: string,
  orderItemIds: string[],
): Promise<{ ok: boolean; detail: string }> {
  const ada = await getLazadaAwbJob(orderId);
  if (ada && ada.status === "done" && ada.pdf_base64) {
    return { ok: true, detail: "AWB resmi sudah dicetak" };
  }
  if (ada && ada.status === "pending") {
    return { ok: true, detail: "sudah antre menunggu browser" };
  }
  if (ada && ada.status === "gagal" && ada.attempts >= MAX_AWB_ATTEMPTS) {
    return {
      ok: false,
      detail: `sudah gagal ${ada.attempts}x: ${ada.error}`,
    };
  }
  await enqueueLazadaAwbJob(orderId, orderItemIds, (ada?.attempts ?? 0) + 1);
  return { ok: true, detail: "diantrekan — browser Seller Center akan mencetak" };
}

/** Terima hasil cetak dari engine browser: PDF base64 (sukses) atau error
 *  (gagal). PDF divalidasi penanda %PDF- lalu dicache ke payload baris
 *  eksekusi — jalur yang sama dengan label unggahan. */
export async function awbSubmitResult(
  orderId: string,
  hasil: { pdf_base64?: string; error?: string },
): Promise<{ ok: boolean; detail: string }> {
  const pdfB64 = (hasil.pdf_base64 ?? "").trim();
  if (pdfB64) {
    const dec = Buffer.from(pdfB64, "base64");
    if (dec.length < 5 || dec.subarray(0, 5).toString("latin1") !== "%PDF-") {
      return { ok: false, detail: "hasil bukan PDF valid" };
    }
    await completeLazadaAwbJob(orderId, pdfB64);
    // Cache ke payload baris eksekusi (bila ada) supaya Cetak Resi / Kirim
    // Resi langsung menyajikan AWB resmi tanpa panggilan tambahan.
    const row = await getLazadaOrderExec(orderId);
    if (row) {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(row.payload) as Record<string, unknown>;
      } catch {
        payload = {};
      }
      payload.label_pdf_base64 = pdfB64;
      await updateLazadaOrderExecPayload(orderId, JSON.stringify(payload));
    }
    return { ok: true, detail: "AWB tersimpan" };
  }
  await failLazadaAwbJob(orderId, hasil.error ?? "tanpa keterangan");
  return { ok: false, detail: hasil.error ?? "gagal tanpa keterangan" };
}

/** PDF AWB tersimpan untuk pesanan ini (dari pekerjaan done) — null bila
 *  belum pernah dicetak lewat jembatan. Dipakai getLazadaResiPdf sebagai
 *  prioritas setelah label unggahan. */
export async function awbCachedPdf(orderId: string): Promise<Buffer | null> {
  const job = await getLazadaAwbJob(orderId);
  if (!job || job.status !== "done" || !job.pdf_base64) return null;
  const dec = Buffer.from(job.pdf_base64, "base64");
  if (dec.length < 5 || dec.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return null;
  }
  return dec;
}

/** Status pekerjaan + detak engine untuk halaman Pesanan. */
export async function awbStatus(orderId: string): Promise<{
  job: {
    status: string;
    attempts: number;
    error: string;
    updated_at: string;
  } | null;
  bridge: { online: boolean; heartbeat_at: string; status: string };
  ada_label: boolean;
}> {
  const job = await getLazadaAwbJob(orderId);
  const bridge = await getLazadaBridgeState();
  let adaLabel = false;
  if (job && job.status === "done" && job.pdf_base64) {
    adaLabel = true;
  } else {
    const row = await getLazadaOrderExec(orderId);
    if (row) {
      try {
        const pl = JSON.parse(row.payload) as { label_pdf_base64?: string };
        adaLabel = !!(pl.label_pdf_base64 ?? "").trim();
      } catch {
        adaLabel = false;
      }
    }
  }
  return {
    job: job
      ? {
          status: job.status,
          attempts: job.attempts,
          error: job.error,
          updated_at: job.updated_at,
        }
      : null,
    bridge: {
      online: !!bridge && Date.now() - parseUtcMs(bridge.heartbeat_at) < 10 * 60 * 1000,
      heartbeat_at: bridge?.heartbeat_at ?? "",
      status: bridge?.status ?? "",
    },
    ada_label: adaLabel,
  };
}

/** UTC "YYYY-MM-DD HH:MM:SS" → epoch ms. */
function parseUtcMs(s: string): number {
  const t = Date.parse(s.replace(" ", "T") + "Z");
  return Number.isFinite(t) ? t : 0;
}

/** Sentuh detak engine jembatan (kapan terakhir browser online). */
export async function awbBridgeHeartbeat(status: string): Promise<void> {
  await touchLazadaBridge(status);
}
