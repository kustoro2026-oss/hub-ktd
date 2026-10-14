// Backup mingguan KTD Hub + KTD Store (dipanggil cron Vercel):
//  1. dump semua tabel hub ke JSON
//  2. dump tabel toko lewat STORE_DATABASE_URL (pooler Supabase toko)
//  3. upload JSON ke Storage Supabase (bucket ktd-backups) bila
//     SUPABASE_URL + SUPABASE_SERVICE_KEY terpasang — cadangan di luar DB
//  4. simpan snapshot ke tabel ops_backups (rotasi 4 terakhir)
//  5. kirim ringkasan via WhatsApp ke pemilik
// Guard: header Authorization = Bearer CRON_SECRET (otomatis dari cron Vercel).
import { NextResponse } from "next/server";
import { opsDumpTables, opsStoreBackup } from "@/lib/db";
import { ownerNumber, sendText, nowWib } from "@/lib/wa";

export const runtime = "nodejs";

const BUCKET = "ktd-backups";

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

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "forbidden" }, { status: 401 });
  }

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
    return NextResponse.json({ ok: true, message });
  } catch (e) {
    message = `[Backup] ${nowWib()} GAGAL: ${
      e instanceof Error ? e.message : "galat tak dikenal"
    }`;
    const owner = ownerNumber();
    if (owner) await sendText(owner, message);
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
