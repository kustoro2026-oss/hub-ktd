// Statistik pemakaian database KTD Hub:
//  - jumlah baris per tabel
//  - estimasi ukuran per tabel (Postgres: pg_total_relation_size; SQLite: proporsional)
//  - total ukuran database
// Guard: sesi admin (isAuthed) ATAU Authorization: Bearer CRON_SECRET.
import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";

type TableStat = {
  table: string;
  rows: number;
  size_bytes: number;
  size_human: string;
};

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function isCronAuth(req: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function getPgStats(): Promise<{
  tables: TableStat[];
  total_bytes: number;
  mode: string;
}> {
  const { Pool } = await import("pg");
  const url = (
    process.env.SUPABASE_DATABASE_URL ??
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    ""
  ).trim();
  if (!url) throw new Error("Database URL tidak ditemukan");

  const pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });
  try {
    // pg_stat_user_tables memberikan estimasi baris yang jauh lebih cepat
    // daripada COUNT(*) untuk tiap tabel.
    const rowStats = await pool.query<{
      relname: string;
      n_live_tup: string;
    }>(
      `SELECT relname, n_live_tup
       FROM pg_stat_user_tables
       ORDER BY n_live_tup DESC`,
    );

    // Ukuran total relasi (tabel + indeks + TOAST) per tabel.
    const sizeStats = await pool.query<{
      relname: string;
      total_size: string;
    }>(
      `SELECT c.relname AS relname,
              pg_total_relation_size(c.oid) AS total_size
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
       ORDER BY pg_total_relation_size(c.oid) DESC`,
    );

    const sizeMap = new Map(
      sizeStats.rows.map((r) => [r.relname, Number(r.total_size)]),
    );

    const seen = new Set<string>();
    const tables: TableStat[] = [];

    for (const r of rowStats.rows) {
      const bytes = sizeMap.get(r.relname) ?? 0;
      tables.push({
        table: r.relname,
        rows: Number(r.n_live_tup),
        size_bytes: bytes,
        size_human: humanSize(bytes),
      });
      seen.add(r.relname);
    }

    // Tambahkan tabel yang mungkin tidak muncul di pg_stat_user_tables.
    for (const r of sizeStats.rows) {
      if (!seen.has(r.relname)) {
        tables.push({
          table: r.relname,
          rows: 0,
          size_bytes: Number(r.total_size),
          size_human: humanSize(Number(r.total_size)),
        });
      }
    }

    tables.sort((a, b) => b.size_bytes - a.size_bytes);
    const total_bytes = tables.reduce((s, t) => s + t.size_bytes, 0);
    return { tables, total_bytes, mode: "pg" };
  } finally {
    await pool.end();
  }
}

async function getSqliteStats(): Promise<{
  tables: TableStat[];
  total_bytes: number;
  mode: string;
}> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const dbPath = path.join(process.cwd(), "data", "ktd-hub.db");

  if (!fs.existsSync(dbPath)) {
    return { tables: [], total_bytes: 0, mode: "sqlite" };
  }

  const stat = fs.statSync(dbPath);
  const totalBytes = stat.size;

  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const tableRows = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
      )
      .all() as { name: string }[];

    const tables: TableStat[] = [];
    for (const t of tableRows) {
      try {
        const countRow = db
          .prepare(`SELECT COUNT(*) as cnt FROM "${t.name}"`)
          .get() as { cnt: number } | undefined;
        tables.push({
          table: t.name,
          rows: countRow?.cnt ?? 0,
          size_bytes: 0,
          size_human: "—",
        });
      } catch {
        tables.push({ table: t.name, rows: 0, size_bytes: 0, size_human: "—" });
      }
    }

    // SQLite tidak punya ukuran per-tabel — estimasi proporsional dari baris.
    const totalRows = tables.reduce((s, t) => s + t.rows, 0);
    if (totalRows > 0) {
      for (const t of tables) {
        t.size_bytes = Math.round((t.rows / totalRows) * totalBytes);
        t.size_human = humanSize(t.size_bytes);
      }
    }

    tables.sort((a, b) => b.size_bytes - a.size_bytes);
    return { tables, total_bytes: totalBytes, mode: "sqlite" };
  } finally {
    db.close();
  }
}

export async function GET(req: Request) {
  const cronOk = await isCronAuth(req);
  if (!cronOk && !(await isAuthed())) {
    return NextResponse.json({ error: "Belum masuk" }, { status: 401 });
  }

  try {
    const mode =
      process.env.SUPABASE_DATABASE_URL ||
      process.env.DATABASE_URL ||
      process.env.POSTGRES_URL
        ? "pg"
        : "sqlite";

    const stats = mode === "pg" ? await getPgStats() : await getSqliteStats();

    return NextResponse.json({
      ok: true,
      ...stats,
      total_human: humanSize(stats.total_bytes),
      checked_at: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "Gagal membaca statistik",
      },
      { status: 500 },
    );
  }
}
