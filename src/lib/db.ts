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

export type Broadcast = {
  id: number;
  name: string;
  template: string;
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
  status: "pending" | "sent" | "delivered" | "read" | "failed";
  error: string;
  wa_id: string;
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
  `);

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
  `);

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

export async function deleteContact(id: number): Promise<void> {
  await queryRun("DELETE FROM contacts WHERE id = ?", [id]);
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
): Promise<Broadcast> {
  const bc = await queryOne<Broadcast>(
    "INSERT INTO broadcasts (name, template, total) VALUES (?, ?, ?) RETURNING *",
    [name.trim(), template, items.length],
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
    "UPDATE broadcast_items SET status = ?, error = ?, wa_id = ? WHERE id = ?",
    [status, error, waId, id],
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
