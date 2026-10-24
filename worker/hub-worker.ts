// Worker VPS KTD Hub — scheduler utama pekerjaan berat (pengganti cron
// Vercel + pinger eksternal). Jalankan dari root repo ktd-hub:
//
//   npx tsx worker/hub-worker.ts
//
// Loop tiap menit (UTC):
//  - Tiap 5 menit: cek resi TikTok/Blibli/Lazada + kampanye broadcast +
//    kampanye email + sinkron stok. Bila sukses, tulis worker_heartbeat
//    (jantung segar 6 menit) supaya tick Vercel (tab admin / webhook)
//    melewati pekerjaan yang sama — Vercel jadi pengaman, bukan pemain.
//  - Jadwal harian (meniru vercel.json):
//      01:00  ops health        01:30  affiliate auto
//      02:00  ops backup (Min)  07:30  affiliate auto
//      23:00  snapshot keuangan
import { checkNewTiktokOrders } from "../src/lib/tiktok-resi";
import { checkNewBlibliOrders } from "../src/lib/blibli-resi";
import { checkNewLazadaOrders } from "../src/lib/lazada-resi";
import { runDueScheduledBroadcasts } from "../src/lib/broadcast-send";
import { runDueScheduledEmailCampaigns } from "../src/lib/email-send";
import { cekOrderSelesaiSemuaChannel } from "../src/lib/stok-sync";
import { runOpsHealthCheck, runOpsWeeklyBackup } from "../src/lib/ops";
import { runAffiliateAutoCron } from "../src/lib/affiliate-auto";
import { ambilSnapshotAneka } from "../src/lib/keuangan";
import { workerHeartbeatSet } from "../src/lib/db";

function wib(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(11, 19);
}

function log(msg: string): void {
  console.log(`[hub-worker ${wib()}] ${msg}`);
}

// --- Putaran tiap 5 menit -------------------------------------------------
// Heartbeat HANYA ditulis saat sukses (tidak throw & ok !== false): bila
// worker gagal, jantung tidak segar dan tick Vercel turun tangan (fail-safe).
const FIVE_MIN_JOBS: {
  name: string;
  heartbeat: string;
  run: () => Promise<unknown>;
}[] = [
  {
    name: "resi-tiktok",
    heartbeat: "resi:tiktok",
    run: () => checkNewTiktokOrders(),
  },
  {
    name: "resi-blibli",
    heartbeat: "resi:blibli",
    run: () => checkNewBlibliOrders(),
  },
  {
    name: "resi-lazada",
    heartbeat: "resi:lazada",
    run: () => checkNewLazadaOrders(),
  },
  {
    name: "broadcast",
    heartbeat: "sched:broadcast",
    run: () => runDueScheduledBroadcasts(),
  },
  {
    name: "email",
    heartbeat: "sched:email",
    run: () => runDueScheduledEmailCampaigns(),
  },
  {
    name: "stok-sync",
    heartbeat: "stok:sync",
    run: () => cekOrderSelesaiSemuaChannel(),
  },
];

async function runFiveMin(): Promise<void> {
  for (const job of FIVE_MIN_JOBS) {
    const t0 = Date.now();
    try {
      const res = (await job.run()) as { ok?: boolean } | undefined;
      if (!res || res.ok !== false) await workerHeartbeatSet(job.heartbeat);
      log(`${job.name} ok (${Date.now() - t0} ms)`);
    } catch (e) {
      log(`${job.name} GAGAL: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

// --- Jadwal harian ---------------------------------------------------------
// Toleransi +5 menit supaya ronde harian tidak hilang saat putaran 5 menit
// sedang sibuk; kunci per-tanggal mencegah dobel (mis. restart di menit sama).
const DAILY_JOBS: {
  name: string;
  h: number;
  m: number;
  dow?: number;
  run: () => Promise<void>;
}[] = [
  {
    name: "ops-health",
    h: 1,
    m: 0,
    run: async () => {
      await runOpsHealthCheck();
    },
  },
  {
    name: "affiliate-auto-0130",
    h: 1,
    m: 30,
    run: async () => {
      await runAffiliateAutoCron();
    },
  },
  {
    name: "ops-backup",
    h: 2,
    m: 0,
    dow: 0,
    run: async () => {
      await runOpsWeeklyBackup();
    },
  },
  {
    name: "affiliate-auto-0730",
    h: 7,
    m: 30,
    run: async () => {
      await runAffiliateAutoCron();
    },
  },
  {
    name: "keuangan",
    h: 23,
    m: 0,
    run: async () => {
      await ambilSnapshotAneka(true);
    },
  },
];

const lastDaily = new Set<string>();

function dateKeyUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

async function runDaily(d: Date): Promise<void> {
  const nowMin = d.getUTCHours() * 60 + d.getUTCMinutes();
  const dow = d.getUTCDay();
  const dk = dateKeyUtc(d);
  for (const job of DAILY_JOBS) {
    if (job.dow !== undefined && job.dow !== dow) continue;
    const at = job.h * 60 + job.m;
    if (nowMin < at || nowMin >= at + 5) continue;
    const key = `${job.name}:${dk}`;
    if (lastDaily.has(key)) continue;
    lastDaily.add(key);
    log(`jadwal harian: ${job.name}`);
    try {
      await job.run();
      log(`jadwal harian selesai: ${job.name}`);
    } catch (e) {
      log(
        `jadwal harian GAGAL: ${job.name} — ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }
}

// --- Loop utama ------------------------------------------------------------
let busy = false;

async function tick(): Promise<void> {
  if (busy) return; // ronde sebelumnya masih jalan — lewati menit ini.
  busy = true;
  try {
    const d = new Date();
    await runDaily(d);
    if (d.getUTCMinutes() % 5 === 0) await runFiveMin();
  } finally {
    busy = false;
  }
}

async function main(): Promise<void> {
  log("start — loop tiap menit (5 menit putaran berat + jadwal harian)");
  // Uji koneksi DB sejak awal supaya masalah env langsung terlihat di log.
  try {
    await workerHeartbeatSet("worker:boot");
    log("koneksi DB ok (heartbeat boot tertulis)");
  } catch (e) {
    log(
      `GAGAL tulis heartbeat boot: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const run = () =>
    tick().catch((e) =>
      log(`tick GAGAL: ${e instanceof Error ? e.message : String(e)}`),
    );
  setInterval(run, 60_000);
  void run();
}

void main();
