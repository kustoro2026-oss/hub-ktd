// Database KTD Hub — dua backend dengan API async yang sama:
//
// - Produksi (Vercel): Postgres via driver serverless Neon. Filesystem
//   serverless Vercel bersifat sementara, jadi SQLite tidak bisa dipakai di
//   sana. Koneksi diambil dari env DATABASE_URL (atau POSTGRES_URL bawaan
//   Vercel Postgres) — hubungkan database lewat dashboard Vercel → Storage.
// - Pengembangan lokal: SQLite via node:sqlite (file data/ktd-hub.db,
//   folder ini di-gitignore).
//
// Semua fungsi bersifat async dan selalu mengembalikan objek biasa — React
// menolak meneruskan baris berprototipe null dari node:sqlite ke Client
// Component, jadi baris disalin dulu.
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { Pool } from "@neondatabase/serverless";

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
  kind: "general" | "order" | "ad" | "faq" | "question" | "proof";
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
  return process.env.DATABASE_URL || process.env.POSTGRES_URL
    ? "pg"
    : "sqlite";
}

function pgUrl(): string {
  return (process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "").trim();
}

// node:sqlite memakai placeholder `?`; Postgres memakai $1, $2, ... — tulis
// query sekali dengan `?` lalu terjemahkan untuk Postgres.
function toPg(query: string): string {
  let i = 0;
  return query.replace(/\?/g, () => `$${++i}`);
}

async function pgPool(): Promise<Pool> {
  if (!g.__ktdHubPg) {
    const { Pool } = await import("@neondatabase/serverless");
    const pool = new Pool({ connectionString: pgUrl() });
    await migratePg(pool);
    g.__ktdHubPg = pool;
  }
  return g.__ktdHubPg;
}

async function sqliteDb(): Promise<DatabaseSync> {
  if (!g.__ktdHubSqlite) {
    if (process.env.VERCEL) {
      throw new Error(
        "KTD Hub di Vercel butuh DATABASE_URL (Postgres/Neon) — hubungkan database di dashboard Vercel → Storage, lalu redeploy.",
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
  `);

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
  for (const m of rows) {
    if (dbMode() === "pg") {
      const r = await (
        await pgPool()
      ).query(
        toPg(
          `INSERT INTO aneka_product_map (tiktok_product_id, tiktok_product_name, tiktok_sku, aneka_product_id, aneka_variant_id, aneka_product_name, enabled, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (tiktok_product_id) DO NOTHING`,
        ),
        [
          m.tiktok_product_id,
          m.tiktok_product_name ?? "",
          m.tiktok_sku ?? "",
          m.aneka_product_id,
          m.aneka_variant_id ?? "",
          m.aneka_product_name ?? "",
          m.enabled ?? 1,
          nowUtc,
        ],
      );
      inserted += r.rowCount ?? 0;
    } else {
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

/** Simpan/timpa baris eksekusi (upsert — persiapan ulang menimpa baris
 *  lama, mis. "gagal" → "menunggu" setelah percobaan berikutnya). */
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
           payload = EXCLUDED.payload, aneka_payment_id = EXCLUDED.aneka_payment_id,
           aneka_order_id = EXCLUDED.aneka_order_id, detail = EXCLUDED.detail,
           executed_at = EXCLUDED.executed_at`
      : `INSERT INTO tiktok_order_exec (order_id, shop_id, status, payload, aneka_payment_id, aneka_order_id, detail, executed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (order_id) DO UPDATE SET shop_id = excluded.shop_id, status = excluded.status,
           payload = excluded.payload, aneka_payment_id = excluded.aneka_payment_id,
           aneka_order_id = excluded.aneka_order_id, detail = excluded.detail,
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
