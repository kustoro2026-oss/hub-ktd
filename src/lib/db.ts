// Database KTD Hub — SQLite lokal via node:sqlite (bawaan Node, tanpa native
// module). File data disimpan di data/ktd-hub.db (folder ini di-gitignore).
//
// Catatan untuk deploy serverless (Vercel): filesystem di sana bersifat
// sementara, jadi driver ini hanya untuk pengembangan lokal. Untuk produksi
// ganti ke Postgres (Neon/Supabase) — skema SQL-nya sama, hanya koneksinya
// yang berbeda.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export type Contact = {
  id: number;
  name: string;
  phone: string;
  note: string;
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
  kind: "general" | "order" | "ad";
  ad_id: string;
  created_at: string;
};

const g = globalThis as unknown as { __ktdHubDb?: DatabaseSync };

function dbPath(): string {
  const dir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "ktd-hub.db");
}

export function getDb(): DatabaseSync {
  if (!g.__ktdHubDb) {
    const db = new DatabaseSync(dbPath());
    db.exec("PRAGMA journal_mode = WAL;");
    migrate(db);
    g.__ktdHubDb = db;
  }
  return g.__ktdHubDb;
}

function migrate(db: DatabaseSync) {
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
      template TEXT NOT NULL DEFAULT 'info_promo',
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
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
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
}

// ---------- Kontak ----------

// Baris dari node:sqlite berprototipe null — React menolak meneruskan objek
// semacam itu dari Server Component ke Client Component. Salin ke objek biasa
// sebelum dikembalikan.
function plainRows<T>(rows: unknown[]): T[] {
  return rows.map((r) => ({ ...(r as Record<string, unknown>) })) as T[];
}

export function listContacts(): Contact[] {
  return plainRows<Contact>(
    getDb().prepare("SELECT * FROM contacts ORDER BY id DESC").all(),
  );
}

export function countContacts(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM contacts")
    .get() as unknown as { n: number };
  return row.n;
}

export function addContact(name: string, phone: string, note = ""): Contact {
  const info = getDb()
    .prepare("INSERT INTO contacts (name, phone, note) VALUES (?, ?, ?)")
    .run(name.trim(), phone, note.trim());
  return {
    ...(getDb()
      .prepare("SELECT * FROM contacts WHERE id = ?")
      .get(info.lastInsertRowid) as object),
  } as Contact;
}

export function deleteContact(id: number): void {
  getDb().prepare("DELETE FROM contacts WHERE id = ?").run(id);
}

// ---------- Broadcast ----------

export function listBroadcasts(): Broadcast[] {
  return plainRows<Broadcast>(
    getDb().prepare("SELECT * FROM broadcasts ORDER BY id DESC").all(),
  );
}

export function getBroadcast(id: number): Broadcast | undefined {
  const row = getDb().prepare("SELECT * FROM broadcasts WHERE id = ?").get(id);
  return row ? ({ ...(row as object) } as Broadcast) : undefined;
}

export function listBroadcastItems(broadcastId: number): BroadcastItem[] {
  return plainRows<BroadcastItem>(
    getDb()
      .prepare("SELECT * FROM broadcast_items WHERE broadcast_id = ? ORDER BY id")
      .all(broadcastId),
  );
}

export function createBroadcastWithItems(
  name: string,
  template: string,
  items: { contactId: number | null; phone: string }[],
): Broadcast {
  const db = getDb();
  const info = db
    .prepare(
      "INSERT INTO broadcasts (name, template, total) VALUES (?, ?, ?)",
    )
    .run(name.trim(), template, items.length);
  const broadcastId = Number(info.lastInsertRowid);
  const ins = db.prepare(
    "INSERT INTO broadcast_items (broadcast_id, contact_id, phone) VALUES (?, ?, ?)",
  );
  for (const it of items) {
    ins.run(broadcastId, it.contactId, it.phone);
  }
  return getBroadcast(broadcastId) as Broadcast;
}

export function setBroadcastStatus(
  id: number,
  status: Broadcast["status"],
  sent: number,
  failed: number,
): void {
  getDb()
    .prepare("UPDATE broadcasts SET status = ?, sent = ?, failed = ? WHERE id = ?")
    .run(status, sent, failed, id);
}

export function pendingBroadcastItems(
  broadcastId: number,
  limit = 40,
): BroadcastItem[] {
  return getDb()
    .prepare(
      "SELECT * FROM broadcast_items WHERE broadcast_id = ? AND status = 'pending' ORDER BY id LIMIT ?",
    )
    .all(broadcastId, limit) as unknown as BroadcastItem[];
}

export function markBroadcastItem(
  id: number,
  status: "sent" | "failed",
  error = "",
  waId = "",
): void {
  getDb()
    .prepare(
      "UPDATE broadcast_items SET status = ?, error = ?, wa_id = ? WHERE id = ?",
    )
    .run(status, error, waId, id);
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
export function applyBroadcastDeliveryStatus(
  waId: string,
  status: string,
  error = "",
): void {
  if (!["sent", "delivered", "read", "failed"].includes(status)) return;
  const db = getDb();
  const row = db
    .prepare("SELECT id, status FROM broadcast_items WHERE wa_id = ?")
    .get(waId) as unknown as { id: number; status: string } | undefined;
  if (!row) return;
  const current = DELIVERY_RANK[row.status] ?? 0;
  if (status === "failed") {
    if (current >= DELIVERY_RANK.delivered) return; // sudah sampai — abaikan
    db.prepare(
      "UPDATE broadcast_items SET status = 'failed', error = ? WHERE id = ?",
    ).run(error || "Meta gagal mengirim pesan", row.id);
    return;
  }
  const next = DELIVERY_RANK[status] ?? 0;
  if (next <= current) return; // status tidak boleh turun
  db.prepare("UPDATE broadcast_items SET status = ? WHERE id = ?").run(
    status,
    row.id,
  );
}

export function broadcastProgress(id: number): {
  sent: number;
  failed: number;
  pending: number;
} {
  const row = getDb()
    .prepare(
      `SELECT
        SUM(CASE WHEN status IN ('sent', 'delivered', 'read') THEN 1 ELSE 0 END) AS sent,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
      FROM broadcast_items WHERE broadcast_id = ?`,
    )
    .get(id) as unknown as {
    sent: number | null;
    failed: number | null;
    pending: number | null;
  };
  return {
    sent: row.sent ?? 0,
    failed: row.failed ?? 0,
    pending: row.pending ?? 0,
  };
}

// ---------- Pesan masuk ----------

export function insertMessage(m: Omit<InboundMessage, "created_at">): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO messages (id, wa_from, body, reply, kind, ad_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(m.id, m.wa_from, m.body, m.reply, m.kind, m.ad_id);
}

export function listMessages(limit = 100): InboundMessage[] {
  return plainRows<InboundMessage>(
    getDb()
      .prepare("SELECT * FROM messages ORDER BY created_at DESC LIMIT ?")
      .all(limit),
  );
}

export function countMessages(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM messages")
    .get() as unknown as { n: number };
  return row.n;
}
