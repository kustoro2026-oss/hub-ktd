// Endpoint sementara untuk mengamankan Supabase:
// 1. GET  — cek tabel mana yang punya grant ke role anon/authenticated
// 2. POST — cabut (REVOKE) grant publik dari semua tabel
// Guard: Authorization: Bearer CRON_SECRET saja.
// HAPUS endpoint ini setelah selesai.
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function dbUrl(target?: string): string {
  if (target === "store") {
    return (process.env.STORE_DATABASE_URL ?? "").trim();
  }
  return (
    process.env.SUPABASE_DATABASE_URL ??
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    ""
  ).trim();
}

async function isCronAuth(req: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function runSql(sql: string, target?: string): Promise<{ rows: unknown[]; rowCount: number }> {
  const { Pool } = await import("pg");
  const url = dbUrl(target);
  if (!url) throw new Error("Database URL tidak ditemukan");
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  try {
    const res = await pool.query(sql);
    return { rows: res.rows, rowCount: res.rowCount ?? 0 };
  } finally {
    await pool.end();
  }
}

// Jalankan banyak SQL dalam satu koneksi (penting: REVOKE 39 tabel = 80 statement).
async function runSqlBatch(sqls: string[], target?: string): Promise<number> {
  const { Pool } = await import("pg");
  const url = dbUrl(target);
  if (!url) throw new Error("Database URL tidak ditemukan");
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    let done = 0;
    for (const sql of sqls) {
      await client.query(sql);
      done++;
    }
    return done;
  } finally {
    client.release();
    await pool.end();
  }
}

// Cek tabel + grant yang terbuka ke role anon / authenticated.
async function checkGrants(): Promise<unknown[]> {
  const { rows } = await runSql(`
    SELECT
      n.nspname AS schema,
      c.relname AS table_name,
      array_agg(DISTINCT r.rolname) AS granted_roles
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_aclitem[] acl ON c.relacl = acl
    CROSS JOIN LATERAL (
      SELECT
        (aclexplode(c.relacl)).grantee::regrole::text AS grantee
    ) g
    JOIN pg_roles r ON r.rolname = g.grantee
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND g.grantee IN ('anon', 'authenticated')
    GROUP BY n.nspname, c.relname
    ORDER BY c.relname
  `);
  return rows;
}

// Cek tabel + grant yang terbuka ke role anon / authenticated.
async function checkGrantsSimple(target?: string): Promise<unknown[]> {
  const { rows } = await runSql(`
    SELECT
      table_schema,
      table_name,
      privilege_type,
      grantee
    FROM information_schema.table_privileges
    WHERE table_schema = 'public'
      AND grantee IN ('anon', 'authenticated')
    ORDER BY table_name, grantee, privilege_type
  `, target);
  return rows;
}

async function revokeAll(target?: string): Promise<{ revoked_tables: string[]; total_statements: number }> {
  const tables = await checkGrantsSimple(target);
  const tableNames = [...new Set((tables as { table_name: string }[]).map((t) => t.table_name))];

  // Bangun semua statement dalam 1 batch — 1 koneksi, tidak timeout.
  const stmts: string[] = [];
  for (const tbl of tableNames) {
    stmts.push(`REVOKE ALL ON TABLE public."${tbl}" FROM anon`);
    stmts.push(`REVOKE ALL ON TABLE public."${tbl}" FROM authenticated`);
  }
  // Cabut grant default untuk tabel masa depan.
  stmts.push(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon`);
  stmts.push(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated`);

  const done = await runSqlBatch(stmts, target);
  return { revoked_tables: tableNames, total_statements: done };
}

export async function GET(req: Request) {
  if (!(await isCronAuth(req))) {
    return NextResponse.json({ error: "forbidden" }, { status: 401 });
  }

  const url = new URL(req.url);
  const target = url.searchParams.get("db") ?? undefined;

  try {
    const grants = await checkGrantsSimple(target);
    return NextResponse.json({
      ok: true,
      db: target ?? "hub",
      total_open_tables: [...new Set((grants as { table_name: string }[]).map((t) => t.table_name))].length,
      grants,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "gagal" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  if (!(await isCronAuth(req))) {
    return NextResponse.json({ error: "forbidden" }, { status: 401 });
  }

  const url = new URL(req.url);
  const target = url.searchParams.get("db") ?? undefined;

  try {
    const result = await revokeAll(target);
    return NextResponse.json({ ok: true, db: target ?? "hub", ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "gagal" },
      { status: 500 },
    );
  }
}
