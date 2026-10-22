// Pembersihan data lama KTD Hub — mengurangi konsumsi storage Supabase.
//
// Kategori cleanup (masing-masing bisa dipicu terpisah via body JSON):
//   messages          — hapus pesan WA > 90 hari
//   email_events      — hapus event email > 30 hari
//   order_seen        — hapus tracker pesanan marketplace > 60 hari
//   order_exec        — hapus log eksekusi selesai/gagal > 90 hari
//   topup_orders      — hapus topup selesai/gagal > 90 hari
//   broadcast_items   — hapus item broadcast selesai > 60 hari
//   affiliate         — hapus invite lama + cache kreator > 30 hari
//   stok_penyesuaian  — hapus penyesuaian > 90 hari (semua channel done)
//   caches            — hapus cache harga/finance (bisa di-regenerate)
//   semua             — jalankan semua kategori di atas
//
// Guard: sesi admin (isAuthed) ATAU Authorization: Bearer CRON_SECRET.
// Operasi massal memakai batch WHERE ... < cutoff supaya tidak timeout.
import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import type { SQLInputValue } from "node:sqlite";

export const runtime = "nodejs";

// ---------- helpers ----------

function dbMode(): "pg" | "sqlite" {
  return process.env.SUPABASE_DATABASE_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL
    ? "pg"
    : "sqlite";
}

async function run(
  sql: string,
  params: SQLInputValue[] = [],
): Promise<number> {
  // Mengembalikan jumlah baris terhapus (untuk pg: rowCount, sqlite: changes).
  if (dbMode() === "pg") {
    const { Pool } = await import("pg");
    const url = (
      process.env.SUPABASE_DATABASE_URL ??
      process.env.DATABASE_URL ??
      process.env.POSTGRES_URL ??
      ""
    ).trim();
    const pool = new Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
    });
    try {
      // Terjemahkan ? → $1, $2, ...
      let i = 0;
      const pgSql = sql.replace(/\?/g, () => `$${++i}`);
      const res = await pool.query(pgSql, params);
      return res.rowCount ?? 0;
    } finally {
      await pool.end();
    }
  }

  const { DatabaseSync } = await import("node:sqlite");
  const path = await import("node:path");
  const db = new DatabaseSync(path.join(process.cwd(), "data", "ktd-hub.db"));
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = db.prepare(sql).run(...(params as SQLInputValue[])) as any;
    return Number(r?.changes) || 0;
  } finally {
    db.close();
  }
}

function cutoff(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

async function isCronAuth(req: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

// ---------- kategori cleanup ----------

type CleanupResult = { category: string; deleted: number; detail?: string };

async function cleanMessages(days: number): Promise<CleanupResult> {
  const c = cutoff(days);
  const deleted = await run(
    `DELETE FROM messages WHERE created_at < ?`,
    [c],
  );
  return { category: "messages", deleted, detail: `> ${days} hari` };
}

async function cleanEmailEvents(days: number): Promise<CleanupResult> {
  const c = cutoff(days);
  const deleted = await run(
    `DELETE FROM email_events WHERE created_at < ?`,
    [c],
  );
  return { category: "email_events", deleted, detail: `> ${days} hari` };
}

async function cleanOrderSeen(days: number): Promise<CleanupResult> {
  let total = 0;
  const c = cutoff(days);
  for (const tbl of [
    "tiktok_order_seen",
    "blibli_order_seen",
    "lazada_order_seen",
  ]) {
    total += await run(`DELETE FROM ${tbl} WHERE first_seen_at < ?`, [c]);
  }
  return {
    category: "order_seen",
    deleted: total,
    detail: `tiktok/blibli/lazada > ${days} hari`,
  };
}

async function cleanOrderExec(days: number): Promise<CleanupResult> {
  // Hanya hapus yang sudah selesai atau gagal — yang "menunggu" tetap aman.
  const c = cutoff(days);
  let total = 0;
  for (const tbl of [
    "tiktok_order_exec",
    "blibli_order_exec",
    "lazada_order_exec",
  ]) {
    total += await run(
      `DELETE FROM ${tbl} WHERE created_at < ? AND status IN ('selesai', 'gagal', 'done', 'failed')`,
      [c],
    );
  }
  return {
    category: "order_exec",
    deleted: total,
    detail: `selesai/gagal > ${days} hari`,
  };
}

async function cleanTopupOrders(days: number): Promise<CleanupResult> {
  const c = cutoff(days);
  const deleted = await run(
    `DELETE FROM topup_orders WHERE created_at < ? AND payment_status IN ('paid', 'success', 'expired', 'failed')`,
    [c],
  );
  return { category: "topup_orders", deleted, detail: `paid/expired > ${days} hari` };
}

async function cleanBroadcastItems(days: number): Promise<CleanupResult> {
  const c = cutoff(days);
  const deleted = await run(
    `DELETE FROM broadcast_items WHERE created_at < ? AND status IN ('sent', 'failed')`,
    [c],
  );
  return {
    category: "broadcast_items",
    deleted,
    detail: `sent/failed > ${days} hari`,
  };
}

async function cleanAffiliate(
  inviteDays: number,
  cacheDays: number,
): Promise<CleanupResult> {
  const cInvite = cutoff(inviteDays);
  const cCache = cutoff(cacheDays);
  const invites = await run(
    `DELETE FROM affiliate_invites WHERE created_at < ? AND status IN ('accepted', 'rejected', 'cancelled', 'expired')`,
    [cInvite],
  );
  const creators = await run(
    `DELETE FROM affiliate_creator_cache WHERE cached_at < ?`,
    [cCache],
  );
  return {
    category: "affiliate",
    deleted: invites + creators,
    detail: `invite selesai > ${inviteDays} hari, cache kreator > ${cacheDays} hari`,
  };
}

async function cleanStokPenyesuaian(days: number): Promise<CleanupResult> {
  // Hanya hapus yang semua channel sudah done (4 kolom = 1).
  const c = cutoff(days);
  const deleted = await run(
    `DELETE FROM stok_penyesuaian WHERE created_at < ? AND tiktok_done = 1 AND blibli_done = 1 AND lazada_done = 1 AND ktd_done = 1`,
    [c],
  );
  return {
    category: "stok_penyesuaian",
    deleted,
    detail: `semua channel done > ${days} hari`,
  };
}

async function cleanCaches(): Promise<CleanupResult> {
  let total = 0;
  total += await run(`DELETE FROM harga_snapshot`);
  total += await run(`DELETE FROM aneka_finance_cache`);
  total += await run(`DELETE FROM ktd_store_harga`);
  return {
    category: "caches",
    deleted: total,
    detail: "harga_snapshot + aneka_finance_cache + ktd_store_harga (akan di-sync ulang)",
  };
}

// ---------- route handler ----------

const ALL_CATEGORIES = [
  "messages",
  "email_events",
  "order_seen",
  "order_exec",
  "topup_orders",
  "broadcast_items",
  "affiliate",
  "stok_penyesuaian",
  "caches",
];

export async function POST(req: Request) {
  const cronOk = await isCronAuth(req);
  if (!cronOk && !(await isAuthed())) {
    return NextResponse.json({ error: "Belum masuk" }, { status: 401 });
  }

  let body: { categories?: string[]; dry_run?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // body kosong → jalankan semua
  }

  const requested = body.categories ?? ["semua"];
  const dryRun = body.dry_run === true;
  const runAll = requested.includes("semua");

  // Default retention (hari) — bisa diubah lewat body.
  const days = {
    messages: 90,
    email_events: 30,
    order_seen: 60,
    order_exec: 90,
    topup_orders: 90,
    broadcast_items: 60,
    affiliate_invites: 90,
    affiliate_cache: 30,
    stok_penyesuaian: 90,
  };

  const toRun = runAll
    ? ALL_CATEGORIES
    : requested.filter((c) => ALL_CATEGORIES.includes(c));

  if (toRun.length === 0) {
    return NextResponse.json({
      ok: false,
      error: `Kategori tidak dikenali. Pilihan: ${ALL_CATEGORIES.join(", ")}, semua`,
    });
  }

  const results: CleanupResult[] = [];

  for (const cat of toRun) {
    try {
      switch (cat) {
        case "messages":
          results.push(await cleanMessages(days.messages));
          break;
        case "email_events":
          results.push(await cleanEmailEvents(days.email_events));
          break;
        case "order_seen":
          results.push(await cleanOrderSeen(days.order_seen));
          break;
        case "order_exec":
          results.push(await cleanOrderExec(days.order_exec));
          break;
        case "topup_orders":
          results.push(await cleanTopupOrders(days.topup_orders));
          break;
        case "broadcast_items":
          results.push(await cleanBroadcastItems(days.broadcast_items));
          break;
        case "affiliate":
          results.push(
            await cleanAffiliate(
              days.affiliate_invites,
              days.affiliate_cache,
            ),
          );
          break;
        case "stok_penyesuaian":
          results.push(await cleanStokPenyesuaian(days.stok_penyesuaian));
          break;
        case "caches":
          results.push(await cleanCaches());
          break;
      }
    } catch (e) {
      results.push({
        category: cat,
        deleted: 0,
        detail: `ERROR: ${e instanceof Error ? e.message : "gagal"}`,
      });
    }
  }

  const totalDeleted = results.reduce((s, r) => s + r.deleted, 0);

  return NextResponse.json({
    ok: true,
    dry_run: dryRun,
    categories_run: toRun,
    results,
    total_deleted: totalDeleted,
    cleaned_at: new Date().toISOString(),
  });
}

// GET untuk preview (dry run) — tampilkan estimasi tanpa menghapus.
export async function GET(req: Request) {
  const cronOk = await isCronAuth(req);
  if (!cronOk && !(await isAuthed())) {
    return NextResponse.json({ error: "Belum masuk" }, { status: 401 });
  }

  // Hitung estimasi baris yang akan dihapus per kategori.
  const days = {
    messages: 90,
    email_events: 30,
    order_seen: 60,
    order_exec: 90,
    topup_orders: 90,
    broadcast_items: 60,
    affiliate: 90,
    stok_penyesuaian: 90,
  };

  const estimates: { category: string; estimated: number; detail: string }[] =
    [];

  // Untuk estimasi, kita perlu query COUNT — tapi ini bisa lambat di tabel besar.
  // Gunakan pendekatan sederhana: hitung baris yang memenuhi kriteria.
  async function countEstimate(
    sql: string,
    params: SQLInputValue[] = [],
  ): Promise<number> {
    try {
      if (dbMode() === "pg") {
        const { Pool } = await import("pg");
        const url = (
          process.env.SUPABASE_DATABASE_URL ??
          process.env.DATABASE_URL ??
          process.env.POSTGRES_URL ??
          ""
        ).trim();
        const pool = new Pool({
          connectionString: url,
          ssl: { rejectUnauthorized: false },
        });
        try {
          let i = 0;
          const pgSql = sql.replace(/\?/g, () => `$${++i}`);
          const res = await pool.query(pgSql, params);
          return Number(res.rows[0]?.cnt ?? 0);
        } finally {
          await pool.end();
        }
      }
      const { DatabaseSync } = await import("node:sqlite");
      const path = await import("node:path");
      const db = new DatabaseSync(
        path.join(process.cwd(), "data", "ktd-hub.db"),
        { readOnly: true },
      );
      try {
        const row = db
          .prepare(sql)
          .get(...(params as SQLInputValue[])) as
          | { cnt: number }
          | undefined;
        return row?.cnt ?? 0;
      } finally {
        db.close();
      }
    } catch {
      return -1;
    }
  }

  const c90 = cutoff(days.messages);
  const c30 = cutoff(days.email_events);
  const c60 = cutoff(days.order_seen);

  estimates.push({
    category: "messages",
    estimated: await countEstimate(
      `SELECT COUNT(*) as cnt FROM messages WHERE created_at < ?`,
      [c90],
    ),
    detail: `> ${days.messages} hari`,
  });

  estimates.push({
    category: "email_events",
    estimated: await countEstimate(
      `SELECT COUNT(*) as cnt FROM email_events WHERE created_at < ?`,
      [c30],
    ),
    detail: `> ${days.email_events} hari`,
  });

  // order_seen: gabungkan 3 tabel.
  let seenTotal = 0;
  for (const tbl of [
    "tiktok_order_seen",
    "blibli_order_seen",
    "lazada_order_seen",
  ]) {
    const n = await countEstimate(
      `SELECT COUNT(*) as cnt FROM ${tbl} WHERE first_seen_at < ?`,
      [c60],
    );
    if (n > 0) seenTotal += n;
  }
  estimates.push({
    category: "order_seen",
    estimated: seenTotal,
    detail: `> ${days.order_seen} hari (3 marketplace)`,
  });

  // order_exec: hanya selesai/gagal.
  let execTotal = 0;
  for (const tbl of [
    "tiktok_order_exec",
    "blibli_order_exec",
    "lazada_order_exec",
  ]) {
    const n = await countEstimate(
      `SELECT COUNT(*) as cnt FROM ${tbl} WHERE created_at < ? AND status IN ('selesai','gagal','done','failed')`,
      [cutoff(days.order_exec)],
    );
    if (n > 0) execTotal += n;
  }
  estimates.push({
    category: "order_exec",
    estimated: execTotal,
    detail: `selesai/gagal > ${days.order_exec} hari`,
  });

  estimates.push({
    category: "topup_orders",
    estimated: await countEstimate(
      `SELECT COUNT(*) as cnt FROM topup_orders WHERE created_at < ? AND payment_status IN ('paid','success','expired','failed')`,
      [cutoff(days.topup_orders)],
    ),
    detail: `paid/expired > ${days.topup_orders} hari`,
  });

  estimates.push({
    category: "broadcast_items",
    estimated: await countEstimate(
      `SELECT COUNT(*) as cnt FROM broadcast_items WHERE created_at < ? AND status IN ('sent','failed')`,
      [cutoff(days.broadcast_items)],
    ),
    detail: `sent/failed > ${days.broadcast_items} hari`,
  });

  estimates.push({
    category: "stok_penyesuaian",
    estimated: await countEstimate(
      `SELECT COUNT(*) as cnt FROM stok_penyesuaian WHERE created_at < ? AND tiktok_done = 1 AND blibli_done = 1 AND lazada_done = 1 AND ktd_done = 1`,
      [cutoff(days.stok_penyesuaian)],
    ),
    detail: `semua done > ${days.stok_penyesuaian} hari`,
  });

  // Caches: hitung total baris.
  let cacheTotal = 0;
  for (const tbl of [
    "harga_snapshot",
    "aneka_finance_cache",
    "ktd_store_harga",
  ]) {
    const n = await countEstimate(
      `SELECT COUNT(*) as cnt FROM ${tbl}`,
    );
    if (n > 0) cacheTotal += n;
  }
  estimates.push({
    category: "caches",
    estimated: cacheTotal,
    detail: "total baris cache (akan dihapus semua, di-sync ulang)",
  });

  return NextResponse.json({
    ok: true,
    estimates,
    checked_at: new Date().toISOString(),
  });
}
