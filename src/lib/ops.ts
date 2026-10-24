// Orkestrasi pemeliharaan ops (kesehatan DB harian + backup mingguan).
// Dipakai bersama route Vercel dan worker VPS supaya satu sumber logika.
import { opsDumpTables, opsHealthCheck, opsStoreBackup } from "@/lib/db";
import { nowWib, ownerNumber, sendText } from "@/lib/wa";

const BUCKET = "ktd-backups";

export type OpsHealthResult = { ok: boolean; issues: string[] };

/** Probe DB hub + DB toko + endpoint orders toko; WA pemilik hanya bila sakit. */
export async function runOpsHealthCheck(): Promise<OpsHealthResult> {
  const issues: string[] = [];

  try {
    await opsHealthCheck();
  } catch (e) {
    issues.push(`DB hub: ${e instanceof Error ? e.message : "SELECT 1 gagal"}`);
  }

  const storeUrl = (process.env.STORE_DATABASE_URL ?? "").trim();
  if (!storeUrl) {
    issues.push("STORE_DATABASE_URL belum diatur");
  } else {
    try {
      const { Pool } = await import("pg");
      const pool = new Pool({
        connectionString: storeUrl,
        ssl: { rejectUnauthorized: false },
      });
      try {
        await pool.query("SELECT 1");
      } finally {
        await pool.end();
      }
    } catch (e) {
      issues.push(
        `DB toko: ${e instanceof Error ? e.message : "SELECT 1 gagal"}`,
      );
    }
  }

  try {
    const res = await fetch("https://toko.kustoro2026.com/api/topup/orders", {
      headers: { "x-topup-secret": process.env.TOPUP_ADMIN_SECRET ?? "" },
      cache: "no-store",
    });
    const j = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    if (!res.ok || !j || j.ok !== true) {
      issues.push(`API toko /orders: HTTP ${res.status} tanpa ok:true`);
    }
  } catch (e) {
    issues.push(
      `API toko /orders: ${
        e instanceof Error ? e.message : "tidak terjangkau"
      }`,
    );
  }

  if (issues.length) {
    const owner = ownerNumber();
    if (owner) {
      await sendText(
        owner,
        `[Pemantau DB] ${nowWib()}\n${issues.map((i) => `- ${i}`).join("\n")}`,
      );
    }
    return { ok: false, issues };
  }
  return { ok: true, issues: [] };
}

async function dumpStoreTables(): Promise<{
  tables: Record<string, unknown[]>;
  error?: string;
}> {
  const url = (process.env.STORE_DATABASE_URL ?? "").trim();
  if (!url) return { tables: {}, error: "STORE_DATABASE_URL belum diatur" };
  try {
    const { Pool } = await import("pg");
    const pool = new Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
    });
    try {
      const names = (
        await pool.query<{ tablename: string }>(
          "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
        )
      ).rows.map((r) => r.tablename);
      const tables: Record<string, unknown[]> = {};
      for (const t of names) {
        try {
          tables[t] = (await pool.query(`SELECT * FROM ${t} ORDER BY 1`)).rows;
        } catch {
          tables[t] = [];
        }
      }
      return { tables };
    } finally {
      await pool.end();
    }
  } catch (e) {
    return {
      tables: {},
      error: e instanceof Error ? e.message : "koneksi DB toko gagal",
    };
  }
}

async function uploadToStorage(
  name: string,
  body: string,
): Promise<string | null> {
  const url = (process.env.SUPABASE_URL ?? "").trim();
  const key = (process.env.SUPABASE_SERVICE_KEY ?? "").trim();
  if (!url || !key) {
    return "storage belum dikonfigurasi (SUPABASE_URL/SERVICE_KEY)";
  }
  let res = await fetch(`${url}/storage/v1/object/${BUCKET}/${name}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "x-upsert": "true",
    },
    body,
  });
  if (!res.ok) {
    // Bucket mungkin belum ada — coba buat sekali, lalu ulangi upload.
    const mk = await fetch(`${url}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      // Tanpa file_size_limit — field ini ditolak Storage (HTTP 413) di
      // plan gratis; batas bawaan cukup besar untuk dump mingguan.
      body: JSON.stringify({
        name: BUCKET,
        public: false,
      }),
    });
    if (mk.ok) {
      res = await fetch(`${url}/storage/v1/object/${BUCKET}/${name}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "x-upsert": "true",
        },
        body,
      });
    } else {
      return `upload gagal HTTP ${res.status} (buat bucket HTTP ${mk.status})`;
    }
  }
  return res.ok ? null : `upload gagal HTTP ${res.status}`;
}

export type OpsBackupResult = { ok: boolean; message: string };

/** Dump hub + toko, upload ke Storage Supabase, simpan snapshot, WA pemilik. */
export async function runOpsWeeklyBackup(): Promise<OpsBackupResult> {
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `dump-${stamp}.json`;
  let message = "";
  try {
    const hub = await opsDumpTables();
    const store = await dumpStoreTables();
    const full = { dumpedAt: new Date().toISOString(), hub, store };
    const body = JSON.stringify(full);

    const upErr = await uploadToStorage(name, body);
    await opsStoreBackup(full);

    const hubCounts = Object.entries(hub.tables)
      .map(([t, rows]) => `${t}:${rows.length}`)
      .join(", ");
    const storeCounts = Object.entries(store.tables)
      .map(([t, rows]) => `${t}:${rows.length}`)
      .join(", ");
    message =
      `[Backup] ${nowWib()}\nHub (${hubCounts})\nToko (${storeCounts})` +
      (store.error ? `\nPeringatan toko: ${store.error}` : "") +
      (upErr ? `\nPeringatan storage: ${upErr}` : `\nStorage: ${BUCKET}/${name}`);

    const owner = ownerNumber();
    if (owner) {
      const wa = await sendText(owner, message);
      if (!wa.ok) message += `\nPeringatan WA: ${wa.error ?? "gagal kirim"}`;
    }
    return { ok: true, message };
  } catch (e) {
    message = `[Backup] ${nowWib()} GAGAL: ${
      e instanceof Error ? e.message : "galat tak dikenal"
    }`;
    const owner = ownerNumber();
    if (owner) await sendText(owner, message);
    return { ok: false, message };
  }
}
