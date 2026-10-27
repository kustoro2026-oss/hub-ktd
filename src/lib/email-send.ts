// Mesin pengiriman kampanye email KTD Hub.
//
// Satu panggilan = satu "slice" kerja berbatas waktu (default 12 detik)
// supaya aman di serverless. Klien (tombol kirim / tick admin) memanggil
// berulang sampai kampanye selesai, sehingga pengguna cukup satu klik
// untuk mengirim ratusan email.
//
// Aturan kirim mengikuti akun SMTP yang dipakai kampanye:
// - batch_size: jumlah email per batch, setelah itu jeda
// - batch_pause_seconds: lama jeda antar batch
// - delay_ms: jeda antar email
// - daily_limit: batas kiriman sukses per hari per akun (0 = tanpa batas)
//
// Item di-claim atomik (status "queued") sehingga dua ronde beriringan
// tidak mengirim email yang sama dua kali. Item yang tidak sempat diproses
// dikembalikan ke "pending" pada ronde yang sama — tidak ada email hilang.
import {
  claimPendingEmailItems,
  countEmailsSentTodayByAccount,
  emailCampaignProgress,
  getEmailCampaign,
  getEmailSmtpAccount,
  getEmailTemplate,
  listDueScheduledEmailCampaigns,
  markEmailCampaignItem,
  requeueEmailItems,
  requeueStaleQueuedEmailItems,
  resetEmailCampaignForLoop,
  resetEmailContactBounceStrikes,
  updateEmailCampaignRun,
  updateEmailCampaignRunIfActive,
  workerHeartbeatFresh,
  type EmailCampaign,
} from "@/lib/db";
import {
  fillVars,
  isDailyQuotaSmtpError,
  openPixelToken,
  sendEmailWithAccount,
  unsubscribeToken,
} from "@/lib/email-smtp";

const DEFAULT_BUDGET_MS = 12_000;
const CLAIM_CHUNK = 10;
/** Sisa waktu minimum untuk mulai mengirim satu email lagi. */
const MIN_SEND_WINDOW_MS = 1_500;

function timeBudgetMs(): number {
  const raw = Number(process.env.EMAIL_RUN_BUDGET_MS ?? DEFAULT_BUDGET_MS);
  return Number.isFinite(raw) && raw >= 3_000 ? raw : DEFAULT_BUDGET_MS;
}

function utcStamp(at: Date = new Date()): string {
  return at.toISOString().slice(0, 19).replace("T", " ");
}

/** Parsing "YYYY-MM-DD HH:MM:SS" (UTC) → epoch ms; NaN bila format salah. */
function parseUtcStamp(s: string): number {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return NaN;
  const [, y, mo, d, h, mi, se] = m;
  return Date.UTC(+y, +mo - 1, +d, +h, +mi, +se);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/** Tengah malam WIB berikutnya (UTC+7, tanpa DST). Kuota harian akun
 *  direset 00:00 WIB — bukan tengah malam waktu server (Vercel = UTC). */
function nextMidnight(): Date {
  const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
  const nowWib = Date.now() + WIB_OFFSET_MS;
  const startOfDayWib = Math.floor(nowWib / 86_400_000) * 86_400_000;
  return new Date(startOfDayWib + 86_400_000 - WIB_OFFSET_MS);
}

/** Kemunculan berikutnya dari jam WIB tertentu (mis. 08:00 WIB) sebagai
 *  stempel waktu UTC — titik mulai siklus baru kampanye loop harian. */
function nextRepeatStartUtc(hourWib: number): Date {
  const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
  const h = Math.min(23, Math.max(0, Math.floor(Number(hourWib) || 0)));
  const nowWib = Date.now() + WIB_OFFSET_MS;
  const startOfDayWib = Math.floor(nowWib / 86_400_000) * 86_400_000;
  let candidate = startOfDayWib + h * 3_600_000;
  if (candidate <= nowWib) candidate += 86_400_000;
  return new Date(candidate - WIB_OFFSET_MS);
}

/** Label WIB "HH:MM" untuk tanggal UTC tertentu — dipakai pesan notis. */
function wibClock(at: Date): string {
  const wib = new Date(at.getTime() + 7 * 60 * 60 * 1000);
  return `${String(wib.getUTCHours()).padStart(2, "0")}:${String(
    wib.getUTCMinutes(),
  ).padStart(2, "0")}`;
}

/** Jam mulai siklus kampanye loop — kolom wajib terisi (default 8 = 08:00
 *  WIB); pemakaian `|| 8` salah karena jam 0 (tengah malam) sah. */
function repeatStartHourOf(campaign: EmailCampaign): number {
  const n = Number(campaign.repeat_start_hour);
  return Number.isFinite(n) ? Math.min(23, Math.max(0, Math.floor(n))) : 8;
}

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

/** Pixel 1x1 pelacak "dibuka" per item — token HMAC id item, dihitung
 *  di route /api/email/open/[id]/[token]. */
function openPixel(itemId: number): string {
  const token = openPixelToken(itemId);
  const url = `${publicBase()}/api/email/open/${itemId}/${token}`;
  return (
    `<img src="${url}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;" />`
  );
}

export type EmailRunResult = {
  ok: boolean;
  error?: string;
  notice?: string;
  total: number;
  sent: number;
  failed: number;
  pending: number;
  queued: number;
  remaining: number;
  sentNow: number;
  failedNow: number;
  status: EmailCampaign["status"];
  pauseReason: string;
  /** true = klien boleh memanggil ronde berikutnya (setelah waitSeconds). */
  shouldContinue: boolean;
  waitSeconds: number;
  batchSent: number;
  smtpAccount: { id: number; name: string; batchSize: number } | null;
};

function emptyProgress() {
  return { total: 0, sent: 0, failed: 0, pending: 0, queued: 0, remaining: 0 };
}

/** Susun hasil ronde dari kondisi kampanye terkini. */
async function buildResult(
  campaignId: number,
  extra: Partial<EmailRunResult> = {},
): Promise<EmailRunResult> {
  const [campaign, progress] = await Promise.all([
    getEmailCampaign(campaignId),
    emailCampaignProgress(campaignId),
  ]);
  const status = campaign?.status ?? "done";
  const pauseReason = campaign?.pause_reason ?? "";
  const done = status === "done" || progress.remaining === 0;
  return {
    ok: true,
    ...emptyProgress(),
    sentNow: 0,
    failedNow: 0,
    status,
    pauseReason,
    shouldContinue:
      !done && pauseReason !== "manual" && pauseReason !== "fatal",
    waitSeconds: 0,
    batchSent: Number(campaign?.batch_sent ?? 0),
    smtpAccount: null,
    ...progress,
    ...extra,
  };
}

export async function runEmailCampaign(id: number): Promise<EmailRunResult> {
  const campaign = await getEmailCampaign(id);
  if (!campaign) {
    return {
      ok: false,
      error: "Kampanye tidak ditemukan",
      ...emptyProgress(),
      sentNow: 0,
      failedNow: 0,
      status: "done",
      pauseReason: "",
      shouldContinue: false,
      waitSeconds: 0,
      batchSent: 0,
      smtpAccount: null,
    };
  }

  const initial = await emailCampaignProgress(id);
  if (campaign.status === "done" || (initial.total > 0 && initial.remaining === 0)) {
    // Kampanye loop harian: siklus selesai → siapkan putaran berikutnya.
    if (campaign.repeat_daily === 1 && initial.total > 0) {
      const newTotal = await resetEmailCampaignForLoop(
        id,
        campaign.group_id,
        campaign.smtp_account_id,
      );
      const resumeAt = nextRepeatStartUtc(repeatStartHourOf(campaign));
      const scheduled = await updateEmailCampaignRunIfActive(id, {
        status: "paused",
        pause_reason: "cooldown",
        next_run_at: utcStamp(resumeAt),
        batch_sent: 0,
        total: newTotal,
        sent: 0,
        failed: initial.failed,
      });
      if (!scheduled) return buildResult(id);
      return buildResult(id, {
        notice: `Siklus selesai — putaran berikutnya dimulai otomatis pukul ${wibClock(resumeAt)} WIB.`,
        waitSeconds: Math.max(
          60,
          Math.ceil((resumeAt.getTime() - Date.now()) / 1000),
        ),
        shouldContinue: false,
      });
    }
    if (campaign.status !== "done") {
      await updateEmailCampaignRun(id, {
        status: "done",
        pause_reason: "",
        next_run_at: "",
        sent: initial.sent,
        failed: initial.failed,
      });
    }
    return buildResult(id);
  }

  // Jeda manual / galat fatal: hanya berjalan bila pengguna menekan
  // Lanjutkan (route akan mengubah status lebih dulu).
  if (campaign.status === "paused" && campaign.pause_reason !== "cooldown") {
    return buildResult(id, {
      notice:
        campaign.pause_reason === "manual"
          ? "Kampanye sedang dijeda. Klik Lanjutkan untuk meneruskan."
          : campaign.pause_reason === "fatal"
            ? "Kampanye dijeda karena galat SMTP. Periksa akun SMTP lalu lanjutkan."
            : undefined,
      shouldContinue: false,
    });
  }

  // Cooldown dengan jadwal di masa depan (loop harian / kuota / jeda batch):
  // jangan kirim sebelum next_run_at walau dipanggil langsung dari klien.
  if (
    campaign.status === "paused" &&
    campaign.pause_reason === "cooldown" &&
    campaign.next_run_at !== ""
  ) {
    const dueMs = parseUtcStamp(campaign.next_run_at);
    if (Number.isFinite(dueMs) && dueMs > Date.now()) {
      return buildResult(id, {
        notice: `Pengiriman dilanjutkan otomatis pukul ${wibClock(new Date(dueMs))} WIB.`,
        shouldContinue: false,
        waitSeconds: Math.min(
          1800,
          Math.max(60, Math.ceil((dueMs - Date.now()) / 1000)),
        ),
      });
    }
  }

  const account = campaign.smtp_account_id
    ? await getEmailSmtpAccount(campaign.smtp_account_id)
    : undefined;
  if (!account) {
    const notice =
      "Akun SMTP kampanye tidak ditemukan. Pilih akun SMTP di kampanye baru.";
    await updateEmailCampaignRun(id, {
      status: "paused",
      pause_reason: "fatal",
      next_run_at: "",
      sent: initial.sent,
      failed: initial.failed,
    });
    return buildResult(id, { ok: false, error: notice, notice });
  }
  if (account.active !== 1) {
    const notice = `Akun SMTP "${account.name}" sedang dinonaktifkan.`;
    await updateEmailCampaignRun(id, {
      status: "paused",
      pause_reason: "fatal",
      next_run_at: "",
      sent: initial.sent,
      failed: initial.failed,
    });
    return buildResult(id, { ok: false, error: notice, notice });
  }

  const tpl = await getEmailTemplate(campaign.template_id);
  if (!tpl) {
    await updateEmailCampaignRun(id, {
      status: "paused",
      pause_reason: "fatal",
      next_run_at: "",
      sent: initial.sent,
      failed: initial.failed,
    });
    return buildResult(id, {
      ok: false,
      error: "Template email tidak ditemukan",
      notice: "Template email kampanye tidak ditemukan.",
      smtpAccount: {
        id: account.id,
        name: account.name,
        batchSize: account.batch_size,
      },
    });
  }

  await requeueStaleQueuedEmailItems(campaign.id, 2);

  const batchSize = Math.max(1, account.batch_size);
  const batchPause = Math.max(0, account.batch_pause_seconds);
  const delayMs = Math.max(0, account.delay_ms);
  let batchSent = Math.max(0, Number(campaign.batch_sent) || 0);
  if (batchSent >= batchSize) batchSent = 0;

  // Kuota harian per akun — dihitung dari waktu kirim sebenarnya.
  const sentToday = await countEmailsSentTodayByAccount(account.id);
  let dailyLeft =
    account.daily_limit > 0
      ? Math.max(0, account.daily_limit - sentToday)
      : Number.POSITIVE_INFINITY;

  const smtpInfo = {
    id: account.id,
    name: account.name,
    batchSize,
  };

  if (dailyLeft === 0) {
    const resumeAt = nextMidnight();
    const waitSeconds = Math.max(
      60,
      Math.ceil((resumeAt.getTime() - Date.now()) / 1000),
    );
    const scheduled = await updateEmailCampaignRunIfActive(id, {
      status: "paused",
      pause_reason: "cooldown",
      next_run_at: utcStamp(resumeAt),
      batch_sent: 0,
      sent: initial.sent,
      failed: initial.failed,
    });
    if (!scheduled) return buildResult(id, { smtpAccount: smtpInfo });
    return buildResult(id, {
      notice: `Batas harian akun "${account.name}" (${account.daily_limit} email) sudah tercapai. Pengiriman lanjut otomatis pukul 00:00 WIB.`,
      waitSeconds,
      smtpAccount: smtpInfo,
    });
  }

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

  const startedAt = campaign.started_at || utcStamp();
  await updateEmailCampaignRun(id, {
    status: "sending",
    pause_reason: "",
    next_run_at: "",
    started_at: startedAt,
    batch_sent: batchSent,
  });

  const deadline = Date.now() + timeBudgetMs();
  let sentNow = 0;
  let failedNow = 0;
  let fatalError = "";
  let providerQuota = false;
  let stop: "empty" | "budget" | "batch" | "daily" | "fatal" = "empty";

  outer: while (true) {
    if (batchSent >= batchSize) {
      if (batchPause > 0) {
        stop = "batch";
        break;
      }
      batchSent = 0;
    }
    if (dailyLeft <= 0) {
      stop = "daily";
      break;
    }
    if (Date.now() >= deadline - MIN_SEND_WINDOW_MS) {
      stop = "budget";
      break;
    }

    const take = Math.min(
      CLAIM_CHUNK,
      batchSize - batchSent,
      Number.isFinite(dailyLeft) ? dailyLeft : CLAIM_CHUNK,
    );
    const items = await claimPendingEmailItems(id, Math.max(1, take));
    if (items.length === 0) {
      stop = "empty";
      break;
    }

    for (let idx = 0; idx < items.length; idx++) {
      if (Date.now() >= deadline - MIN_SEND_WINDOW_MS) {
        await requeueEmailItems(items.slice(idx).map((it) => it.id));
        stop = "budget";
        break outer;
      }

      const item = items[idx];
      const values = { ...varValues, nama: item.name, email: item.email };
      const subject = fillVars(campaign.subject || tpl.subject, values);
      const html =
        fillVars(tpl.html_body, values) +
        unsubscribeFooter(item.email) +
        openPixel(item.id);
      const unsubUrl = `${publicBase()}/api/email/unsubscribe?email=${encodeURIComponent(item.email)}&token=${unsubscribeToken(item.email)}`;

      const res = await sendEmailWithAccount(account, {
        to: item.email,
        name: item.name,
        subject,
        html,
        listUnsubscribe: unsubUrl,
      });

      if (res.ok) {
        await markEmailCampaignItem(item.id, "sent", "", res.messageId ?? "");
        // Kiriman sukses membuktikan alamat hidup — soft-bounce yang
        // pernah tercatat (NDR "Delivery incomplete") direset.
        if (item.contact_id) {
          await resetEmailContactBounceStrikes(item.contact_id);
        }
        sentNow++;
        batchSent++;
        if (Number.isFinite(dailyLeft)) dailyLeft--;
      } else if (isDailyQuotaSmtpError(res.error ?? "")) {
        // Kuota harian penyedia habis — bukan salah alamat. Jangan tandai
        // gagal permanen; kembalikan item ini + sisanya ke antrean dan jeda
        // sampai kuota reset (00:00 WIB), supaya antrean tidak dibuang.
        await requeueEmailItems(items.slice(idx).map((it) => it.id));
        providerQuota = true;
        stop = "daily";
        break outer;
      } else {
        await markEmailCampaignItem(
          item.id,
          "failed",
          res.error ?? "gagal mengirim",
        );
        failedNow++;
        if (res.fatal) {
          fatalError = res.error ?? "galat akun SMTP";
          await requeueEmailItems(items.slice(idx + 1).map((it) => it.id));
          stop = "fatal";
          break outer;
        }
      }

      // Jeda antar email, tetapi jangan mulai jeda bila sisa waktu ronde
      // tidak cukup — item sisanya dikembalikan ke antrean.
      if (idx < items.length - 1 && delayMs > 0) {
        if (Date.now() + delayMs + MIN_SEND_WINDOW_MS > deadline) {
          await requeueEmailItems(items.slice(idx + 1).map((it) => it.id));
          stop = "budget";
          break outer;
        }
        await sleep(delayMs);
      }
    }
  }

  const progress = await emailCampaignProgress(id);
  const base = {
    sent: progress.sent,
    failed: progress.failed,
    batch_sent: batchSent,
  };

  if (progress.remaining === 0) {
    // Kampanye loop harian: siklus selesai → reset antrean dan jadwalkan
    // putaran berikutnya pada jam mulai (default 08:00 WIB).
    if (campaign.repeat_daily === 1 && progress.total > 0) {
      const newTotal = await resetEmailCampaignForLoop(
        id,
        campaign.group_id,
        campaign.smtp_account_id,
      );
      const resumeAt = nextRepeatStartUtc(repeatStartHourOf(campaign));
      const scheduled = await updateEmailCampaignRunIfActive(id, {
        ...base,
        total: newTotal,
        status: "paused",
        pause_reason: "cooldown",
        next_run_at: utcStamp(resumeAt),
        batch_sent: 0,
        sent: 0,
      });
      if (!scheduled) {
        return buildResult(id, { sentNow, failedNow, smtpAccount: smtpInfo });
      }
      return buildResult(id, {
        notice: `Siklus selesai — putaran berikutnya dimulai otomatis pukul ${wibClock(resumeAt)} WIB.`,
        sentNow,
        failedNow,
        waitSeconds: Math.max(
          60,
          Math.ceil((resumeAt.getTime() - Date.now()) / 1000),
        ),
        shouldContinue: false,
        smtpAccount: smtpInfo,
      });
    }
    await updateEmailCampaignRun(id, {
      ...base,
      status: "done",
      pause_reason: "",
      next_run_at: "",
      batch_sent: 0,
    });
    return buildResult(id, {
      sentNow,
      failedNow,
      smtpAccount: smtpInfo,
    });
  }

  if (fatalError) {
    await updateEmailCampaignRun(id, {
      ...base,
      status: "paused",
      pause_reason: "fatal",
      next_run_at: "",
    });
    return buildResult(id, {
      ok: false,
      error: fatalError,
      notice: `Pengiriman dijeda: ${fatalError}`,
      sentNow,
      failedNow,
      smtpAccount: smtpInfo,
    });
  }

  if (dailyLeft <= 0 || providerQuota) {
    const resumeAt = nextMidnight();
    const waitSeconds = Math.max(
      60,
      Math.ceil((resumeAt.getTime() - Date.now()) / 1000),
    );
    const scheduled = await updateEmailCampaignRunIfActive(id, {
      ...base,
      status: "paused",
      pause_reason: "cooldown",
      next_run_at: utcStamp(resumeAt),
      batch_sent: 0,
    });
    if (!scheduled) {
      return buildResult(id, { sentNow, failedNow, smtpAccount: smtpInfo });
    }
    return buildResult(id, {
      notice: providerQuota
        ? `Kuota kirim harian akun "${account.name}" habis menurut penyedia — pengiriman dilanjutkan otomatis pukul 00:00 WIB.`
        : `Batas harian akun "${account.name}" (${account.daily_limit} email) tercapai. Pengiriman lanjut otomatis pukul 00:00 WIB.`,
      sentNow,
      failedNow,
      waitSeconds,
      smtpAccount: smtpInfo,
    });
  }

  if (batchSent >= batchSize) {
    const resumeAt = new Date(Date.now() + batchPause * 1000);
    const scheduled = await updateEmailCampaignRunIfActive(id, {
      ...base,
      status: "paused",
      pause_reason: "cooldown",
      next_run_at: utcStamp(resumeAt),
      batch_sent: 0,
    });
    if (!scheduled) {
      return buildResult(id, { sentNow, failedNow, smtpAccount: smtpInfo });
    }
    return buildResult(id, {
      notice: `Batch ${batchSize} email terkirim. Jeda ${batchPause} detik sebelum batch berikutnya.`,
      sentNow,
      failedNow,
      waitSeconds: batchPause,
      smtpAccount: smtpInfo,
    });
  }

  const waitSeconds = stop === "budget" ? 1 : 2;
  const advanced = await updateEmailCampaignRunIfActive(id, {
    ...base,
    status: "sending",
    pause_reason: "",
    next_run_at: utcStamp(new Date(Date.now() + waitSeconds * 1000)),
  });
  if (!advanced) {
    return buildResult(id, { sentNow, failedNow, smtpAccount: smtpInfo });
  }
  return buildResult(id, {
    sentNow,
    failedNow,
    waitSeconds,
    smtpAccount: smtpInfo,
  });
}

// Jalankan kampanye yang jatuh tempo / terputus. Dipanggil dari tick tab
// admin dan cron Vercel — satu ronde per kampanye, dibatasi waktu total.
// Bila `skipIfWorkerFresh` dan worker VPS baru saja menjalankan ronde ini,
// panggilan dilewati.
export async function runDueScheduledEmailCampaigns(opts?: {
  skipIfWorkerFresh?: boolean;
}): Promise<{
  started: number;
  results: { id: number; ok: boolean; error?: string }[];
}> {
  if (opts?.skipIfWorkerFresh && (await workerHeartbeatFresh("sched:email"))) {
    return { started: 0, results: [] };
  }
  const due = await listDueScheduledEmailCampaigns();
  const results: { id: number; ok: boolean; error?: string }[] = [];
  const deadline = Date.now() + 40_000;
  for (const c of due) {
    if (Date.now() >= deadline) break;
    const res = await runEmailCampaign(c.id);
    results.push({ id: c.id, ok: res.ok, error: res.error });
  }
  return { started: results.length, results };
}
