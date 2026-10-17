// Database KTD Hub — dua backend dengan API async yang sama:
//
// - Produksi (Vercel): Postgres via driver pg (Supabase Postgres pooler).
//   Filesystem serverless Vercel bersifat sementara, jadi SQLite tidak bisa
//   dipakai di sana. Koneksi diambil dari env SUPABASE_DATABASE_URL (atau
//   DATABASE_URL / POSTGRES_URL sebagai cadangan lama).
// - Pengembangan lokal: SQLite via node:sqlite (file data/ktd-hub.db,
//   folder ini di-gitignore).
//
// Semua fungsi bersifat async dan selalu mengembalikan objek biasa — React
// menolak meneruskan baris berprototipe null dari node:sqlite ke Client
// Component, jadi baris disalin dulu.
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { Pool } from "pg";

export type Contact = {
  id: number;
  name: string;
  phone: string;
  note: string;
  wa_status: string;
  created_at: string;
};

export type ContactGroup = {
  id: number;
  name: string;
  member_count: number;
  created_at: string;
};

export type Broadcast = {
  id: number;
  name: string;
  template: string;
  group_id: number | null;
  vars: string;
  lang: string;
  scheduled_at: string;
  total: number;
  sent: number;
  failed: number;
  status: "draft" | "sending" | "done";
  created_at: string;
};

export type BroadcastItem = {
  id: number;
  broadcast_id: number;
  contact_id: number | null;
  phone: string;
  status: "pending" | "queued" | "sent" | "delivered" | "read" | "failed";
  error: string;
  wa_id: string;
  claimed_at: string;
};

export type InboundMessage = {
  id: string;
  wa_from: string;
  body: string;
  reply: string;
  kind:
    | "general"
    | "order"
    | "topup"
    | "ad"
    | "faq"
    | "question"
    | "ai"
    | "proof"
    | "spam"
    | "blocked";
  ad_id: string;
  direction: "in" | "out";
  read: number;
  notify: string;
  created_at: string;
};

const g = globalThis as unknown as {
  __ktdHubPg?: Pool;
  __ktdHubSqlite?: DatabaseSync;
};

// ---------- inti koneksi ----------

function dbMode(): "pg" | "sqlite" {
  return process.env.SUPABASE_DATABASE_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL
    ? "pg"
    : "sqlite";
}

function pgUrl(): string {
  return (
    process.env.SUPABASE_DATABASE_URL ??
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    ""
  ).trim();
}

// node:sqlite memakai placeholder `?`; Postgres memakai $1, $2, ... — tulis
// query sekali dengan `?` lalu terjemahkan untuk Postgres.
function toPg(query: string): string {
  let i = 0;
  return query.replace(/\?/g, () => `$${++i}`);
}

async function pgPool(): Promise<Pool> {
  if (!g.__ktdHubPg) {
    const { Pool } = await import("pg");
    const pool = new Pool({
      connectionString: pgUrl(),
      ssl: { rejectUnauthorized: false },
    });
    await migratePg(pool);
    g.__ktdHubPg = pool;
  }
  return g.__ktdHubPg;
}

async function sqliteDb(): Promise<DatabaseSync> {
  if (!g.__ktdHubSqlite) {
    if (process.env.VERCEL) {
      throw new Error(
        "KTD Hub di Vercel butuh SUPABASE_DATABASE_URL (Postgres Supabase) — set di dashboard Vercel, lalu redeploy.",
      );
    }
    const { DatabaseSync: Db } = await import("node:sqlite");
    const dir = path.join(process.cwd(), "data");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const db = new Db(path.join(dir, "ktd-hub.db"));
    db.exec("PRAGMA journal_mode = WAL;");
    migrateSqlite(db);
    g.__ktdHubSqlite = db;
  }
  return g.__ktdHubSqlite;
}

type Row = Record<string, unknown>;

// Postgres mengembalikan kolom TIMESTAMPTZ sebagai objek Date — ubah ke
// string "YYYY-MM-DD HH:MM:SS" (UTC) supaya tampilan seragam dengan SQLite.
function normalizePgRow(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] =
      v instanceof Date ? v.toISOString().slice(0, 19).replace("T", " ") : v;
  }
  return out;
}

async function queryAll<T>(
  sql: string,
  params: SQLInputValue[] = [],
): Promise<T[]> {
  if (dbMode() === "pg") {
    const { rows } = await (await pgPool()).query(toPg(sql), params);
    return rows.map(normalizePgRow) as unknown as T[];
  }
  const rows = (await sqliteDb()).prepare(sql).all(...params) as unknown[];
  return plainRows<T>(rows);
}

async function queryOne<T>(
  sql: string,
  params: SQLInputValue[] = [],
): Promise<T | undefined> {
  if (dbMode() === "pg") {
    const { rows } = await (await pgPool()).query(toPg(sql), params);
    return rows.length ? (normalizePgRow(rows[0]) as unknown as T) : undefined;
  }
  const row = (await sqliteDb()).prepare(sql).get(...params);
  return row ? ({ ...(row as object) } as T) : undefined;
}

async function queryRun(
  sql: string,
  params: SQLInputValue[] = [],
): Promise<void> {
  if (dbMode() === "pg") {
    await (await pgPool()).query(toPg(sql), params);
    return;
  }
  (await sqliteDb()).prepare(sql).run(...params);
}

// Baris dari node:sqlite berprototipe null — salin ke objek biasa sebelum
// dikembalikan.
function plainRows<T>(rows: unknown[]): T[] {
  return rows.map((r) => ({ ...(r as Record<string, unknown>) })) as T[];
}

// ---------- operasional: backup + kesehatan ----------

/** Daftar nama tabel data di backend aktif — dibaca dari katalog schema
 *  sehingga otomatis mengikuti tabel baru tanpa perlu diedit manual.
 *  ops_backups dikecualikan supaya dump tidak membesar rekursif. */
export async function opsListTables(): Promise<string[]> {
  if (dbMode() === "pg") {
    const rows = await queryAll<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    );
    return rows.map((r) => r.tablename).filter((t) => t !== "ops_backups");
  }
  const rows = await queryAll<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  return rows.map((r) => r.name).filter((t) => t !== "ops_backups");
}

/** Dump isi semua tabel menjadi satu objek JSON (backup mingguan). */
export async function opsDumpTables(): Promise<{
  dumpedAt: string;
  tables: Record<string, unknown[]>;
}> {
  const names = await opsListTables();
  const tables: Record<string, unknown[]> = {};
  for (const t of names) {
    try {
      tables[t] = await queryAll<Record<string, unknown>>(
        `SELECT * FROM ${t} ORDER BY 1`,
      );
    } catch {
      tables[t] = []; // tabel tak terbaca — tetap lanjut dump tabel lain
    }
  }
  return { dumpedAt: new Date().toISOString(), tables };
}

/** Simpan snapshot dump ke tabel ops_backups (rotasi: sisakan 4 terakhir). */
export async function opsStoreBackup(dump: unknown): Promise<void> {
  await queryRun("INSERT INTO ops_backups (name, data) VALUES (?, ?)", [
    new Date().toISOString().slice(0, 10),
    JSON.stringify(dump),
  ]);
  await queryRun(
    "DELETE FROM ops_backups WHERE id NOT IN (SELECT id FROM ops_backups ORDER BY id DESC LIMIT 4)",
  );
}

/** Uji koneksi DB sederhana (dipakai pemantauan kesehatan). */
export async function opsHealthCheck(): Promise<void> {
  await queryRun("SELECT 1");
}

// ---------- migrasi ----------

function migrateSqlite(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL UNIQUE,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS broadcasts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      template TEXT NOT NULL DEFAULT 'info_promo_v2',
      group_id INTEGER,
      vars TEXT NOT NULL DEFAULT '',
      lang TEXT NOT NULL DEFAULT 'id',
      scheduled_at TEXT NOT NULL DEFAULT '',
      total INTEGER NOT NULL DEFAULT 0,
      sent INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS broadcast_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      broadcast_id INTEGER NOT NULL,
      contact_id INTEGER,
      phone TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT NOT NULL DEFAULT '',
      wa_id TEXT NOT NULL DEFAULT '',
      claimed_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      wa_from TEXT NOT NULL,
      body TEXT NOT NULL,
      reply TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'general',
      ad_id TEXT NOT NULL DEFAULT '',
      direction TEXT NOT NULL DEFAULT 'in',
      read INTEGER NOT NULL DEFAULT 0,
      notify TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_broadcast_items_broadcast
      ON broadcast_items (broadcast_id);
    CREATE INDEX IF NOT EXISTS idx_messages_created
      ON messages (created_at DESC);

    CREATE TABLE IF NOT EXISTS blocked_numbers (
      wa_from TEXT PRIMARY KEY,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS contact_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS group_members (
      group_id INTEGER NOT NULL,
      contact_id INTEGER NOT NULL,
      PRIMARY KEY (group_id, contact_id)
    );

    CREATE TABLE IF NOT EXISTS tiktok_shop_tokens (
      shop_id TEXT PRIMARY KEY,
      shop_name TEXT NOT NULL DEFAULT '',
      cipher TEXT NOT NULL DEFAULT '',
      access_token TEXT NOT NULL DEFAULT '',
      refresh_token TEXT NOT NULL DEFAULT '',
      expires_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS lazada_seller_tokens (
      seller_id TEXT PRIMARY KEY,
      short_code TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      account TEXT NOT NULL DEFAULT '',
      access_token TEXT NOT NULL DEFAULT '',
      refresh_token TEXT NOT NULL DEFAULT '',
      expires_at TEXT NOT NULL DEFAULT '',
      refresh_expires_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS tiktok_order_seen (
      order_id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL DEFAULT '',
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      notify TEXT NOT NULL DEFAULT '',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_attempt_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS aneka_product_map (
      tiktok_product_id TEXT PRIMARY KEY,
      tiktok_product_name TEXT NOT NULL DEFAULT '',
      tiktok_sku TEXT NOT NULL DEFAULT '',
      aneka_product_id TEXT NOT NULL DEFAULT '',
      aneka_variant_id TEXT NOT NULL DEFAULT '',
      aneka_product_name TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS tiktok_order_exec (
      order_id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'menunggu',
      payload TEXT NOT NULL DEFAULT '',
      aneka_payment_id TEXT NOT NULL DEFAULT '',
      aneka_order_id TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      log TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      executed_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS blibli_order_seen (
      order_item_id TEXT PRIMARY KEY,
      store_code TEXT NOT NULL DEFAULT '',
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      notify TEXT NOT NULL DEFAULT '',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_attempt_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS blibli_product_map (
      blibli_sku TEXT PRIMARY KEY,
      seller_sku TEXT NOT NULL DEFAULT '',
      product_name TEXT NOT NULL DEFAULT '',
      aneka_product_id TEXT NOT NULL DEFAULT '',
      aneka_variant_id TEXT NOT NULL DEFAULT '',
      aneka_product_name TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS blibli_order_exec (
      package_id TEXT PRIMARY KEY,
      store_code TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'menunggu',
      payload TEXT NOT NULL DEFAULT '',
      aneka_payment_id TEXT NOT NULL DEFAULT '',
      aneka_order_id TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      log TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      executed_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS lazada_order_seen (
      order_item_id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL DEFAULT '',
      store_code TEXT NOT NULL DEFAULT '',
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      notify TEXT NOT NULL DEFAULT '',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_attempt_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS lazada_product_map (
      lazada_sku TEXT PRIMARY KEY,
      seller_sku TEXT NOT NULL DEFAULT '',
      product_name TEXT NOT NULL DEFAULT '',
      aneka_product_id TEXT NOT NULL DEFAULT '',
      aneka_variant_id TEXT NOT NULL DEFAULT '',
      aneka_product_name TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS lazada_order_exec (
      order_id TEXT PRIMARY KEY,
      store_code TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'menunggu',
      payload TEXT NOT NULL DEFAULT '',
      aneka_payment_id TEXT NOT NULL DEFAULT '',
      aneka_order_id TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      log TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      executed_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS aturan_harga (
      id TEXT PRIMARY KEY,
      marketplace TEXT NOT NULL DEFAULT '',
      posisi INTEGER NOT NULL DEFAULT 0,
      min_profit INTEGER NOT NULL DEFAULT 0,
      max_profit INTEGER,
      aksi TEXT NOT NULL DEFAULT 'potong',
      jenis TEXT NOT NULL DEFAULT 'rp',
      nilai INTEGER NOT NULL DEFAULT 0,
      aktif INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS aneka_upload (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL DEFAULT 'blibli',
      nama_file TEXT NOT NULL DEFAULT '',
      jumlah_produk INTEGER NOT NULL DEFAULT 0,
      jumlah_baris INTEGER NOT NULL DEFAULT 0,
      daftar_id TEXT NOT NULL DEFAULT '',
      keterangan TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS harga_snapshot (
      marketplace TEXT NOT NULL DEFAULT '',
      sku_key TEXT NOT NULL DEFAULT '',
      product_id TEXT NOT NULL DEFAULT '',
      sku_id TEXT NOT NULL DEFAULT '',
      product_name TEXT NOT NULL DEFAULT '',
      sku_label TEXT NOT NULL DEFAULT '',
      harga_regular INTEGER NOT NULL DEFAULT 0,
      harga_sale INTEGER NOT NULL DEFAULT 0,
      pickup_point_code TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      PRIMARY KEY (marketplace, sku_key)
    );

    CREATE TABLE IF NOT EXISTS aneka_finance_cache (
      k TEXT PRIMARY KEY,
      data TEXT NOT NULL DEFAULT '',
      fetched_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS ktd_store_harga (
      aneka_id TEXT PRIMARY KEY,
      harga INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS ktd_store_stok (
      aneka_id TEXT PRIMARY KEY,
      stok INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS stok_penyesuaian (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL DEFAULT '',
      order_id TEXT NOT NULL DEFAULT '',
      sku_key TEXT NOT NULL DEFAULT '',
      aneka_id TEXT NOT NULL DEFAULT '',
      nama TEXT NOT NULL DEFAULT '',
      qty INTEGER NOT NULL DEFAULT 0,
      tiktok_done INTEGER NOT NULL DEFAULT 0,
      blibli_done INTEGER NOT NULL DEFAULT 0,
      lazada_done INTEGER NOT NULL DEFAULT 0,
      ktd_done INTEGER NOT NULL DEFAULT 0,
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_stok_penyesuaian_created
      ON stok_penyesuaian (created_at DESC);

    CREATE TABLE IF NOT EXISTS topup_orders (
      id TEXT PRIMARY KEY,
      ref_id TEXT NOT NULL UNIQUE,
      sku TEXT NOT NULL DEFAULT '',
      product_name TEXT NOT NULL DEFAULT '',
      customer_no TEXT NOT NULL DEFAULT '',
      amount INTEGER NOT NULL DEFAULT 0,
      cost INTEGER NOT NULL DEFAULT 0,
      buyer_name TEXT NOT NULL DEFAULT '',
      buyer_phone TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      payment_status TEXT NOT NULL DEFAULT 'pending',
      topup_status TEXT NOT NULL DEFAULT 'waiting_payment',
      gateway_session TEXT NOT NULL DEFAULT '',
      gateway_trx TEXT NOT NULL DEFAULT '',
      payment_url TEXT NOT NULL DEFAULT '',
      payment_va TEXT NOT NULL DEFAULT '',
      payment_qr TEXT NOT NULL DEFAULT '',
      paid_at TEXT NOT NULL DEFAULT '',
      digiflazz_sn TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_topup_orders_created
      ON topup_orders (created_at DESC);

    CREATE TABLE IF NOT EXISTS ops_backups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      data TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migrasi DB lama: kolom shop_cipher untuk panggilan API pesanan.
  const tcols = db
    .prepare("PRAGMA table_info(tiktok_shop_tokens)")
    .all() as unknown as { name: string }[];
  if (!tcols.some((c) => c.name === "cipher")) {
    db.exec(
      "ALTER TABLE tiktok_shop_tokens ADD COLUMN cipher TEXT NOT NULL DEFAULT ''",
    );
  }

  // Migrasi DB lama: kolom log jejak langkah eksekusi checkout Aneka.
  const ecols = db
    .prepare("PRAGMA table_info(tiktok_order_exec)")
    .all() as unknown as { name: string }[];
  if (!ecols.some((c) => c.name === "log")) {
    db.exec(
      "ALTER TABLE tiktok_order_exec ADD COLUMN log TEXT NOT NULL DEFAULT ''",
    );
  }

  // Migrasi DB lama: kolom waktu percobaan ulang terakhir (pengatur jeda
  // retry supaya kegagalan sementara tidak menghabiskan kuota dalam
  // hitungan menit ketika pengecekan berjalan tiap menit).
  const scols = db
    .prepare("PRAGMA table_info(tiktok_order_seen)")
    .all() as unknown as { name: string }[];
  if (!scols.some((c) => c.name === "last_attempt_at")) {
    db.exec(
      "ALTER TABLE tiktok_order_seen ADD COLUMN last_attempt_at TEXT NOT NULL DEFAULT ''",
    );
  }

  // Migrasi DB lama: tambah kolom wa_id bila belum ada (id pesan WhatsApp
  // untuk mencocokkan event status kiriman dari webhook Meta).
  const cols = db
    .prepare("PRAGMA table_info(broadcast_items)")
    .all() as unknown as { name: string }[];
  if (!cols.some((c) => c.name === "wa_id")) {
    db.exec(
      "ALTER TABLE broadcast_items ADD COLUMN wa_id TEXT NOT NULL DEFAULT ''",
    );
  }
  if (!cols.some((c) => c.name === "claimed_at")) {
    db.exec(
      "ALTER TABLE broadcast_items ADD COLUMN claimed_at TEXT NOT NULL DEFAULT ''",
    );
  }

  // Migrasi DB lama: kolom nilai variabel kampanye + bahasa template
  // (template bervariabel {{1}} diisi saat kampanye dibuat).
  const vcols = db
    .prepare("PRAGMA table_info(broadcasts)")
    .all() as unknown as { name: string }[];
  if (!vcols.some((c) => c.name === "vars")) {
    db.exec("ALTER TABLE broadcasts ADD COLUMN vars TEXT NOT NULL DEFAULT ''");
  }
  if (!vcols.some((c) => c.name === "lang")) {
    db.exec("ALTER TABLE broadcasts ADD COLUMN lang TEXT NOT NULL DEFAULT 'id'");
  }
  if (!vcols.some((c) => c.name === "scheduled_at")) {
    db.exec(
      "ALTER TABLE broadcasts ADD COLUMN scheduled_at TEXT NOT NULL DEFAULT ''",
    );
  }

  // Migrasi DB lama: kolom arah pesan (masuk/keluar) dan status terbaca
  // untuk tampilan daftar chat + balasan manual ala WhatsApp.
  const mcols = db
    .prepare("PRAGMA table_info(messages)")
    .all() as unknown as { name: string }[];
  if (!mcols.some((c) => c.name === "direction")) {
    db.exec(
      "ALTER TABLE messages ADD COLUMN direction TEXT NOT NULL DEFAULT 'in'",
    );
  }
  if (!mcols.some((c) => c.name === "read")) {
    db.exec("ALTER TABLE messages ADD COLUMN read INTEGER NOT NULL DEFAULT 0");
  }
  // Kolom status notifikasi pesanan ke admin ('' = tidak berlaku,
  // 'ok' = terkirim, 'gagal: ...' = gagal).
  if (!mcols.some((c) => c.name === "notify")) {
    db.exec("ALTER TABLE messages ADD COLUMN notify TEXT NOT NULL DEFAULT ''");
  }

  // Migrasi DB lama: kolom status verifikasi WhatsApp kontak
  // ('' = belum dicek, 'valid', 'invalid', 'error').
  const ccols = db
    .prepare("PRAGMA table_info(contacts)")
    .all() as unknown as { name: string }[];
  if (!ccols.some((c) => c.name === "wa_status")) {
    db.exec(
      "ALTER TABLE contacts ADD COLUMN wa_status TEXT NOT NULL DEFAULT ''",
    );
  }

  // Migrasi DB lama: kolom id grup sasaran broadcast (NULL = semua kontak).
  const bcols = db
    .prepare("PRAGMA table_info(broadcasts)")
    .all() as unknown as { name: string }[];
  if (!bcols.some((c) => c.name === "group_id")) {
    db.exec("ALTER TABLE broadcasts ADD COLUMN group_id INTEGER");
  }

  // Migrasi skema awal blibli_order_exec (kunci order_item_id → package_id):
  // satu baris eksekusi Aneka = SATU paket Blibli (satu paket = satu label
  // = satu slot resi). Modul Blibli belum rilis, jadi tabel lama (kosong)
  // aman dibuang sekali lalu dibuat ulang dengan skema baru.
  const bexecols = db
    .prepare("PRAGMA table_info(blibli_order_exec)")
    .all() as unknown as { name: string }[];
  if (bexecols.length > 0 && !bexecols.some((c) => c.name === "package_id")) {
    db.exec("DROP TABLE blibli_order_exec");
    db.exec(`
      CREATE TABLE blibli_order_exec (
        package_id TEXT PRIMARY KEY,
        store_code TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'menunggu',
        payload TEXT NOT NULL DEFAULT '',
        aneka_payment_id TEXT NOT NULL DEFAULT '',
        aneka_order_id TEXT NOT NULL DEFAULT '',
        detail TEXT NOT NULL DEFAULT '',
        log TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        executed_at TEXT NOT NULL DEFAULT ''
      );
    `);
  }

  // Migrasi skema awal blibli_product_map (kunci seller_sku → blibli_sku
  // productSku, tingkat produk seperti product_id TikTok — satu baris
  // pemetaan menaungi SEMUA varian produk). Tabel lama kosong (modul baru
  // rilis), jadi aman dibuang sekali lalu dibuat ulang.
  const bmapcols = db
    .prepare("PRAGMA table_info(blibli_product_map)")
    .all() as unknown as { name: string }[];
  if (bmapcols.length > 0 && !bmapcols.some((c) => c.name === "blibli_sku")) {
    db.exec("DROP TABLE blibli_product_map");
    db.exec(`
      CREATE TABLE blibli_product_map (
        blibli_sku TEXT PRIMARY KEY,
        seller_sku TEXT NOT NULL DEFAULT '',
        product_name TEXT NOT NULL DEFAULT '',
        aneka_product_id TEXT NOT NULL DEFAULT '',
        aneka_variant_id TEXT NOT NULL DEFAULT '',
        aneka_product_name TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
      );
    `);
  }
}

async function migratePg(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contacts (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL UNIQUE,
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS broadcasts (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      template TEXT NOT NULL DEFAULT 'info_promo_v2',
      group_id INTEGER,
      vars TEXT NOT NULL DEFAULT '',
      lang TEXT NOT NULL DEFAULT 'id',
      scheduled_at TEXT NOT NULL DEFAULT '',
      total INTEGER NOT NULL DEFAULT 0,
      sent INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS broadcast_items (
      id SERIAL PRIMARY KEY,
      broadcast_id INTEGER NOT NULL,
      contact_id INTEGER,
      phone TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT NOT NULL DEFAULT '',
      wa_id TEXT NOT NULL DEFAULT '',
      claimed_at TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      wa_from TEXT NOT NULL,
      body TEXT NOT NULL,
      reply TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'general',
      ad_id TEXT NOT NULL DEFAULT '',
      direction TEXT NOT NULL DEFAULT 'in',
      read INTEGER NOT NULL DEFAULT 0,
      notify TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_broadcast_items_broadcast
      ON broadcast_items (broadcast_id);
    CREATE INDEX IF NOT EXISTS idx_messages_created
      ON messages (created_at DESC);

    CREATE TABLE IF NOT EXISTS blocked_numbers (
      wa_from TEXT PRIMARY KEY,
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS contact_groups (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS group_members (
      group_id INTEGER NOT NULL,
      contact_id INTEGER NOT NULL,
      PRIMARY KEY (group_id, contact_id)
    );

    CREATE TABLE IF NOT EXISTS tiktok_shop_tokens (
      shop_id TEXT PRIMARY KEY,
      shop_name TEXT NOT NULL DEFAULT '',
      cipher TEXT NOT NULL DEFAULT '',
      access_token TEXT NOT NULL DEFAULT '',
      refresh_token TEXT NOT NULL DEFAULT '',
      expires_at TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS lazada_seller_tokens (
      seller_id TEXT PRIMARY KEY,
      short_code TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      account TEXT NOT NULL DEFAULT '',
      access_token TEXT NOT NULL DEFAULT '',
      refresh_token TEXT NOT NULL DEFAULT '',
      expires_at TEXT NOT NULL DEFAULT '',
      refresh_expires_at TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS tiktok_order_seen (
      order_id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL DEFAULT '',
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      notify TEXT NOT NULL DEFAULT '',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_attempt_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS aneka_product_map (
      tiktok_product_id TEXT PRIMARY KEY,
      tiktok_product_name TEXT NOT NULL DEFAULT '',
      tiktok_sku TEXT NOT NULL DEFAULT '',
      aneka_product_id TEXT NOT NULL DEFAULT '',
      aneka_variant_id TEXT NOT NULL DEFAULT '',
      aneka_product_name TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS tiktok_order_exec (
      order_id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'menunggu',
      payload TEXT NOT NULL DEFAULT '',
      aneka_payment_id TEXT NOT NULL DEFAULT '',
      aneka_order_id TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      log TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      executed_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS blibli_order_seen (
      order_item_id TEXT PRIMARY KEY,
      store_code TEXT NOT NULL DEFAULT '',
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      notify TEXT NOT NULL DEFAULT '',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_attempt_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS blibli_product_map (
      blibli_sku TEXT PRIMARY KEY,
      seller_sku TEXT NOT NULL DEFAULT '',
      product_name TEXT NOT NULL DEFAULT '',
      aneka_product_id TEXT NOT NULL DEFAULT '',
      aneka_variant_id TEXT NOT NULL DEFAULT '',
      aneka_product_name TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS blibli_order_exec (
      package_id TEXT PRIMARY KEY,
      store_code TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'menunggu',
      payload TEXT NOT NULL DEFAULT '',
      aneka_payment_id TEXT NOT NULL DEFAULT '',
      aneka_order_id TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      log TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      executed_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS lazada_order_seen (
      order_item_id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL DEFAULT '',
      store_code TEXT NOT NULL DEFAULT '',
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      notify TEXT NOT NULL DEFAULT '',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_attempt_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS lazada_product_map (
      lazada_sku TEXT PRIMARY KEY,
      seller_sku TEXT NOT NULL DEFAULT '',
      product_name TEXT NOT NULL DEFAULT '',
      aneka_product_id TEXT NOT NULL DEFAULT '',
      aneka_variant_id TEXT NOT NULL DEFAULT '',
      aneka_product_name TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS lazada_order_exec (
      order_id TEXT PRIMARY KEY,
      store_code TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'menunggu',
      payload TEXT NOT NULL DEFAULT '',
      aneka_payment_id TEXT NOT NULL DEFAULT '',
      aneka_order_id TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      log TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      executed_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS aturan_harga (
      id TEXT PRIMARY KEY,
      marketplace TEXT NOT NULL DEFAULT '',
      posisi INTEGER NOT NULL DEFAULT 0,
      min_profit INTEGER NOT NULL DEFAULT 0,
      max_profit INTEGER,
      aksi TEXT NOT NULL DEFAULT 'potong',
      jenis TEXT NOT NULL DEFAULT 'rp',
      nilai INTEGER NOT NULL DEFAULT 0,
      aktif INTEGER NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS aneka_upload (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL DEFAULT 'blibli',
      nama_file TEXT NOT NULL DEFAULT '',
      jumlah_produk INTEGER NOT NULL DEFAULT 0,
      jumlah_baris INTEGER NOT NULL DEFAULT 0,
      daftar_id TEXT NOT NULL DEFAULT '',
      keterangan TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS harga_snapshot (
      marketplace TEXT NOT NULL DEFAULT '',
      sku_key TEXT NOT NULL DEFAULT '',
      product_id TEXT NOT NULL DEFAULT '',
      sku_id TEXT NOT NULL DEFAULT '',
      product_name TEXT NOT NULL DEFAULT '',
      sku_label TEXT NOT NULL DEFAULT '',
      harga_regular INTEGER NOT NULL DEFAULT 0,
      harga_sale INTEGER NOT NULL DEFAULT 0,
      pickup_point_code TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (marketplace, sku_key)
    );

    CREATE TABLE IF NOT EXISTS aneka_finance_cache (
      k TEXT PRIMARY KEY,
      data TEXT NOT NULL DEFAULT '',
      fetched_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS ktd_store_harga (
      aneka_id TEXT PRIMARY KEY,
      harga INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS topup_orders (
      id TEXT PRIMARY KEY,
      ref_id TEXT NOT NULL UNIQUE,
      sku TEXT NOT NULL DEFAULT '',
      product_name TEXT NOT NULL DEFAULT '',
      customer_no TEXT NOT NULL DEFAULT '',
      amount INTEGER NOT NULL DEFAULT 0,
      cost INTEGER NOT NULL DEFAULT 0,
      buyer_name TEXT NOT NULL DEFAULT '',
      buyer_phone TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      payment_status TEXT NOT NULL DEFAULT 'pending',
      topup_status TEXT NOT NULL DEFAULT 'waiting_payment',
      gateway_session TEXT NOT NULL DEFAULT '',
      gateway_trx TEXT NOT NULL DEFAULT '',
      payment_url TEXT NOT NULL DEFAULT '',
      payment_va TEXT NOT NULL DEFAULT '',
      payment_qr TEXT NOT NULL DEFAULT '',
      paid_at TEXT NOT NULL DEFAULT '',
      digiflazz_sn TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_topup_orders_created
      ON topup_orders (created_at DESC);

    CREATE TABLE IF NOT EXISTS ops_backups (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      data TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Migrasi skema awal blibli_order_exec (kunci order_item_id → package_id),
  // sama seperti versi SQLite — tabel lama kosong aman dibuang sekali.
  const ecols = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'blibli_order_exec'`,
  );
  if (
    ecols.rows.length > 0 &&
    !ecols.rows.some((c) => c.column_name === "package_id")
  ) {
    await pool.query("DROP TABLE blibli_order_exec");
    await pool.query(`
      CREATE TABLE blibli_order_exec (
        package_id TEXT PRIMARY KEY,
        store_code TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'menunggu',
        payload TEXT NOT NULL DEFAULT '',
        aneka_payment_id TEXT NOT NULL DEFAULT '',
        aneka_order_id TEXT NOT NULL DEFAULT '',
        detail TEXT NOT NULL DEFAULT '',
        log TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        executed_at TEXT NOT NULL DEFAULT ''
      );
    `);
  }

  // Migrasi skema awal blibli_product_map (kunci seller_sku → blibli_sku
  // productSku), sama seperti versi SQLite — tabel lama kosong aman dibuang.
  const bmcols = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'blibli_product_map'`,
  );
  if (
    bmcols.rows.length > 0 &&
    !bmcols.rows.some((c) => c.column_name === "blibli_sku")
  ) {
    await pool.query("DROP TABLE blibli_product_map");
    await pool.query(`
      CREATE TABLE blibli_product_map (
        blibli_sku TEXT PRIMARY KEY,
        seller_sku TEXT NOT NULL DEFAULT '',
        product_name TEXT NOT NULL DEFAULT '',
        aneka_product_id TEXT NOT NULL DEFAULT '',
        aneka_variant_id TEXT NOT NULL DEFAULT '',
        aneka_product_name TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  }

  // Migrasi DB lama: kolom shop_cipher untuk panggilan API pesanan.
  await pool.query(
    "ALTER TABLE tiktok_shop_tokens ADD COLUMN IF NOT EXISTS cipher TEXT NOT NULL DEFAULT ''",
  );

  // Migrasi DB lama: kolom log jejak langkah eksekusi checkout Aneka.
  await pool.query(
    "ALTER TABLE tiktok_order_exec ADD COLUMN IF NOT EXISTS log TEXT NOT NULL DEFAULT ''",
  );

  // Migrasi DB lama: kolom waktu percobaan ulang terakhir (pengatur jeda
  // retry pengiriman resi/notifikasi pesanan).
  await pool.query(
    "ALTER TABLE tiktok_order_seen ADD COLUMN IF NOT EXISTS last_attempt_at TEXT NOT NULL DEFAULT ''",
  );

  // Migrasi DB lama: kolom arah pesan (masuk/keluar) dan status terbaca.
  await pool.query(
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'in'",
  );
  await pool.query(
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS read INTEGER NOT NULL DEFAULT 0",
  );
  await pool.query(
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS notify TEXT NOT NULL DEFAULT ''",
  );
  await pool.query(
    "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS wa_status TEXT NOT NULL DEFAULT ''",
  );
  await pool.query(
    "ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS group_id INTEGER",
  );
  await pool.query(
    "ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS vars TEXT NOT NULL DEFAULT ''",
  );
  await pool.query(
    "ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS lang TEXT NOT NULL DEFAULT 'id'",
  );
  await pool.query(
    "ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS scheduled_at TEXT NOT NULL DEFAULT ''",
  );
  await pool.query(
    "ALTER TABLE broadcast_items ADD COLUMN IF NOT EXISTS claimed_at TEXT NOT NULL DEFAULT ''",
  );
}

// ---------- Kontak ----------

export async function listContacts(): Promise<Contact[]> {
  return queryAll<Contact>("SELECT * FROM contacts ORDER BY id DESC");
}

export async function getContact(id: number): Promise<Contact | undefined> {
  return queryOne<Contact>("SELECT * FROM contacts WHERE id = ?", [id]);
}

/** Simpan hasil verifikasi WhatsApp kontak ('' / valid / invalid / error). */
export async function setContactWaStatus(
  id: number,
  status: string,
): Promise<void> {
  await queryRun("UPDATE contacts SET wa_status = ? WHERE id = ?", [
    status,
    id,
  ]);
}

export async function countContacts(): Promise<number> {
  const row = await queryOne<{ n: string | number }>(
    "SELECT COUNT(*) AS n FROM contacts",
  );
  return Number(row?.n ?? 0);
}

export async function addContact(
  name: string,
  phone: string,
  note = "",
): Promise<Contact> {
  const row = await queryOne<Contact>(
    "INSERT INTO contacts (name, phone, note) VALUES (?, ?, ?) RETURNING *",
    [name.trim(), phone, note.trim()],
  );
  if (!row) throw new Error("gagal menyimpan kontak");
  return row;
}

/** Hapus banyak kontak sekaligus (permanen). Riwayat broadcast tetap
 *  utuh — broadcast_items menyimpan salinan nomornya sendiri, jadi
 *  contact_id-nya cukup dikosongkan. Keanggotaan grup ikut terhapus. */
export async function deleteContacts(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const ph = ids.map(() => "?").join(", ");
  await queryRun(
    `UPDATE broadcast_items SET contact_id = NULL WHERE contact_id IN (${ph})`,
    ids,
  );
  await queryRun(`DELETE FROM group_members WHERE contact_id IN (${ph})`, ids);
  await queryRun(`DELETE FROM contacts WHERE id IN (${ph})`, ids);
  return ids.length;
}

// ---------- Grup kontak ----------

/** Semua grup beserta jumlah anggotanya. */
export async function listGroups(): Promise<ContactGroup[]> {
  const rows = await queryAll<
    Omit<ContactGroup, "member_count"> & { member_count: string | number }
  >(
    `SELECT g.id, g.name, g.created_at,
       (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS member_count
     FROM contact_groups g ORDER BY g.name`,
  );
  return rows.map((r) => ({ ...r, member_count: Number(r.member_count ?? 0) }));
}

export async function createGroup(name: string): Promise<ContactGroup> {
  const row = await queryOne<Omit<ContactGroup, "member_count">>(
    "INSERT INTO contact_groups (name) VALUES (?) RETURNING id, name, created_at",
    [name.trim()],
  );
  if (!row) throw new Error("gagal membuat grup");
  return { ...row, member_count: 0 };
}

export async function renameGroup(id: number, name: string): Promise<void> {
  await queryRun("UPDATE contact_groups SET name = ? WHERE id = ?", [
    name.trim(),
    id,
  ]);
}

/** Hapus grup — kontak di dalamnya TIDAK ikut terhapus. */
export async function deleteGroup(id: number): Promise<void> {
  await queryRun("DELETE FROM group_members WHERE group_id = ?", [id]);
  await queryRun("DELETE FROM contact_groups WHERE id = ?", [id]);
}

/** Peta id kontak → daftar grupnya (untuk badge di tabel kontak). */
export async function listContactGroupMap(): Promise<
  { contact_id: number; group_id: number; group_name: string }[]
> {
  return queryAll(
    `SELECT m.contact_id, m.group_id, g.name AS group_name
     FROM group_members m JOIN contact_groups g ON g.id = m.group_id`,
  );
}

/** Ganti seluruh keanggotaan grup satu kontak. */
export async function setContactGroups(
  contactId: number,
  groupIds: number[],
): Promise<void> {
  await queryRun("DELETE FROM group_members WHERE contact_id = ?", [contactId]);
  for (const gid of groupIds) {
    await queryRun(
      "INSERT INTO group_members (group_id, contact_id) VALUES (?, ?)",
      [gid, contactId],
    );
  }
}

/** Tambahkan banyak kontak ke satu grup (keanggotaan lama dipertahankan). */
export async function addContactsToGroup(
  contactIds: number[],
  groupId: number,
): Promise<void> {
  const sql =
    dbMode() === "pg"
      ? "INSERT INTO group_members (group_id, contact_id) VALUES (?, ?) ON CONFLICT DO NOTHING"
      : "INSERT OR IGNORE INTO group_members (group_id, contact_id) VALUES (?, ?)";
  for (const cid of contactIds) {
    await queryRun(sql, [groupId, cid]);
  }
}

/** Kontak anggota satu grup. */
export async function listContactsByGroup(groupId: number): Promise<Contact[]> {
  return queryAll<Contact>(
    `SELECT c.* FROM contacts c
     JOIN group_members m ON m.contact_id = c.id
     WHERE m.group_id = ? ORDER BY c.id DESC`,
    [groupId],
  );
}

// ---------- Broadcast ----------

export async function listBroadcasts(): Promise<Broadcast[]> {
  return queryAll<Broadcast>("SELECT * FROM broadcasts ORDER BY id DESC");
}

export async function getBroadcast(
  id: number,
): Promise<Broadcast | undefined> {
  return queryOne<Broadcast>("SELECT * FROM broadcasts WHERE id = ?", [id]);
}

export async function listBroadcastItems(
  broadcastId: number,
): Promise<BroadcastItem[]> {
  return queryAll<BroadcastItem>(
    "SELECT * FROM broadcast_items WHERE broadcast_id = ? ORDER BY id",
    [broadcastId],
  );
}

export async function createBroadcastWithItems(
  name: string,
  template: string,
  items: { contactId: number | null; phone: string }[],
  groupId: number | null = null,
  vars: string[] = [],
  lang = "id",
  scheduledAt = "",
): Promise<Broadcast> {
  const bc = await queryOne<Broadcast>(
    "INSERT INTO broadcasts (name, template, total, group_id, vars, lang, scheduled_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *",
    [name.trim(), template, items.length, groupId, JSON.stringify(vars), lang, scheduledAt],
  );
  if (!bc) throw new Error("gagal membuat broadcast");
  if (items.length > 0) {
    const values = items.map(() => "(?, ?, ?)").join(", ");
    const params = items.flatMap((it) => [bc.id, it.contactId, it.phone]);
    await queryRun(
      `INSERT INTO broadcast_items (broadcast_id, contact_id, phone) VALUES ${values}`,
      params,
    );
  }
  return bc;
}

export async function setBroadcastStatus(
  id: number,
  status: Broadcast["status"],
  sent: number,
  failed: number,
): Promise<void> {
  await queryRun(
    "UPDATE broadcasts SET status = ?, sent = ?, failed = ? WHERE id = ?",
    [status, sent, failed, id],
  );
}

export async function pendingBroadcastItems(
  broadcastId: number,
  limit = 40,
): Promise<BroadcastItem[]> {
  return queryAll<BroadcastItem>(
    "SELECT * FROM broadcast_items WHERE broadcast_id = ? AND status = 'pending' ORDER BY id LIMIT ?",
    [broadcastId, limit],
  );
}

export async function markBroadcastItem(
  id: number,
  status: "sent" | "failed",
  error = "",
  waId = "",
): Promise<void> {
  await queryRun(
    "UPDATE broadcast_items SET status = ?, error = ?, wa_id = ?, claimed_at = '' WHERE id = ?",
    [status, error, waId, id],
  );
}

// Ambil-sekaligus-tandai item yang akan dikirim pada ronde ini. Penandaan
// "queued" terjadi dalam satu pernyataan UPDATE ... RETURNING supaya dua
// ronde yang berjalan beriringan tidak mengambil penerima yang sama.
export async function claimPendingBroadcastItems(
  broadcastId: number,
  limit = 40,
): Promise<BroadcastItem[]> {
  const nowUtc = new Date().toISOString().slice(0, 19).replace("T", " ");
  return queryAll<BroadcastItem>(
    "UPDATE broadcast_items SET status = 'queued', claimed_at = ? WHERE id IN (SELECT id FROM broadcast_items WHERE broadcast_id = ? AND status = 'pending' ORDER BY id LIMIT ?) RETURNING *",
    [nowUtc, broadcastId, limit],
  );
}

// Kembalikan item yang sempat di-claim tapi rondenya tidak selesai (proses
// terpotong di tengah jalan) supaya bisa diambil ulang. Hanya menyentuh
// claim yang lebih tua dari batas menit — ronde yang sedang berjalan (jeda
// antar pesan < 5 menit) tidak akan pernah diambil alih.
export async function requeueStaleQueuedItems(
  broadcastId: number,
  staleMinutes = 5,
): Promise<void> {
  const cutoff = new Date(Date.now() - staleMinutes * 60_000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
  await queryRun(
    "UPDATE broadcast_items SET status = 'pending', claimed_at = '' WHERE broadcast_id = ? AND status = 'queued' AND claimed_at != '' AND claimed_at <= ?",
    [broadcastId, cutoff],
  );
}

// Urutan status pengiriman: hanya boleh naik (pending → sent → delivered →
// read). "failed" bersifat final — tidak bisa ditimpa status lain.
const DELIVERY_RANK: Record<string, number> = {
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
};

/** Terapkan event status kiriman dari webhook Meta ke item broadcast.
 *  Item dicari lewat wa_id (id pesan yang dikembalikan API saat kirim). */
export async function applyBroadcastDeliveryStatus(
  waId: string,
  status: string,
  error = "",
): Promise<void> {
  if (!["sent", "delivered", "read", "failed"].includes(status)) return;
  const row = await queryOne<{ id: number; status: string }>(
    "SELECT id, status FROM broadcast_items WHERE wa_id = ?",
    [waId],
  );
  if (!row) return;
  const current = DELIVERY_RANK[row.status] ?? 0;
  if (status === "failed") {
    if (current >= DELIVERY_RANK.delivered) return; // sudah sampai — abaikan
    await queryRun(
      "UPDATE broadcast_items SET status = 'failed', error = ? WHERE id = ?",
      [error || "Meta gagal mengirim pesan", row.id],
    );
    return;
  }
  const next = DELIVERY_RANK[status] ?? 0;
  if (next <= current) return; // status tidak boleh turun
  await queryRun("UPDATE broadcast_items SET status = ? WHERE id = ?", [
    status,
    row.id,
  ]);
}

export async function broadcastProgress(id: number): Promise<{
  sent: number;
  failed: number;
  pending: number;
}> {
  const row = await queryOne<{
    sent: string | number | null;
    failed: string | number | null;
    pending: string | number | null;
  }>(
    `SELECT
      SUM(CASE WHEN status IN ('sent', 'delivered', 'read') THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
    FROM broadcast_items WHERE broadcast_id = ?`,
    [id],
  );
  return {
    sent: Number(row?.sent ?? 0),
    failed: Number(row?.failed ?? 0),
    pending: Number(row?.pending ?? 0),
  };
}

// ---------- Statistik pengiriman (panel batas kirim) ----------

// Pesan template terkirim dari Hub hari ini (jendela kalender lokal). Angka
// ini batas bawah pemakaian portofolio — Meta menghitung nomor unik lintas
// semua kanal (termasuk WhatsApp Manager) dalam 24 jam berjalan.
export async function countSentToday(): Promise<number> {
  const since =
    dbMode() === "pg"
      ? "date_trunc('day', now())"
      : "datetime('now','localtime','start of day')";
  const rows = await queryAll<{ n: string | number | null }>(
    `SELECT COUNT(*) AS n FROM broadcast_items WHERE status IN ('sent', 'delivered', 'read') AND created_at >= ${since}`,
  );
  return Number(rows[0]?.n ?? 0);
}

// Pesan template terkirim dari Hub bulan kalender ini (sejak tanggal 1).
export async function countSentThisMonth(): Promise<number> {
  const since =
    dbMode() === "pg"
      ? "date_trunc('month', now())"
      : "strftime('%Y-%m-01', 'now', 'localtime')";
  const rows = await queryAll<{ n: string | number | null }>(
    `SELECT COUNT(*) AS n FROM broadcast_items WHERE status IN ('sent', 'delivered', 'read') AND created_at >= ${since}`,
  );
  return Number(rows[0]?.n ?? 0);
}

// Kampanye terjadwal yang waktunya sudah tiba dan belum pernah dikirim.
// scheduled_at disimpan sebagai teks UTC "YYYY-MM-DD HH:MM:SS" (format yang
// sama di SQLite & Postgres) supaya perbandingan string aman di keduanya.
export async function listDueScheduledBroadcasts(): Promise<Broadcast[]> {
  const nowUtc = new Date().toISOString().slice(0, 19).replace("T", " ");
  return queryAll<Broadcast>(
    "SELECT * FROM broadcasts WHERE status = 'draft' AND scheduled_at != '' AND scheduled_at <= ? ORDER BY scheduled_at ASC",
    [nowUtc],
  );
}

// ---------- Pesan masuk ----------

export async function insertMessage(
  m: Omit<InboundMessage, "created_at" | "read" | "direction" | "notify"> & {
    direction?: "in" | "out";
    notify?: string;
  },
): Promise<void> {
  const direction = m.direction ?? "in";
  const notify = m.notify ?? "";
  const cols = "(id, wa_from, body, reply, kind, ad_id, direction, notify)";
  const placeholders = "(?, ?, ?, ?, ?, ?, ?, ?)";
  const sql =
    dbMode() === "pg"
      ? `INSERT INTO messages ${cols} VALUES ${placeholders} ON CONFLICT (id) DO NOTHING`
      : `INSERT OR IGNORE INTO messages ${cols} VALUES ${placeholders}`;
  await queryRun(sql, [
    m.id,
    m.wa_from,
    m.body,
    m.reply,
    m.kind,
    m.ad_id,
    direction,
    notify,
  ]);
}

/** True bila pesan dengan id ini sudah tercatat — Meta kadang mengirim
 *  ulang payload yang sama, dan guard ini mencegah balasan/notifikasi
 *  ganda ke pelanggan maupun ke nomor admin. */
export async function messageExists(id: string): Promise<boolean> {
  const row = await queryOne<{ x: number }>(
    "SELECT 1 AS x FROM messages WHERE id = ?",
    [id],
  );
  return !!row;
}

export type BlockedNumber = {
  wa_from: string;
  note: string;
  created_at: string;
};

/** Jumlah pesan masuk dari satu nomor dalam N menit terakhir — dasar
 *  pembatas spam. Dihitung dari tabel messages (bukan memori) supaya tetap
 *  akurat di serverless yang instansnya berganti-ganti. */
export async function countInboundSince(
  waFrom: string,
  minutes: number,
): Promise<number> {
  if (dbMode() === "pg") {
    const row = await queryOne<{ c: number }>(
      "SELECT COUNT(*)::int AS c FROM messages WHERE wa_from = ? AND direction = 'in' AND created_at >= NOW() - (?::int * INTERVAL '1 minute')",
      [waFrom, minutes],
    );
    return row?.c ?? 0;
  }
  const cutoff = new Date(Date.now() - minutes * 60_000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
  const row = await queryOne<{ c: number }>(
    "SELECT COUNT(*) AS c FROM messages WHERE wa_from = ? AND direction = 'in' AND created_at >= ?",
    [waFrom, cutoff],
  );
  return row?.c ?? 0;
}

// ---------- Daftar blokir anti-spam ----------

/** True bila nomor ini diblokir admin — bot diam total (pesan tetap
 *  dicatat di Pesan Masuk, tetapi tidak dibalas dan AI tidak dipanggil). */
export async function isNumberBlocked(waFrom: string): Promise<boolean> {
  const row = await queryOne<{ x: number }>(
    "SELECT 1 AS x FROM blocked_numbers WHERE wa_from = ?",
    [waFrom],
  );
  return !!row;
}

export async function blockNumber(waFrom: string, note = ""): Promise<void> {
  const sql =
    dbMode() === "pg"
      ? "INSERT INTO blocked_numbers (wa_from, note) VALUES (?, ?) ON CONFLICT (wa_from) DO UPDATE SET note = EXCLUDED.note"
      : "INSERT OR REPLACE INTO blocked_numbers (wa_from, note, created_at) VALUES (?, ?, datetime('now'))";
  await queryRun(sql, [waFrom, note]);
}

export async function unblockNumber(waFrom: string): Promise<void> {
  await queryRun("DELETE FROM blocked_numbers WHERE wa_from = ?", [waFrom]);
}

export async function listBlockedNumbers(): Promise<BlockedNumber[]> {
  return queryAll<BlockedNumber>(
    "SELECT wa_from, note, created_at FROM blocked_numbers ORDER BY created_at DESC",
  );
}

export async function listMessages(limit = 100): Promise<InboundMessage[]> {
  return queryAll<InboundMessage>(
    "SELECT * FROM messages ORDER BY created_at DESC LIMIT ?",
    [limit],
  );
}

export async function countMessages(): Promise<number> {
  const row = await queryOne<{ n: string | number }>(
    "SELECT COUNT(*) AS n FROM messages",
  );
  return Number(row?.n ?? 0);
}

// ---------- Percakapan (tampilan chat ala WhatsApp) ----------

export type ConversationSummary = {
  wa_from: string;
  body: string;
  reply: string;
  kind: string;
  direction: "in" | "out";
  last_at: string;
  unread: number;
  total: number;
};

/** Ringkasan percakapan per nomor: pesan terakhir + jumlah belum dibaca. */
export async function listConversations(): Promise<ConversationSummary[]> {
  return queryAll<ConversationSummary>(
    `SELECT wa_from, body, reply, kind, direction,
            created_at AS last_at, unread, total
     FROM (
       SELECT m.*,
         ROW_NUMBER() OVER (PARTITION BY wa_from ORDER BY created_at DESC, id DESC) AS rn,
         (SELECT COUNT(*) FROM messages m2
           WHERE m2.wa_from = m.wa_from
             AND m2.direction = 'in' AND m2.read = 0) AS unread,
         (SELECT COUNT(*) FROM messages m3 WHERE m3.wa_from = m.wa_from) AS total
       FROM messages m
     ) sub
     WHERE rn = 1
     ORDER BY last_at DESC`,
  );
}

/** Semua pesan satu percakapan, urut dari yang terlama. */
export async function listConversationMessages(
  waFrom: string,
): Promise<InboundMessage[]> {
  return queryAll<InboundMessage>(
    "SELECT * FROM messages WHERE wa_from = ? ORDER BY created_at ASC, id ASC",
    [waFrom],
  );
}

/** Pesan manual (out) terakhir untuk satu nomor — dasar kebijakan jeda bot. */
export async function getLatestOutMessage(
  waFrom: string,
): Promise<InboundMessage | undefined> {
  return queryOne<InboundMessage>(
    "SELECT * FROM messages WHERE wa_from = ? AND direction = 'out' ORDER BY created_at DESC, id DESC LIMIT 1",
    [waFrom],
  );
}

/** Pesan masuk (in) terakhir untuk satu nomor — dasar deteksi bukti
 *  transfer (pesan sebelumnya harus order ber-metode transfer). */
export async function getLatestInMessage(
  waFrom: string,
): Promise<InboundMessage | undefined> {
  return queryOne<InboundMessage>(
    "SELECT * FROM messages WHERE wa_from = ? AND direction = 'in' ORDER BY created_at DESC, id DESC LIMIT 1",
    [waFrom],
  );
}

/** Ambil beberapa pesan masuk terakhir (lengkap dengan balasannya)
 *  untuk konteks percakapan AI — pesan pertama = paling baru. */
export async function getLatestInMessages(
  waFrom: string,
  limit = 3,
): Promise<InboundMessage[]> {
  return queryAll<InboundMessage>(
    "SELECT * FROM messages WHERE wa_from = ? AND direction = 'in' ORDER BY created_at DESC, id DESC LIMIT ?",
    [waFrom, limit],
  );
}

/** Tandai semua pesan masuk nomor ini sebagai sudah dibaca. */
export async function markConversationRead(waFrom: string): Promise<void> {
  await queryRun(
    "UPDATE messages SET read = 1 WHERE wa_from = ? AND direction = 'in' AND read = 0",
    [waFrom],
  );
}

// ---------- Token TikTok Shop (Open API) ----------

export type TiktokShopToken = {
  shop_id: string;
  shop_name: string;
  cipher: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  updated_at: string;
};

/** Simpan/timpa token OAuth toko TikTok Shop (kunci: shop_id). */
export async function saveTiktokShopToken(
  t: Pick<
    TiktokShopToken,
    | "shop_id"
    | "shop_name"
    | "cipher"
    | "access_token"
    | "refresh_token"
    | "expires_at"
  >,
): Promise<void> {
  const nowUtc = new Date().toISOString().slice(0, 19).replace("T", " ");
  await queryRun(
    `INSERT INTO tiktok_shop_tokens (shop_id, shop_name, cipher, access_token, refresh_token, expires_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (shop_id) DO UPDATE SET shop_name = excluded.shop_name, cipher = excluded.cipher,
       access_token = excluded.access_token, refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
    [
      t.shop_id,
      t.shop_name ?? "",
      t.cipher ?? "",
      t.access_token,
      t.refresh_token,
      t.expires_at,
      nowUtc,
    ],
  );
}

/** Daftar toko TikTok Shop yang sudah diotorisasi (token tersimpan). */
export async function listTiktokShopTokens(): Promise<TiktokShopToken[]> {
  return queryAll<TiktokShopToken>(
    "SELECT * FROM tiktok_shop_tokens ORDER BY updated_at DESC",
  );
}

// ---------- Token seller Lazada (Open Platform) ----------

export type LazadaSellerToken = {
  seller_id: string;
  short_code: string;
  country: string;
  account: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  refresh_expires_at: string;
  updated_at: string;
};

/** Simpan/timpa token OAuth seller Lazada (kunci: seller_id). */
export async function saveLazadaSellerToken(
  t: Pick<
    LazadaSellerToken,
    | "seller_id"
    | "short_code"
    | "country"
    | "account"
    | "access_token"
    | "refresh_token"
    | "expires_at"
    | "refresh_expires_at"
  >,
): Promise<void> {
  const nowUtc = new Date().toISOString().slice(0, 19).replace("T", " ");
  await queryRun(
    `INSERT INTO lazada_seller_tokens (seller_id, short_code, country, account, access_token, refresh_token, expires_at, refresh_expires_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (seller_id) DO UPDATE SET short_code = excluded.short_code, country = excluded.country,
       account = excluded.account, access_token = excluded.access_token,
       refresh_token = excluded.refresh_token, expires_at = excluded.expires_at,
       refresh_expires_at = excluded.refresh_expires_at, updated_at = excluded.updated_at`,
    [
      t.seller_id,
      t.short_code ?? "",
      t.country ?? "",
      t.account ?? "",
      t.access_token,
      t.refresh_token,
      t.expires_at,
      t.refresh_expires_at,
      nowUtc,
    ],
  );
}

/** Daftar seller Lazada yang sudah diotorisasi (token tersimpan). */
export async function listLazadaSellerTokens(): Promise<LazadaSellerToken[]> {
  return queryAll<LazadaSellerToken>(
    "SELECT * FROM lazada_seller_tokens ORDER BY updated_at DESC",
  );
}

// ---------- Riwayat resi pesanan TikTok (deteksi pesanan baru) ----------

export type TiktokOrderSeen = {
  order_id: string;
  shop_id: string;
  first_seen_at: string;
  notify: string;
  attempts: number;
  /** Waktu percobaan ulang terakhir (UTC "YYYY-MM-DD HH:MM:SS") — dipakai
   *  sebagai pengatur jeda antar percobaan ulang. */
  last_attempt_at: string;
};

/** Jumlah pesanan yang sudah pernah diproses. 0 berarti tabel kosong dan
 *  pengecekan berikutnya berjalan dalam mode baseline (tandai semua pesanan
 *  yang ada tanpa kirim resi — mencegah banjir resi pesanan lama). */
export async function countSeenTiktokOrders(): Promise<number> {
  const row = await queryOne<{ n: string | number }>(
    "SELECT COUNT(*) AS n FROM tiktok_order_seen",
  );
  return Number(row?.n ?? 0);
}

/** Semua baris riwayat resi — untuk memfilter pesanan baru dan mencoba
 *  ulang kiriman yang sebelumnya gagal (dibatasi kolom attempts). */
export async function listSeenTiktokOrders(): Promise<TiktokOrderSeen[]> {
  return queryAll<TiktokOrderSeen>("SELECT * FROM tiktok_order_seen");
}

/** Catat pesanan sebagai sudah diproses (upsert: notifikasi terakhir
 *  menggantikan yang lama, mis. "menunggu" → "ok", tanpa mengubah
 *  first_seen_at). `notify` = hasil kirim resi ('ok', 'ok (template)',
 *  'skip', 'menunggu:<epoch_ms>', 'batal: ...', atau 'gagal: ...'). */
export async function markTiktokOrderSeen(
  orderId: string,
  shopId: string,
  notify = "",
): Promise<void> {
  const sql =
    dbMode() === "pg"
      ? "INSERT INTO tiktok_order_seen (order_id, shop_id, notify) VALUES (?, ?, ?) ON CONFLICT (order_id) DO UPDATE SET notify = EXCLUDED.notify, shop_id = EXCLUDED.shop_id"
      : "INSERT INTO tiktok_order_seen (order_id, shop_id, notify) VALUES (?, ?, ?) ON CONFLICT (order_id) DO UPDATE SET notify = excluded.notify, shop_id = excluded.shop_id";
  await queryRun(sql, [orderId, shopId, notify]);
}

/** Atur ulang status pesanan supaya diproses ulang dari awal (mis. pesanan
 *  yang terlanjur jatuh ke jalur resi manual karena bug — dipakai route
 *  siapkan-ulang yang dijaga CRON_SECRET). Hitungan percobaan di-nol-kan
 *  supaya tidak tersangkut batas MAX_SEND_ATTEMPTS. Return false bila baris
 *  pesanan belum pernah tercatat (pesanan belum pernah dilihat pipeline). */
export async function resetTiktokOrderSeen(
  orderId: string,
  notify: string,
): Promise<boolean> {
  const updated = await queryOne<{ order_id: string }>(
    "UPDATE tiktok_order_seen SET notify = ?, attempts = 0, last_attempt_at = '' WHERE order_id = ? RETURNING order_id",
    [notify, orderId],
  );
  return Boolean(updated);
}

/** Tambah hitungan percobaan kirim resi yang gagal — pesanan yang belum
 *  pernah tercatat otomatis dibuatkan barisnya dengan attempts = 1.
 *  last_attempt_at dicatat supaya percobaan ulang bisa diberi jeda. */
export async function recordTiktokOrderFailure(
  orderId: string,
  shopId: string,
  notify: string,
): Promise<void> {
  const nowUtc = new Date().toISOString().slice(0, 19).replace("T", " ");
  const updated = await queryOne<{ order_id: string }>(
    "UPDATE tiktok_order_seen SET attempts = attempts + 1, notify = ?, last_attempt_at = ? WHERE order_id = ? RETURNING order_id",
    [notify, nowUtc, orderId],
  );
  if (!updated) {
    const sql =
      dbMode() === "pg"
        ? "INSERT INTO tiktok_order_seen (order_id, shop_id, notify, attempts, last_attempt_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT (order_id) DO NOTHING"
        : "INSERT OR IGNORE INTO tiktok_order_seen (order_id, shop_id, notify, attempts, last_attempt_at) VALUES (?, ?, ?, 1, ?)";
    await queryRun(sql, [orderId, shopId, notify, nowUtc]);
  }
}

// ---------- Pemetaan produk TikTok → Aneka (eksekusi pesanan otomatis) ----------

export type AnekaProductMap = {
  tiktok_product_id: string;
  tiktok_product_name: string;
  tiktok_sku: string;
  aneka_product_id: string;
  aneka_variant_id: string;
  aneka_product_name: string;
  enabled: number;
  updated_at: string;
};

/** Semua pemetaan produk tersimpan (kunci: tiktok_product_id).
 *  Urutkan tanpa COLLATE NOCASE — itu sintaks khusus SQLite dan membuat
 *  Postgres melempar "collation \"nocase\" does not exist" (halaman 500). */
export async function listAnekaProductMaps(): Promise<AnekaProductMap[]> {
  return queryAll<AnekaProductMap>(
    "SELECT * FROM aneka_product_map ORDER BY LOWER(tiktok_product_name) ASC",
  );
}

/** Satu pemetaan untuk product_id TikTok tertentu (null = belum dipetakan). */
export async function getAnekaProductMap(
  tiktokProductId: string,
): Promise<AnekaProductMap | null> {
  return (
    (await queryOne<AnekaProductMap>(
      "SELECT * FROM aneka_product_map WHERE tiktok_product_id = ?",
      [tiktokProductId],
    )) ?? null
  );
}

/** Simpan/timpa pemetaan (upsert). `enabled` = 0 menonaktifkan eksekusi
 *  otomatis untuk produk itu tanpa menghapus barisnya. */
export async function saveAnekaProductMap(m: {
  tiktok_product_id: string;
  tiktok_product_name?: string;
  tiktok_sku?: string;
  aneka_product_id: string;
  aneka_variant_id?: string;
  aneka_product_name?: string;
  enabled?: number;
}): Promise<void> {
  const nowUtc = new Date().toISOString().slice(0, 19).replace("T", " ");
  const sql =
    dbMode() === "pg"
      ? `INSERT INTO aneka_product_map (tiktok_product_id, tiktok_product_name, tiktok_sku, aneka_product_id, aneka_variant_id, aneka_product_name, enabled, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (tiktok_product_id) DO UPDATE SET tiktok_product_name = EXCLUDED.tiktok_product_name,
           tiktok_sku = EXCLUDED.tiktok_sku, aneka_product_id = EXCLUDED.aneka_product_id,
           aneka_variant_id = EXCLUDED.aneka_variant_id, aneka_product_name = EXCLUDED.aneka_product_name,
           enabled = EXCLUDED.enabled, updated_at = EXCLUDED.updated_at`
      : `INSERT INTO aneka_product_map (tiktok_product_id, tiktok_product_name, tiktok_sku, aneka_product_id, aneka_variant_id, aneka_product_name, enabled, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (tiktok_product_id) DO UPDATE SET tiktok_product_name = excluded.tiktok_product_name,
           tiktok_sku = excluded.tiktok_sku, aneka_product_id = excluded.aneka_product_id,
           aneka_variant_id = excluded.aneka_variant_id, aneka_product_name = excluded.aneka_product_name,
           enabled = excluded.enabled, updated_at = excluded.updated_at`;
  await queryRun(sql, [
    m.tiktok_product_id,
    m.tiktok_product_name ?? "",
    m.tiktok_sku ?? "",
    m.aneka_product_id,
    m.aneka_variant_id ?? "",
    m.aneka_product_name ?? "",
    m.enabled ?? 1,
    nowUtc,
  ]);
}

/** Hapus pemetaan untuk satu produk TikTok. */
export async function deleteAnekaProductMap(
  tiktokProductId: string,
): Promise<void> {
  await queryRun(
    "DELETE FROM aneka_product_map WHERE tiktok_product_id = ?",
    [tiktokProductId],
  );
}

/** Impor massal pemetaan awal (seed) tanpa menimpa pemetaan yang sudah ada
 *  (baik buatan manual maupun hasil impor sebelumnya). Mengembalikan jumlah
 *  baris baru yang benar-benar dimasukkan. */
export async function seedAnekaProductMaps(
  rows: {
    tiktok_product_id: string;
    tiktok_product_name?: string;
    tiktok_sku?: string;
    aneka_product_id: string;
    aneka_variant_id?: string;
    aneka_product_name?: string;
    enabled?: number;
  }[],
): Promise<{ inserted: number; skipped: number }> {
  const nowUtc = new Date().toISOString().slice(0, 19).replace("T", " ");
  let inserted = 0;
  // Postgres: bungkus dalam satu INSERT multi-baris per 50 baris — insert
  // baris-per-baris memakan satu round-trip per baris ke pooler Supabase
  // dan bisa melewati batas 60 detik fungsi Vercel saat seed membesar.
  if (dbMode() === "pg") {
    const pool = await pgPool();
    const CHUNK = 50;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const part = rows.slice(i, i + CHUNK);
      const values: string[] = [];
      const params: unknown[] = [];
      part.forEach((m, j) => {
        values.push(
          `($${j * 8 + 1}, $${j * 8 + 2}, $${j * 8 + 3}, $${j * 8 + 4}, $${j * 8 + 5}, $${j * 8 + 6}, $${j * 8 + 7}, $${j * 8 + 8})`,
        );
        params.push(
          m.tiktok_product_id,
          m.tiktok_product_name ?? "",
          m.tiktok_sku ?? "",
          m.aneka_product_id,
          m.aneka_variant_id ?? "",
          m.aneka_product_name ?? "",
          m.enabled ?? 1,
          nowUtc,
        );
      });
      const r = await pool.query(
        `INSERT INTO aneka_product_map (tiktok_product_id, tiktok_product_name, tiktok_sku, aneka_product_id, aneka_variant_id, aneka_product_name, enabled, updated_at)
         VALUES ${values.join(", ")}
         ON CONFLICT (tiktok_product_id) DO NOTHING`,
        params,
      );
      inserted += r.rowCount ?? 0;
    }
    return { inserted, skipped: rows.length - inserted };
  }

  for (const m of rows) {
    const r = (await sqliteDb())
      .prepare(
        `INSERT OR IGNORE INTO aneka_product_map (tiktok_product_id, tiktok_product_name, tiktok_sku, aneka_product_id, aneka_variant_id, aneka_product_name, enabled, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        m.tiktok_product_id,
        m.tiktok_product_name ?? "",
        m.tiktok_sku ?? "",
        m.aneka_product_id,
        m.aneka_variant_id ?? "",
        m.aneka_product_name ?? "",
        m.enabled ?? 1,
        nowUtc,
      );
    inserted += Number(r.changes) || 0;
  }
  return { inserted, skipped: rows.length - inserted };
}

// ---------- Eksekusi pesanan TikTok → Aneka (Fase 2, semi-otomatis) ----------

export type TiktokOrderExec = {
  order_id: string;
  shop_id: string;
  status: string;
  payload: string;
  aneka_payment_id: string;
  aneka_order_id: string;
  detail: string;
  /** Jejak langkah eksekusi checkout Aneka (satu baris per langkah,
   *  format "WAKTU | langkah | keterangan") — ditulis per langkah supaya
   *  diagnosa tetap tersedia bila proses terputus di tengah jalan. */
  log: string;
  created_at: string;
  executed_at: string;
};

/** Satu baris eksekusi pesanan (null = belum pernah disiapkan). */
export async function getTiktokOrderExec(
  orderId: string,
): Promise<TiktokOrderExec | null> {
  return (
    (await queryOne<TiktokOrderExec>(
      "SELECT * FROM tiktok_order_exec WHERE order_id = ?",
      [orderId],
    )) ?? null
  );
}

/** Semua baris eksekusi (menunggu persetujuan di depan, lalu terbaru). */
export async function listTiktokOrderExecs(): Promise<TiktokOrderExec[]> {
  return queryAll<TiktokOrderExec>(
    `SELECT * FROM tiktok_order_exec
     ORDER BY CASE status WHEN 'menunggu' THEN 0 ELSE 1 END, created_at DESC`,
  );
}

/** Tambah satu baris ke jejak log eksekusi (langkah checkout Aneka).
 *  Ditulis langsung per langkah supaya jejak selamat bila proses serverless
 *  terputus sebelum selesai. */
export async function appendTiktokOrderExecLog(
  orderId: string,
  line: string,
): Promise<void> {
  await queryRun(
    "UPDATE tiktok_order_exec SET log = log || ? WHERE order_id = ?",
    ["\n" + line, orderId],
  );
}

/** Kosongkan jejak log (awal percobaan baru / persiapan ulang). */
export async function clearTiktokOrderExecLog(orderId: string): Promise<void> {
  await queryRun(
    "UPDATE tiktok_order_exec SET log = '' WHERE order_id = ?",
    [orderId],
  );
}

/** Catat payment_id Aneka yang BARU dibuat ke baris eksekusi — dipanggil
 *  SEGERA setelah /payment/create sukses supaya jejak pembayaran tidak
 *  hilang bila percobaan gagal/terputus (anti pembayaran dobel saat coba
 *  ulang: id ini jadi kunci verifikasi riwayat Aneka). Hanya menyentuh
 *  kolom aneka_payment_id — status/log/kolom lain tidak diubah. */
export async function setTiktokOrderExecPayment(
  orderId: string,
  paymentId: string,
): Promise<void> {
  await queryRun(
    "UPDATE tiktok_order_exec SET aneka_payment_id = ? WHERE order_id = ?",
    [paymentId, orderId],
  );
}

/** Simpan/timpa baris eksekusi (upsert — persiapan ulang menimpa baris
 *  lama, mis. "gagal" → "menunggu" setelah percobaan berikutnya).
 *  aneka_payment_id / aneka_order_id HANYA ditimpa bila nilai baru tidak
 *  kosong (COALESCE) — pemanggil yang tidak menyebutkannya TIDAK akan
 *  menghapus jejak pembayaran (bahan pengaman anti-dobel). */
export async function saveTiktokOrderExec(e: {
  order_id: string;
  shop_id?: string;
  status?: string;
  payload?: string;
  aneka_payment_id?: string;
  aneka_order_id?: string;
  detail?: string;
  executed_at?: string;
}): Promise<void> {
  const sql =
    dbMode() === "pg"
      ? `INSERT INTO tiktok_order_exec (order_id, shop_id, status, payload, aneka_payment_id, aneka_order_id, detail, executed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (order_id) DO UPDATE SET shop_id = EXCLUDED.shop_id, status = EXCLUDED.status,
           payload = EXCLUDED.payload,
           aneka_payment_id = COALESCE(NULLIF(EXCLUDED.aneka_payment_id, ''), tiktok_order_exec.aneka_payment_id),
           aneka_order_id = COALESCE(NULLIF(EXCLUDED.aneka_order_id, ''), tiktok_order_exec.aneka_order_id),
           detail = EXCLUDED.detail,
           executed_at = EXCLUDED.executed_at`
      : `INSERT INTO tiktok_order_exec (order_id, shop_id, status, payload, aneka_payment_id, aneka_order_id, detail, executed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (order_id) DO UPDATE SET shop_id = excluded.shop_id, status = excluded.status,
           payload = excluded.payload,
           aneka_payment_id = COALESCE(NULLIF(excluded.aneka_payment_id, ''), tiktok_order_exec.aneka_payment_id),
           aneka_order_id = COALESCE(NULLIF(excluded.aneka_order_id, ''), tiktok_order_exec.aneka_order_id),
           detail = excluded.detail,
           executed_at = excluded.executed_at`;
  await queryRun(sql, [
    e.order_id,
    e.shop_id ?? "",
    e.status ?? "menunggu",
    e.payload ?? "",
    e.aneka_payment_id ?? "",
    e.aneka_order_id ?? "",
    e.detail ?? "",
    e.executed_at ?? "",
  ]);
}

/** Klaim atomik antrean eksekusi → status "berjalan". HANYA baris berstatus
 *  "menunggu" atau "gagal" yang boleh diklaim — mengembalikan false bila
 *  baris sedang berjalan (mencegah dua klik Setuju bersamaan membayar dua
 *  kali di Aneka) atau sudah selesai/batal. */
export async function claimTiktokOrderExecRunning(
  orderId: string,
): Promise<boolean> {
  const r = await queryOne<{ order_id: string }>(
    `UPDATE tiktok_order_exec SET status = 'berjalan', detail = ''
     WHERE order_id = ? AND status IN ('menunggu', 'gagal')
     RETURNING order_id`,
    [orderId],
  );
  return !!r;
}

// ---------- Cache snapshot keuangan Aneka (dashboard keuangan) ----------
// Situs Aneka tidak punya API resmi — riwayat pembayaran + saldo hasil
// scrape disimpan sebagai satu baris JSON (data) dengan stempel fetched_at
// (ISO UTC). Halaman keuangan memakainya selama masih segar; cron harian
// dan tombol Muat Ulang memperbaruinya.

export type AnekaFinanceCacheRow = {
  k: string;
  data: string;
  fetched_at: string;
};

export async function getAnekaFinanceCache(
  k: string,
): Promise<AnekaFinanceCacheRow | null> {
  return (
    (await queryOne<AnekaFinanceCacheRow>(
      "SELECT * FROM aneka_finance_cache WHERE k = ?",
      [k],
    )) ?? null
  );
}

export async function setAnekaFinanceCache(
  k: string,
  data: string,
  fetchedAt: string,
): Promise<void> {
  const sql =
    dbMode() === "pg"
      ? `INSERT INTO aneka_finance_cache (k, data, fetched_at) VALUES (?, ?, ?) 
         ON CONFLICT (k) DO UPDATE SET data = EXCLUDED.data, fetched_at = EXCLUDED.fetched_at`
      : `INSERT INTO aneka_finance_cache (k, data, fetched_at) VALUES (?, ?, ?) 
         ON CONFLICT (k) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`;
  await queryRun(sql, [k, data, fetchedAt]);
}

// ---------- Top Up & Isi Saldo (membaca tabel topup_orders milik toko) ----------

/** Baris tabel topup_orders — skema identik dengan yang ditulis toko.
 *  Hub hanya MEMBACA tabel ini; penulisan tetap di sisi toko. */
export type TopupOrderRow = {
  id: string;
  ref_id: string;
  sku: string;
  product_name: string;
  customer_no: string;
  amount: number;
  cost: number;
  buyer_name: string;
  buyer_phone: string;
  note: string;
  payment_status: string;
  topup_status: string;
  gateway_session: string;
  gateway_trx: string;
  payment_url: string;
  payment_va: string;
  payment_qr: string;
  paid_at: string;
  digiflazz_sn: string;
  error_message: string;
  created_at: string;
  updated_at: string;
};

export type TopupFilter = {
  /** Batas bawah created_at (string UTC "YYYY-MM-DD HH:MM:SS"), inklusif. */
  dari?: string;
  /** Batas atas created_at, eksklusif. */
  sampai?: string;
  statusBayar?: string;
  statusTopup?: string;
  /** Pencarian lintas kolom (id/ref/SKU/produk/tujuan/pembeli). */
  q?: string;
  limit?: number;
  offset?: number;
};

/** Bangun klausa WHERE + parameter dari filter — sintaks lintas backend
 *  (LOWER(x) LIKE LOWER(?), TANPA COLLATE NOCASE yang khusus SQLite). */
function topupWhere(f: TopupFilter): { sql: string; params: SQLInputValue[] } {
  const cond: string[] = [];
  const params: SQLInputValue[] = [];
  if (f.dari) {
    cond.push("created_at >= ?");
    params.push(f.dari);
  }
  if (f.sampai) {
    cond.push("created_at < ?");
    params.push(f.sampai);
  }
  if (f.statusBayar) {
    cond.push("payment_status = ?");
    params.push(f.statusBayar);
  }
  if (f.statusTopup) {
    cond.push("topup_status = ?");
    params.push(f.statusTopup);
  }
  if (f.q) {
    const like = `%${f.q}%`;
    cond.push(
      `(LOWER(id) LIKE LOWER(?) OR LOWER(ref_id) LIKE LOWER(?) OR LOWER(sku) LIKE LOWER(?) OR LOWER(product_name) LIKE LOWER(?) OR LOWER(customer_no) LIKE LOWER(?) OR LOWER(buyer_name) LIKE LOWER(?) OR LOWER(buyer_phone) LIKE LOWER(?))`,
    );
    params.push(like, like, like, like, like, like, like);
  }
  return { sql: cond.length ? `WHERE ${cond.join(" AND ")}` : "", params };
}

export async function listTopupOrders(
  f: TopupFilter = {},
): Promise<TopupOrderRow[]> {
  const w = topupWhere(f);
  const sql = `SELECT * FROM topup_orders ${w.sql} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  return queryAll<TopupOrderRow>(sql, [
    ...w.params,
    f.limit ?? 50,
    f.offset ?? 0,
  ]);
}

export async function countTopupOrders(f: TopupFilter = {}): Promise<number> {
  const w = topupWhere(f);
  const row = await queryOne<{ n: number | string }>(
    `SELECT COUNT(*) AS n FROM topup_orders ${w.sql}`,
    w.params,
  );
  return Number(row?.n ?? 0);
}

export async function getTopupOrder(
  id: string,
): Promise<TopupOrderRow | undefined> {
  return queryOne<TopupOrderRow>("SELECT * FROM topup_orders WHERE id = ?", [id]);
}

// ---------- Riwayat resi pesanan Blibli (deteksi pesanan baru) ----------

export type BlibliOrderSeen = {
  order_item_id: string;
  store_code: string;
  first_seen_at: string;
  notify: string;
  attempts: number;
  /** Waktu percobaan ulang terakhir (UTC "YYYY-MM-DD HH:MM:SS") — dipakai
   *  sebagai pengatur jeda antar percobaan ulang. */
  last_attempt_at: string;
};

/** Jumlah order item Blibli yang sudah pernah diproses. 0 berarti tabel
 *  kosong dan pengecekan berikutnya berjalan dalam mode baseline (tandai
 *  semua pesanan yang ada tanpa kirim resi — mencegah banjir resi pesanan
 *  lama). */
export async function countSeenBlibliOrders(): Promise<number> {
  const row = await queryOne<{ n: string | number }>(
    "SELECT COUNT(*) AS n FROM blibli_order_seen",
  );
  return Number(row?.n ?? 0);
}

/** Semua baris riwayat resi Blibli — untuk memfilter order item baru dan
 *  mencoba ulang kiriman yang sebelumnya gagal (dibatasi kolom attempts). */
export async function listSeenBlibliOrders(): Promise<BlibliOrderSeen[]> {
  return queryAll<BlibliOrderSeen>("SELECT * FROM blibli_order_seen");
}

/** Catat order item sebagai sudah diproses (upsert: notifikasi terakhir
 *  menggantikan yang lama, mis. "menunggu" → "ok", tanpa mengubah
 *  first_seen_at). `notify` = hasil kirim resi ('ok', 'ok (template)',
 *  'skip', 'menunggu:<epoch_ms>', 'batal: ...', atau 'gagal: ...'). */
export async function markBlibliOrderSeen(
  orderItemId: string,
  storeCode: string,
  notify = "",
): Promise<void> {
  const sql =
    dbMode() === "pg"
      ? "INSERT INTO blibli_order_seen (order_item_id, store_code, notify) VALUES (?, ?, ?) ON CONFLICT (order_item_id) DO UPDATE SET notify = EXCLUDED.notify, store_code = EXCLUDED.store_code"
      : "INSERT INTO blibli_order_seen (order_item_id, store_code, notify) VALUES (?, ?, ?) ON CONFLICT (order_item_id) DO UPDATE SET notify = excluded.notify, store_code = excluded.store_code";
  await queryRun(sql, [orderItemId, storeCode, notify]);
}

/** Atur ulang status order item supaya diproses ulang dari awal (dipakai
 *  route siapkan-ulang yang dijaga CRON_SECRET). Hitungan percobaan
 *  di-nol-kan supaya tidak tersangkut batas MAX_SEND_ATTEMPTS. Return false
 *  bila baris belum pernah tercatat. */
export async function resetBlibliOrderSeen(
  orderItemId: string,
  notify: string,
): Promise<boolean> {
  const updated = await queryOne<{ order_item_id: string }>(
    "UPDATE blibli_order_seen SET notify = ?, attempts = 0, last_attempt_at = '' WHERE order_item_id = ? RETURNING order_item_id",
    [notify, orderItemId],
  );
  return Boolean(updated);
}

/** Tambah hitungan percobaan kirim resi yang gagal — order item yang belum
 *  pernah tercatat otomatis dibuatkan barisnya dengan attempts = 1.
 *  last_attempt_at dicatat supaya percobaan ulang bisa diberi jeda. */
export async function recordBlibliOrderFailure(
  orderItemId: string,
  storeCode: string,
  notify: string,
): Promise<void> {
  const nowUtc = new Date().toISOString().slice(0, 19).replace("T", " ");
  const updated = await queryOne<{ order_item_id: string }>(
    "UPDATE blibli_order_seen SET attempts = attempts + 1, notify = ?, last_attempt_at = ? WHERE order_item_id = ? RETURNING order_item_id",
    [notify, nowUtc, orderItemId],
  );
  if (!updated) {
    const sql =
      dbMode() === "pg"
        ? "INSERT INTO blibli_order_seen (order_item_id, store_code, notify, attempts, last_attempt_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT (order_item_id) DO NOTHING"
        : "INSERT OR IGNORE INTO blibli_order_seen (order_item_id, store_code, notify, attempts, last_attempt_at) VALUES (?, ?, ?, 1, ?)";
    await queryRun(sql, [orderItemId, storeCode, notify, nowUtc]);
  }
}

/** Sentuh last_attempt_at tanpa mengubah notify — dipakai sebagai penanda
 *  waktu cek terakhir deteksi "paket dikembalikan" (blibli-resi.ts) supaya
 *  cek detail API tidak diulang setiap tick. */
export async function touchBlibliOrderSeen(
  orderItemId: string,
  atUtc: string,
): Promise<void> {
  await queryRun(
    "UPDATE blibli_order_seen SET last_attempt_at = ? WHERE order_item_id = ?",
    [atUtc, orderItemId],
  );
}

// ---------- Pemetaan produk Blibli (productSku) → Aneka ----------

export type BlibliProductMap = {
  /** Kunci pemetaan: productSku Blibli ("KTS-70007-XXXXX") — tingkat
   *  produk seperti product_id TikTok, satu baris menaungi semua varian. */
  blibli_sku: string;
  /** Seller SKU baris mass-upload (per varian) — hanya untuk tampilan. */
  seller_sku: string;
  product_name: string;
  aneka_product_id: string;
  aneka_variant_id: string;
  aneka_product_name: string;
  enabled: number;
  updated_at: string;
};

/** Semua pemetaan produk tersimpan (kunci: blibli_sku). Urutkan tanpa
 *  COLLATE NOCASE — itu sintaks khusus SQLite dan membuat Postgres
 *  melempar "collation \"nocase\" does not exist" (halaman 500). */
export async function listBlibliProductMaps(): Promise<BlibliProductMap[]> {
  return queryAll<BlibliProductMap>(
    "SELECT * FROM blibli_product_map ORDER BY LOWER(product_name) ASC",
  );
}

/** Satu pemetaan untuk productSku Blibli tertentu (null = belum dipetakan). */
export async function getBlibliProductMap(
  blibliSku: string,
): Promise<BlibliProductMap | null> {
  return (
    (await queryOne<BlibliProductMap>(
      "SELECT * FROM blibli_product_map WHERE blibli_sku = ?",
      [blibliSku],
    )) ?? null
  );
}

/** Simpan/timpa pemetaan (upsert). `enabled` = 0 menonaktifkan eksekusi
 *  otomatis untuk produk itu tanpa menghapus barisnya. */
export async function saveBlibliProductMap(m: {
  blibli_sku: string;
  seller_sku?: string;
  product_name?: string;
  aneka_product_id: string;
  aneka_variant_id?: string;
  aneka_product_name?: string;
  enabled?: number;
}): Promise<void> {
  const nowUtc = new Date().toISOString().slice(0, 19).replace("T", " ");
  const sql =
    dbMode() === "pg"
      ? `INSERT INTO blibli_product_map (blibli_sku, seller_sku, product_name, aneka_product_id, aneka_variant_id, aneka_product_name, enabled, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (blibli_sku) DO UPDATE SET seller_sku = EXCLUDED.seller_sku, product_name = EXCLUDED.product_name,
           aneka_product_id = EXCLUDED.aneka_product_id,
           aneka_variant_id = EXCLUDED.aneka_variant_id, aneka_product_name = EXCLUDED.aneka_product_name,
           enabled = EXCLUDED.enabled, updated_at = EXCLUDED.updated_at`
      : `INSERT INTO blibli_product_map (blibli_sku, seller_sku, product_name, aneka_product_id, aneka_variant_id, aneka_product_name, enabled, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (blibli_sku) DO UPDATE SET seller_sku = excluded.seller_sku, product_name = excluded.product_name,
           aneka_product_id = excluded.aneka_product_id,
           aneka_variant_id = excluded.aneka_variant_id, aneka_product_name = excluded.aneka_product_name,
           enabled = excluded.enabled, updated_at = excluded.updated_at`;
  await queryRun(sql, [
    m.blibli_sku,
    m.seller_sku ?? "",
    m.product_name ?? "",
    m.aneka_product_id,
    m.aneka_variant_id ?? "",
    m.aneka_product_name ?? "",
    m.enabled ?? 1,
    nowUtc,
  ]);
}

/** Hapus pemetaan untuk satu productSku Blibli. */
export async function deleteBlibliProductMap(blibliSku: string): Promise<void> {
  await queryRun(
    "DELETE FROM blibli_product_map WHERE blibli_sku = ?",
    [blibliSku],
  );
}

/** Impor massal pemetaan awal (seed) Blibli → Aneka dari
 *  src/lib/blibli-map-seed.json. Hanya menambah baris yang belum ada —
 *  pemetaan manual yang sudah tersimpan tidak ditimpa. */
export async function seedBlibliProductMaps(
  rows: {
    blibli_sku: string;
    seller_sku?: string;
    product_name?: string;
    aneka_product_id: string;
    aneka_variant_id?: string;
    aneka_product_name?: string;
    enabled?: number;
  }[],
): Promise<{ inserted: number; skipped: number }> {
  const nowUtc = new Date().toISOString().slice(0, 19).replace("T", " ");
  let inserted = 0;
  // Postgres: bungkus dalam satu INSERT multi-baris per 50 baris — insert
  // baris-per-baris = 743 round-trip ke pooler Supabase yang melewati batas
  // 60 detik fungsi Vercel (504 di Cloudflare).
  if (dbMode() === "pg") {
    const pool = await pgPool();
    const CHUNK = 50;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const part = rows.slice(i, i + CHUNK);
      const values: string[] = [];
      const params: unknown[] = [];
      part.forEach((m, j) => {
        values.push(
          `($${j * 8 + 1}, $${j * 8 + 2}, $${j * 8 + 3}, $${j * 8 + 4}, $${j * 8 + 5}, $${j * 8 + 6}, $${j * 8 + 7}, $${j * 8 + 8})`,
        );
        params.push(
          m.blibli_sku,
          m.seller_sku ?? "",
          m.product_name ?? "",
          m.aneka_product_id,
          m.aneka_variant_id ?? "",
          m.aneka_product_name ?? "",
          m.enabled ?? 1,
          nowUtc,
        );
      });
      const r = await pool.query(
        `INSERT INTO blibli_product_map (blibli_sku, seller_sku, product_name, aneka_product_id, aneka_variant_id, aneka_product_name, enabled, updated_at)
         VALUES ${values.join(", ")}
         ON CONFLICT (blibli_sku) DO NOTHING`,
        params,
      );
      inserted += r.rowCount ?? 0;
    }
    return { inserted, skipped: rows.length - inserted };
  }

  for (const m of rows) {
    const r = (await sqliteDb())
      .prepare(
        `INSERT OR IGNORE INTO blibli_product_map (blibli_sku, seller_sku, product_name, aneka_product_id, aneka_variant_id, aneka_product_name, enabled, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        m.blibli_sku,
        m.seller_sku ?? "",
        m.product_name ?? "",
        m.aneka_product_id,
        m.aneka_variant_id ?? "",
        m.aneka_product_name ?? "",
        m.enabled ?? 1,
        nowUtc,
      );
    inserted += Number(r.changes) || 0;
  }
  return { inserted, skipped: rows.length - inserted };
}

// ---------- Eksekusi pesanan Blibli → Aneka (semi-otomatis) ----------

export type BlibliOrderExec = {
  package_id: string;
  store_code: string;
  status: string;
  payload: string;
  aneka_payment_id: string;
  aneka_order_id: string;
  detail: string;
  /** Jejak langkah eksekusi checkout Aneka (satu baris per langkah,
   *  format "WAKTU | langkah | keterangan") — ditulis per langkah supaya
   *  diagnosa tetap tersedia bila proses terputus di tengah jalan. */
  log: string;
  created_at: string;
  executed_at: string;
};

/** Satu baris eksekusi paket (null = belum pernah disiapkan). */
export async function getBlibliOrderExec(
  packageId: string,
): Promise<BlibliOrderExec | null> {
  return (
    (await queryOne<BlibliOrderExec>(
      "SELECT * FROM blibli_order_exec WHERE package_id = ?",
      [packageId],
    )) ?? null
  );
}

/** Semua baris eksekusi (menunggu persetujuan di depan, lalu terbaru). */
export async function listBlibliOrderExecs(): Promise<BlibliOrderExec[]> {
  return queryAll<BlibliOrderExec>(
    `SELECT * FROM blibli_order_exec
     ORDER BY CASE status WHEN 'menunggu' THEN 0 ELSE 1 END, created_at DESC`,
  );
}

/** Tambah satu baris ke jejak log eksekusi (langkah checkout Aneka). */
export async function appendBlibliOrderExecLog(
  packageId: string,
  line: string,
): Promise<void> {
  await queryRun(
    "UPDATE blibli_order_exec SET log = log || ? WHERE package_id = ?",
    ["\n" + line, packageId],
  );
}

/** Kosongkan jejak log (awal percobaan baru / persiapan ulang). */
export async function clearBlibliOrderExecLog(
  packageId: string,
): Promise<void> {
  await queryRun(
    "UPDATE blibli_order_exec SET log = '' WHERE package_id = ?",
    [packageId],
  );
}

/** Catat payment_id Aneka yang BARU dibuat ke baris eksekusi — dipanggil
 *  SEGERA setelah /payment/create sukses supaya jejak pembayaran tidak
 *  hilang bila percobaan gagal/terputus (anti pembayaran dobel saat coba
 *  ulang). Hanya menyentuh kolom aneka_payment_id. */
export async function setBlibliOrderExecPayment(
  packageId: string,
  paymentId: string,
): Promise<void> {
  await queryRun(
    "UPDATE blibli_order_exec SET aneka_payment_id = ? WHERE package_id = ?",
    [paymentId, packageId],
  );
}

/** Simpan/timpa baris eksekusi (upsert — persiapan ulang menimpa baris
 *  lama, mis. "gagal" → "menunggu" setelah percobaan berikutnya).
 *  aneka_payment_id / aneka_order_id HANYA ditimpa bila nilai baru tidak
 *  kosong (COALESCE) — pemanggil yang tidak menyebutkannya TIDAK akan
 *  menghapus jejak pembayaran (bahan pengaman anti-dobel). */
export async function saveBlibliOrderExec(e: {
  package_id: string;
  store_code?: string;
  status?: string;
  payload?: string;
  aneka_payment_id?: string;
  aneka_order_id?: string;
  detail?: string;
  executed_at?: string;
}): Promise<void> {
  const sql =
    dbMode() === "pg"
      ? `INSERT INTO blibli_order_exec (package_id, store_code, status, payload, aneka_payment_id, aneka_order_id, detail, executed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (package_id) DO UPDATE SET store_code = EXCLUDED.store_code, status = EXCLUDED.status,
           payload = EXCLUDED.payload,
           aneka_payment_id = COALESCE(NULLIF(EXCLUDED.aneka_payment_id, ''), blibli_order_exec.aneka_payment_id),
           aneka_order_id = COALESCE(NULLIF(EXCLUDED.aneka_order_id, ''), blibli_order_exec.aneka_order_id),
           detail = EXCLUDED.detail,
           executed_at = EXCLUDED.executed_at`
      : `INSERT INTO blibli_order_exec (package_id, store_code, status, payload, aneka_payment_id, aneka_order_id, detail, executed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (package_id) DO UPDATE SET store_code = excluded.store_code, status = excluded.status,
           payload = excluded.payload,
           aneka_payment_id = COALESCE(NULLIF(excluded.aneka_payment_id, ''), blibli_order_exec.aneka_payment_id),
           aneka_order_id = COALESCE(NULLIF(excluded.aneka_order_id, ''), blibli_order_exec.aneka_order_id),
           detail = excluded.detail,
           executed_at = excluded.executed_at`;
  await queryRun(sql, [
    e.package_id,
    e.store_code ?? "",
    e.status ?? "menunggu",
    e.payload ?? "",
    e.aneka_payment_id ?? "",
    e.aneka_order_id ?? "",
    e.detail ?? "",
    e.executed_at ?? "",
  ]);
}

/** Klaim atomik antrean eksekusi → status "berjalan". HANYA baris berstatus
 *  "menunggu" atau "gagal" yang boleh diklaim — mengembalikan false bila
 *  baris sedang berjalan (mencegah dua klik Setuju bersamaan membayar dua
 *  kali di Aneka) atau sudah selesai/batal. */
export async function claimBlibliOrderExecRunning(
  packageId: string,
): Promise<boolean> {
  const r = await queryOne<{ package_id: string }>(
    `UPDATE blibli_order_exec SET status = 'berjalan', detail = ''
     WHERE package_id = ? AND status IN ('menunggu', 'gagal')
     RETURNING package_id`,
    [packageId],
  );
  return !!r;
}

// ---------- Riwayat resi pesanan Lazada (deteksi pesanan baru) ----------

export type LazadaOrderSeen = {
  order_item_id: string;
  order_id: string;
  store_code: string;
  first_seen_at: string;
  notify: string;
  attempts: number;
  /** Waktu percobaan ulang terakhir (UTC "YYYY-MM-DD HH:MM:SS") — dipakai
   *  sebagai pengatur jeda antar percobaan ulang. */
  last_attempt_at: string;
};

/** Jumlah order item Lazada yang sudah pernah diproses. 0 berarti tabel
 *  kosong dan pengecekan berikutnya berjalan dalam mode baseline (tandai
 *  semua item yang ada tanpa kirim resi — mencegah banjir PDF sekaligus). */
export async function countSeenLazadaOrders(): Promise<number> {
  const row = await queryOne<{ n: string | number }>(
    "SELECT COUNT(*) AS n FROM lazada_order_seen",
  );
  return Number(row?.n ?? 0);
}

/** Semua baris riwayat resi Lazada — untuk memfilter order item baru dan
 *  mencoba ulang kiriman yang sebelumnya gagal (dibatasi kolom attempts). */
export async function listSeenLazadaOrders(): Promise<LazadaOrderSeen[]> {
  return queryAll<LazadaOrderSeen>("SELECT * FROM lazada_order_seen");
}

/** Catat order item sebagai sudah diproses (upsert: notifikasi terakhir
 *  menggantikan yang lama, mis. "menunggu" → "ok", tanpa mengubah
 *  first_seen_at). `notify` = hasil kirim resi ('ok', 'ok (template)',
 *  'skip', 'menunggu:<epoch_ms>', 'batal: ...', 'eksekusi:menunggu', atau
 *  'gagal: ...'). order_id dicatat supaya item bisa dikelompokkan per
 *  pesanan tanpa memanggil API lagi (lazada-resi.ts). */
export async function markLazadaOrderSeen(
  orderItemId: string,
  orderId: string,
  storeCode: string,
  notify = "",
): Promise<void> {
  const sql =
    dbMode() === "pg"
      ? "INSERT INTO lazada_order_seen (order_item_id, order_id, store_code, notify) VALUES (?, ?, ?, ?) ON CONFLICT (order_item_id) DO UPDATE SET notify = EXCLUDED.notify, store_code = EXCLUDED.store_code, order_id = EXCLUDED.order_id"
      : "INSERT INTO lazada_order_seen (order_item_id, order_id, store_code, notify) VALUES (?, ?, ?, ?) ON CONFLICT (order_item_id) DO UPDATE SET notify = excluded.notify, store_code = excluded.store_code, order_id = excluded.order_id";
  await queryRun(sql, [orderItemId, orderId, storeCode, notify]);
}

/** Atur ulang status order item supaya diproses ulang dari awal (dipakai
 *  route siapkan-ulang yang dijaga CRON_SECRET). Hitungan percobaan
 *  di-nol-kan supaya tidak tersangkut batas MAX_SEND_ATTEMPTS. Return false
 *  bila baris belum pernah tercatat. */
export async function resetLazadaOrderSeen(
  orderItemId: string,
  notify: string,
): Promise<boolean> {
  const updated = await queryOne<{ order_item_id: string }>(
    "UPDATE lazada_order_seen SET notify = ?, attempts = 0, last_attempt_at = '' WHERE order_item_id = ? RETURNING order_item_id",
    [notify, orderItemId],
  );
  return Boolean(updated);
}

/** Tambah hitungan percobaan kirim resi yang gagal — order item yang belum
 *  pernah tercatat otomatis dibuatkan barisnya dengan attempts = 1.
 *  last_attempt_at dicatat supaya percobaan ulang bisa diberi jeda. */
export async function recordLazadaOrderFailure(
  orderItemId: string,
  orderId: string,
  storeCode: string,
  notify: string,
): Promise<void> {
  const nowUtc = new Date().toISOString().slice(0, 19).replace("T", " ");
  const updated = await queryOne<{ order_item_id: string }>(
    "UPDATE lazada_order_seen SET attempts = attempts + 1, notify = ?, last_attempt_at = ? WHERE order_item_id = ? RETURNING order_item_id",
    [notify, nowUtc, orderItemId],
  );
  if (!updated) {
    const sql =
      dbMode() === "pg"
        ? "INSERT INTO lazada_order_seen (order_item_id, order_id, store_code, notify, attempts, last_attempt_at) VALUES (?, ?, ?, ?, 1, ?) ON CONFLICT (order_item_id) DO NOTHING"
        : "INSERT OR IGNORE INTO lazada_order_seen (order_item_id, order_id, store_code, notify, attempts, last_attempt_at) VALUES (?, ?, ?, ?, 1, ?)";
    await queryRun(sql, [orderItemId, orderId, storeCode, notify, nowUtc]);
  }
}

/** Sentuh last_attempt_at tanpa mengubah notify — dipakai sebagai penanda
 *  waktu cek terakhir deteksi status pengiriman (lazada-resi.ts) supaya
 *  cek detail API tidak diulang setiap tick. */
export async function touchLazadaOrderSeen(
  orderItemId: string,
  atUtc: string,
): Promise<void> {
  await queryRun(
    "UPDATE lazada_order_seen SET last_attempt_at = ? WHERE order_item_id = ?",
    [atUtc, orderItemId],
  );
}

// ---------- Pemetaan produk Lazada (SellerSku) → Aneka ----------

export type LazadaProductMap = {
  /** Kunci pemetaan: SellerSku Lazada — tingkat produk seperti product_id
   *  TikTok / productSku Blibli, satu baris menaungi semua varian. */
  lazada_sku: string;
  /** SKU internal Lazada baris terakhir yang terlihat (tampilan saja). */
  seller_sku: string;
  product_name: string;
  aneka_product_id: string;
  aneka_variant_id: string;
  aneka_product_name: string;
  enabled: number;
  updated_at: string;
};

/** Semua pemetaan produk tersimpan (kunci: lazada_sku). Urutkan tanpa
 *  COLLATE NOCASE — itu sintaks khusus SQLite dan membuat Postgres
 *  melempar "collation \"nocase\" does not exist" (halaman 500). */
export async function listLazadaProductMaps(): Promise<LazadaProductMap[]> {
  return queryAll<LazadaProductMap>(
    "SELECT * FROM lazada_product_map ORDER BY LOWER(product_name) ASC",
  );
}

/** Satu pemetaan untuk SellerSku Lazada tertentu (null = belum dipetakan). */
export async function getLazadaProductMap(
  lazadaSku: string,
): Promise<LazadaProductMap | null> {
  return (
    (await queryOne<LazadaProductMap>(
      "SELECT * FROM lazada_product_map WHERE lazada_sku = ?",
      [lazadaSku],
    )) ?? null
  );
}

/** Simpan/timpa pemetaan (upsert). `enabled` = 0 menonaktifkan eksekusi
 *  otomatis untuk produk itu tanpa menghapus barisnya. */
export async function saveLazadaProductMap(m: {
  lazada_sku: string;
  seller_sku?: string;
  product_name?: string;
  aneka_product_id: string;
  aneka_variant_id?: string;
  aneka_product_name?: string;
  enabled?: number;
}): Promise<void> {
  const nowUtc = new Date().toISOString().slice(0, 19).replace("T", " ");
  const sql =
    dbMode() === "pg"
      ? `INSERT INTO lazada_product_map (lazada_sku, seller_sku, product_name, aneka_product_id, aneka_variant_id, aneka_product_name, enabled, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (lazada_sku) DO UPDATE SET seller_sku = EXCLUDED.seller_sku, product_name = EXCLUDED.product_name,
           aneka_product_id = EXCLUDED.aneka_product_id,
           aneka_variant_id = EXCLUDED.aneka_variant_id, aneka_product_name = EXCLUDED.aneka_product_name,
           enabled = EXCLUDED.enabled, updated_at = EXCLUDED.updated_at`
      : `INSERT INTO lazada_product_map (lazada_sku, seller_sku, product_name, aneka_product_id, aneka_variant_id, aneka_product_name, enabled, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (lazada_sku) DO UPDATE SET seller_sku = excluded.seller_sku, product_name = excluded.product_name,
           aneka_product_id = excluded.aneka_product_id,
           aneka_variant_id = excluded.aneka_variant_id, aneka_product_name = excluded.aneka_product_name,
           enabled = excluded.enabled, updated_at = excluded.updated_at`;
  await queryRun(sql, [
    m.lazada_sku,
    m.seller_sku ?? "",
    m.product_name ?? "",
    m.aneka_product_id,
    m.aneka_variant_id ?? "",
    m.aneka_product_name ?? "",
    m.enabled ?? 1,
    nowUtc,
  ]);
}

/** Hapus pemetaan untuk satu SellerSku Lazada. */
export async function deleteLazadaProductMap(lazadaSku: string): Promise<void> {
  await queryRun(
    "DELETE FROM lazada_product_map WHERE lazada_sku = ?",
    [lazadaSku],
  );
}

/** Impor massal pemetaan awal (seed) Lazada → Aneka. Hanya menambah baris
 *  yang belum ada — pemetaan manual yang sudah tersimpan tidak ditimpa. */
export async function seedLazadaProductMaps(
  rows: {
    lazada_sku: string;
    seller_sku?: string;
    product_name?: string;
    aneka_product_id: string;
    aneka_variant_id?: string;
    aneka_product_name?: string;
    enabled?: number;
  }[],
): Promise<{ inserted: number; skipped: number }> {
  const nowUtc = new Date().toISOString().slice(0, 19).replace("T", " ");
  let inserted = 0;
  // Postgres: bungkus dalam satu INSERT multi-baris per 50 baris — insert
  // baris-per-baris melewati batas 60 detik fungsi Vercel untuk seed besar.
  if (dbMode() === "pg") {
    const pool = await pgPool();
    const CHUNK = 50;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const part = rows.slice(i, i + CHUNK);
      const values: string[] = [];
      const params: unknown[] = [];
      part.forEach((m, j) => {
        values.push(
          `($${j * 8 + 1}, $${j * 8 + 2}, $${j * 8 + 3}, $${j * 8 + 4}, $${j * 8 + 5}, $${j * 8 + 6}, $${j * 8 + 7}, $${j * 8 + 8})`,
        );
        params.push(
          m.lazada_sku,
          m.seller_sku ?? "",
          m.product_name ?? "",
          m.aneka_product_id,
          m.aneka_variant_id ?? "",
          m.aneka_product_name ?? "",
          m.enabled ?? 1,
          nowUtc,
        );
      });
      const r = await pool.query(
        `INSERT INTO lazada_product_map (lazada_sku, seller_sku, product_name, aneka_product_id, aneka_variant_id, aneka_product_name, enabled, updated_at)
         VALUES ${values.join(", ")}
         ON CONFLICT (lazada_sku) DO NOTHING`,
        params,
      );
      inserted += r.rowCount ?? 0;
    }
    return { inserted, skipped: rows.length - inserted };
  }

  for (const m of rows) {
    const r = (await sqliteDb())
      .prepare(
        `INSERT OR IGNORE INTO lazada_product_map (lazada_sku, seller_sku, product_name, aneka_product_id, aneka_variant_id, aneka_product_name, enabled, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        m.lazada_sku,
        m.seller_sku ?? "",
        m.product_name ?? "",
        m.aneka_product_id,
        m.aneka_variant_id ?? "",
        m.aneka_product_name ?? "",
        m.enabled ?? 1,
        nowUtc,
      );
    inserted += Number(r.changes) || 0;
  }
  return { inserted, skipped: rows.length - inserted };
}

// ---------- Eksekusi pesanan Lazada → Aneka (semi-otomatis) ----------

export type LazadaOrderExec = {
  order_id: string;
  store_code: string;
  status: string;
  payload: string;
  aneka_payment_id: string;
  aneka_order_id: string;
  detail: string;
  /** Jejak langkah eksekusi checkout Aneka (satu baris per langkah,
   *  format "WAKTU | langkah | keterangan") — ditulis per langkah supaya
   *  diagnosa tetap tersedia bila proses terputus di tengah jalan. */
  log: string;
  created_at: string;
  executed_at: string;
};

/** Satu baris eksekusi pesanan (null = belum pernah disiapkan). */
export async function getLazadaOrderExec(
  orderId: string,
): Promise<LazadaOrderExec | null> {
  return (
    (await queryOne<LazadaOrderExec>(
      "SELECT * FROM lazada_order_exec WHERE order_id = ?",
      [orderId],
    )) ?? null
  );
}

/** Semua baris eksekusi (menunggu persetujuan di depan, lalu terbaru). */
export async function listLazadaOrderExecs(): Promise<LazadaOrderExec[]> {
  return queryAll<LazadaOrderExec>(
    `SELECT * FROM lazada_order_exec
     ORDER BY CASE status WHEN 'menunggu' THEN 0 ELSE 1 END, created_at DESC`,
  );
}

/** Tambah satu baris ke jejak log eksekusi (langkah checkout Aneka). */
export async function appendLazadaOrderExecLog(
  orderId: string,
  line: string,
): Promise<void> {
  await queryRun(
    "UPDATE lazada_order_exec SET log = log || ? WHERE order_id = ?",
    ["\n" + line, orderId],
  );
}

/** Kosongkan jejak log (awal percobaan baru / persiapan ulang). */
export async function clearLazadaOrderExecLog(
  orderId: string,
): Promise<void> {
  await queryRun(
    "UPDATE lazada_order_exec SET log = '' WHERE order_id = ?",
    [orderId],
  );
}

/** Catat payment_id Aneka yang BARU dibuat ke baris eksekusi — dipanggil
 *  SEGERA setelah /payment/create sukses supaya jejak pembayaran tidak
 *  hilang bila percobaan gagal/terputus (anti pembayaran dobel saat coba
 *  ulang). Hanya menyentuh kolom aneka_payment_id. */
export async function setLazadaOrderExecPayment(
  orderId: string,
  paymentId: string,
): Promise<void> {
  await queryRun(
    "UPDATE lazada_order_exec SET aneka_payment_id = ? WHERE order_id = ?",
    [paymentId, orderId],
  );
}

/** Simpan/timpa baris eksekusi (upsert — persiapan ulang menimpa baris
 *  lama, mis. "gagal" → "menunggu" setelah percobaan berikutnya).
 *  aneka_payment_id / aneka_order_id HANYA ditimpa bila nilai baru tidak
 *  kosong (COALESCE) — pemanggil yang tidak menyebutkannya TIDAK akan
 *  menghapus jejak pembayaran (bahan pengaman anti-dobel). */
export async function saveLazadaOrderExec(e: {
  order_id: string;
  store_code?: string;
  status?: string;
  payload?: string;
  aneka_payment_id?: string;
  aneka_order_id?: string;
  detail?: string;
  executed_at?: string;
}): Promise<void> {
  const sql =
    dbMode() === "pg"
      ? `INSERT INTO lazada_order_exec (order_id, store_code, status, payload, aneka_payment_id, aneka_order_id, detail, executed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (order_id) DO UPDATE SET store_code = EXCLUDED.store_code, status = EXCLUDED.status,
           payload = EXCLUDED.payload,
           aneka_payment_id = COALESCE(NULLIF(EXCLUDED.aneka_payment_id, ''), lazada_order_exec.aneka_payment_id),
           aneka_order_id = COALESCE(NULLIF(EXCLUDED.aneka_order_id, ''), lazada_order_exec.aneka_order_id),
           detail = EXCLUDED.detail,
           executed_at = EXCLUDED.executed_at`
      : `INSERT INTO lazada_order_exec (order_id, store_code, status, payload, aneka_payment_id, aneka_order_id, detail, executed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (order_id) DO UPDATE SET store_code = excluded.store_code, status = excluded.status,
           payload = excluded.payload,
           aneka_payment_id = COALESCE(NULLIF(excluded.aneka_payment_id, ''), lazada_order_exec.aneka_payment_id),
           aneka_order_id = COALESCE(NULLIF(excluded.aneka_order_id, ''), lazada_order_exec.aneka_order_id),
           detail = excluded.detail,
           executed_at = excluded.executed_at`;
  await queryRun(sql, [
    e.order_id,
    e.store_code ?? "",
    e.status ?? "menunggu",
    e.payload ?? "",
    e.aneka_payment_id ?? "",
    e.aneka_order_id ?? "",
    e.detail ?? "",
    e.executed_at ?? "",
  ]);
}

/** Klaim atomik antrean eksekusi → status "berjalan". HANYA baris berstatus
 *  "menunggu" atau "gagal" yang boleh diklaim — mengembalikan false bila
 *  baris sedang berjalan (mencegah dua klik Setuju bersamaan membayar dua
 *  kali di Aneka) atau sudah selesai/batal. */
export async function claimLazadaOrderExecRunning(
  orderId: string,
): Promise<boolean> {
  const r = await queryOne<{ order_id: string }>(
    `UPDATE lazada_order_exec SET status = 'berjalan', detail = ''
     WHERE order_id = ? AND status IN ('menunggu', 'gagal')
     RETURNING order_id`,
    [orderId],
  );
  return !!r;
}

// ---------- Aturan harga massal (profit Aneka → ubah harga marketplace) ----------

export type AturanHargaRow = {
  id: string;
  marketplace: string;
  posisi: number;
  min_profit: number;
  max_profit: number | null;
  aksi: string;
  jenis: string;
  nilai: number;
  aktif: number;
  updated_at: string;
};

/** Daftar aturan tersimpan untuk satu marketplace, urut posisi (aturan
 *  pertama yang cocok menang). */
export async function listAturanHarga(
  marketplace: string,
): Promise<AturanHargaRow[]> {
  return queryAll<AturanHargaRow>(
    "SELECT * FROM aturan_harga WHERE marketplace = ? ORDER BY posisi ASC, id ASC",
    [marketplace],
  );
}

/** Ganti seluruh aturan satu marketplace (simpan-sekaligus dari editor UI). */
export async function replaceAturanHarga(
  marketplace: string,
  rows: {
    id: string;
    posisi: number;
    min_profit: number;
    max_profit: number | null;
    aksi: string;
    jenis: string;
    nilai: number;
    aktif: number;
  }[],
): Promise<void> {
  const nowUtc = new Date().toISOString().slice(0, 19).replace("T", " ");
  await queryRun("DELETE FROM aturan_harga WHERE marketplace = ?", [
    marketplace,
  ]);
  for (const r of rows) {
    await queryRun(
      `INSERT INTO aturan_harga (id, marketplace, posisi, min_profit, max_profit, aksi, jenis, nilai, aktif, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        r.id,
        marketplace,
        r.posisi,
        r.min_profit,
        r.max_profit,
        r.aksi,
        r.jenis,
        r.nilai,
        r.aktif,
        nowUtc,
      ],
    );
  }
}

// ---------- Log pembuatan file upload produk baru (Tahap 6) ----------

export type AnekaUploadRow = {
  id: string;
  channel: string;
  nama_file: string;
  jumlah_produk: number;
  jumlah_baris: number;
  daftar_id: string;
  keterangan: string;
  created_at: string;
};

/** Riwayat pembuatan file upload, terbaru dulu. */
export async function listAnekaUploads(limit = 30): Promise<AnekaUploadRow[]> {
  return queryAll<AnekaUploadRow>(
    "SELECT * FROM aneka_upload ORDER BY created_at DESC, id DESC LIMIT ?",
    [limit],
  );
}

/** Satu entri riwayat berdasarkan id (untuk unduh ulang). */
export async function getAnekaUploadById(
  id: string,
): Promise<AnekaUploadRow | undefined> {
  return queryOne<AnekaUploadRow>("SELECT * FROM aneka_upload WHERE id = ?", [
    id,
  ]);
}

/** Catat pembuatan file (dipanggil route setelah file berhasil dibangun). */
export async function insertAnekaUpload(r: {
  id: string;
  channel: string;
  nama_file: string;
  jumlah_produk: number;
  jumlah_baris: number;
  daftar_id: string;
  keterangan: string;
}): Promise<void> {
  await queryRun(
    `INSERT INTO aneka_upload (id, channel, nama_file, jumlah_produk, jumlah_baris, daftar_id, keterangan)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      r.id,
      r.channel,
      r.nama_file,
      r.jumlah_produk,
      r.jumlah_baris,
      r.daftar_id,
      r.keterangan,
    ],
  );
}

// ---------- Snapshot harga awal (dasar tombol Reset Semua) ----------

export type HargaSnapshotRow = {
  marketplace: string;
  sku_key: string;
  product_id: string;
  sku_id: string;
  product_name: string;
  sku_label: string;
  harga_regular: number;
  harga_sale: number;
  pickup_point_code: string;
  updated_at: string;
};

/** Semua snapshot harga untuk satu marketplace. */
export async function listHargaSnapshot(
  marketplace: string,
): Promise<HargaSnapshotRow[]> {
  return queryAll<HargaSnapshotRow>(
    "SELECT * FROM harga_snapshot WHERE marketplace = ? ORDER BY LOWER(product_name) ASC",
    [marketplace],
  );
}

/** Simpan snapshot HANYA bila belum ada — "harga awal" = harga sebelum
 *  perubahan massal PERTAMA, tidak boleh ditimpa perubahan berikutnya. */
export async function insertHargaSnapshot(s: {
  marketplace: string;
  sku_key: string;
  product_id: string;
  sku_id: string;
  product_name: string;
  sku_label: string;
  harga_regular: number;
  harga_sale: number;
  pickup_point_code: string;
}): Promise<void> {
  const nowUtc = new Date().toISOString().slice(0, 19).replace("T", " ");
  const sql =
    dbMode() === "pg"
      ? `INSERT INTO harga_snapshot (marketplace, sku_key, product_id, sku_id, product_name, sku_label, harga_regular, harga_sale, pickup_point_code, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (marketplace, sku_key) DO NOTHING`
      : `INSERT OR IGNORE INTO harga_snapshot (marketplace, sku_key, product_id, sku_id, product_name, sku_label, harga_regular, harga_sale, pickup_point_code, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  await queryRun(sql, [
    s.marketplace,
    s.sku_key,
    s.product_id,
    s.sku_id,
    s.product_name,
    s.sku_label,
    s.harga_regular,
    s.harga_sale,
    s.pickup_point_code,
    nowUtc,
  ]);
}

/** Hapus snapshot satu SKU (dipanggil setelah harga berhasil dipulihkan). */
export async function deleteHargaSnapshot(
  marketplace: string,
  skuKey: string,
): Promise<void> {
  await queryRun(
    "DELETE FROM harga_snapshot WHERE marketplace = ? AND sku_key = ?",
    [marketplace, skuKey],
  );
}

/** Hapus banyak snapshot sekaligus (reset massal) — satu query per potongan,
 *  bukan satu kueri per baris, supaya reset ratusan baris tidak melewati
 *  batas waktu serverless. */
export async function deleteHargaSnapshotBanyak(
  marketplace: string,
  skuKeys: string[],
): Promise<void> {
  if (skuKeys.length === 0) return;
  for (let i = 0; i < skuKeys.length; i += 500) {
    const chunk = skuKeys.slice(i, i + 500);
    const marks = chunk.map(() => "?").join(", ");
    await queryRun(
      `DELETE FROM harga_snapshot WHERE marketplace = ? AND sku_key IN (${marks})`,
      [marketplace, ...chunk],
    );
  }
}

// ---------- Harga jual KTD Store (override rekomendasi jual Aneka) ----------

export type KtdStoreHargaRow = {
  aneka_id: string;
  harga: number;
  updated_at: string;
};

/** Semua harga jual override KTD Store (biasanya hanya sebagian katalog). */
export async function listKtdStoreHarga(): Promise<KtdStoreHargaRow[]> {
  return queryAll<KtdStoreHargaRow>(
    "SELECT * FROM ktd_store_harga ORDER BY LOWER(aneka_id) ASC",
  );
}

/** Simpan/timpa harga jual override (upsert per aneka_id). */
export async function upsertKtdStoreHarga(
  rows: { aneka_id: string; harga: number }[],
): Promise<void> {
  if (rows.length === 0) return;
  const nowUtc = new Date().toISOString().slice(0, 19).replace("T", " ");
  for (const r of rows) {
    await queryRun(
      `INSERT INTO ktd_store_harga (aneka_id, harga, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (aneka_id) DO UPDATE SET harga = excluded.harga, updated_at = excluded.updated_at`,
      [r.aneka_id, r.harga, nowUtc],
    );
  }
}

/** Hapus override (harga kembali ke rekomendasi jual Aneka).
 *  Dipotong per 100 id — batas variabel terikat SQLite (999). */
export async function deleteKtdStoreHarga(ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const marks = chunk.map(() => "?").join(", ");
    await queryRun(
      `DELETE FROM ktd_store_harga WHERE aneka_id IN (${marks})`,
      chunk,
    );
  }
}

// ---------- Stok KTD Store (override stok katalog Aneka) ----------

export type KtdStoreStokRow = {
  aneka_id: string;
  stok: number;
  updated_at: string;
};

/** Semua override stok KTD Store (biasanya hanya produk yang terjual). */
export async function listKtdStoreStok(): Promise<KtdStoreStokRow[]> {
  return queryAll<KtdStoreStokRow>(
    "SELECT * FROM ktd_store_stok ORDER BY LOWER(aneka_id) ASC",
  );
}

/** Simpan/timpa override stok (upsert per aneka_id). */
export async function upsertKtdStoreStok(
  rows: { aneka_id: string; stok: number }[],
): Promise<void> {
  if (rows.length === 0) return;
  const nowUtc = new Date().toISOString().slice(0, 19).replace("T", " ");
  for (const r of rows) {
    await queryRun(
      `INSERT INTO ktd_store_stok (aneka_id, stok, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (aneka_id) DO UPDATE SET stok = excluded.stok, updated_at = excluded.updated_at`,
      [r.aneka_id, r.stok, nowUtc],
    );
  }
}

/** Hapus override stok (tampilan kembali ke stok katalog Aneka). */
export async function deleteKtdStoreStok(ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const marks = chunk.map(() => "?").join(", ");
    await queryRun(
      `DELETE FROM ktd_store_stok WHERE aneka_id IN (${marks})`,
      chunk,
    );
  }
}

// ---------- Penyesuaian stok otomatis (order selesai → kurangi) ----------

export type StokPenyesuaianRow = {
  id: string;
  channel: string;
  order_id: string;
  sku_key: string;
  aneka_id: string;
  nama: string;
  qty: number;
  tiktok_done: number;
  blibli_done: number;
  lazada_done: number;
  ktd_done: number;
  detail: string;
  created_at: string;
};

/** Kanalkanal tempat stok bisa dikurangi otomatis. */
export type StokKanal = "tiktok" | "blibli" | "lazada" | "ktd";

/** Sisipkan satu kejadian penjualan selesai (idempoten — baris yang sudah
 *  ada tidak diubah). Kembalikan true bila baris ini baru. */
export async function insertStokPenyesuaian(row: {
  id: string;
  channel: string;
  order_id: string;
  sku_key: string;
  aneka_id: string;
  nama: string;
  qty: number;
}): Promise<boolean> {
  if (dbMode() === "pg") {
    const r = await (
      await pgPool()
    ).query(
      `INSERT INTO stok_penyesuaian
       (id, channel, order_id, sku_key, aneka_id, nama, qty)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [row.id, row.channel, row.order_id, row.sku_key, row.aneka_id, row.nama, row.qty],
    );
    return (r.rowCount ?? 0) > 0;
  }
  const r = (await sqliteDb())
    .prepare(
      `INSERT OR IGNORE INTO stok_penyesuaian
       (id, channel, order_id, sku_key, aneka_id, nama, qty)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.channel,
      row.order_id,
      row.sku_key,
      row.aneka_id,
      row.nama,
      row.qty,
    );
  return Number(r.changes) > 0;
}

/** Kejadian yang masih punya kanal belum diterapkan (terlama lebih dulu) —
 *  antrean kerja hook order selesai. */
export async function listStokPenyesuaianTerbuka(
  limit = 100,
): Promise<StokPenyesuaianRow[]> {
  return queryAll<StokPenyesuaianRow>(
    `SELECT * FROM stok_penyesuaian
     WHERE tiktok_done = 0 OR blibli_done = 0 OR lazada_done = 0 OR ktd_done = 0
     ORDER BY created_at ASC, id ASC
     LIMIT ?`,
    [limit],
  );
}

/** Riwayat terbaru untuk halaman Sinkron Stok. */
export async function listStokPenyesuaianTerbaru(
  limit = 100,
): Promise<StokPenyesuaianRow[]> {
  return queryAll<StokPenyesuaianRow>(
    `SELECT * FROM stok_penyesuaian ORDER BY created_at DESC, id DESC LIMIT ?`,
    [limit],
  );
}

/** Tandai satu kanal sudah diterapkan untuk satu kejadian. `catatan` opsional
 *  ditambahkan ke kolom detail (ringkas, maks 500 karakter). */
export async function tandaiStokKanalSelesai(
  id: string,
  kanal: StokKanal,
  catatan = "",
): Promise<void> {
  const kolom = `${kanal}_done`;
  await queryRun(
    `UPDATE stok_penyesuaian
     SET ${kolom} = 1,
         detail = CASE WHEN ? = '' THEN detail
                       ELSE substr(detail || ' | ' || ?, 1, 500) END
     WHERE id = ?`,
    [catatan, catatan, id],
  );
}
