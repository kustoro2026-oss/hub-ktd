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

export type EmailContact = {
  id: number;
  name: string;
  email: string;
  note: string;
  group_id: number; // wajib > 0 — tidak ada daftar umum
  status: string; // subscribed / unsubscribed / bounced
  created_at: string;
};

export type EmailGroup = {
  id: number;
  name: string;
  member_count: number;
  subscribed_count: number;
  created_at: string;
};

export type EmailTemplate = {
  id: number;
  name: string;
  subject: string;
  html_body: string;
  lang: string;
  created_at: string;
};

export type EmailCampaign = {
  id: number;
  name: string;
  template_id: number;
  group_id: number | null;
  smtp_account_id: number;
  subject: string;
  vars: string;
  scheduled_at: string;
  next_run_at: string;
  pause_reason: string;
  batch_sent: number;
  started_at: string;
  total: number;
  sent: number;
  failed: number;
  opened: number;
  clicked: number;
  bounced: number;
  unsubscribed: number;
  status: "draft" | "sending" | "paused" | "done";
  created_at: string;
};

export type EmailSmtpAccount = {
  id: number;
  name: string;
  host: string;
  port: number;
  secure: number; // 1 = SSL langsung (465), 0 = STARTTLS (587)
  username: string;
  password: string;
  sender_email: string;
  sender_name: string;
  batch_size: number;
  batch_pause_seconds: number;
  delay_ms: number;
  daily_limit: number;
  active: number;
  created_at: string;
};

export type EmailImportRun = {
  id: number;
  group_id: number;
  group_name: string;
  total_lines: number;
  valid_lines: number;
  unique_emails: number;
  added: number;
  updated: number;
  moved: number;
  duplicates: number;
  invalid: number;
  detail: string;
  created_at: string;
};

export type EmailCampaignItem = {
  id: number;
  campaign_id: number;
  contact_id: number | null;
  smtp_account_id: number;
  name: string;
  email: string;
  status:
    | "pending"
    | "queued"
    | "sent"
    | "delivered"
    | "opened"
    | "clicked"
    | "failed";
  error: string;
  message_id: string;
  claimed_at: string;
  sent_at: string;
  created_at: string;
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

// ---------- Email Marketing: benih template bawaan ----------
// Tujuh template siap pakai dimasukkan saat tabel email_templates masih
// kosong (sekali saja) — pengguna bebas mengubah/menghapusnya.
const EMAIL_SEED_TEMPLATES: {
  name: string;
  subject: string;
  html: string;
}[] = [
  {
    name: "Promo Diskon",
    subject: "Promo Spesial untuk {{nama}} 🎉",
    html: `<div style="background:#f1f5f9;padding:24px 12px;">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
<div style="background:#10b981;padding:20px 24px;"><span style="color:#fff;font-size:20px;font-weight:700;">KTD Store</span></div>
<div style="padding:24px;">
<p style="margin:0 0 12px;font-size:16px;color:#0f172a;">Halo <strong>{{nama}}</strong>,</p>
<p style="margin:0 0 12px;font-size:14px;color:#334155;line-height:1.6;">Ada promo spesial menanti Anda! Diskon hingga <strong>50%</strong> untuk produk pilihan minggu ini — hanya berlaku selama stok masih ada.</p>
<p style="margin:0 0 12px;font-size:14px;color:#334155;line-height:1.6;">Gunakan kode promo <strong>{{kode}}</strong> saat checkout.</p>
<p style="margin:24px 0;"><a href="{{link}}" style="background:#10b981;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;display:inline-block;">Lihat Promo Sekarang</a></p>
<p style="margin:0;font-size:12px;color:#94a3b8;">Syarat &amp; ketentuan berlaku. Stok terbatas.</p>
</div>
</div>
</div>`,
  },
  {
    name: "Produk Baru",
    subject: "Produk Baru Sudah Hadir di KTD Store!",
    html: `<div style="background:#f1f5f9;padding:24px 12px;">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
<div style="background:#10b981;padding:20px 24px;"><span style="color:#fff;font-size:20px;font-weight:700;">KTD Store</span></div>
<div style="padding:24px;">
<p style="margin:0 0 12px;font-size:16px;color:#0f172a;">Halo <strong>{{nama}}</strong>,</p>
<p style="margin:0 0 12px;font-size:14px;color:#334155;line-height:1.6;"><strong>{{produk}}</strong> baru saja masuk katalog kami dan kami rasa Anda akan menyukainya.</p>
<p style="margin:0 0 12px;font-size:14px;color:#334155;line-height:1.6;">Stok awal terbatas — jangan sampai kehabisan.</p>
<p style="margin:24px 0;"><a href="{{link}}" style="background:#10b981;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;display:inline-block;">Lihat Produk</a></p>
</div>
</div>
</div>`,
  },
  {
    name: "Keranjang Terbengkalai",
    subject: "{{nama}}, Keranjang Anda Masih Menunggu",
    html: `<div style="background:#f1f5f9;padding:24px 12px;">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
<div style="background:#10b981;padding:20px 24px;"><span style="color:#fff;font-size:20px;font-weight:700;">KTD Store</span></div>
<div style="padding:24px;">
<p style="margin:0 0 12px;font-size:16px;color:#0f172a;">Halo <strong>{{nama}}</strong>,</p>
<p style="margin:0 0 12px;font-size:14px;color:#334155;line-height:1.6;"><strong>{{produk}}</strong> masih tersimpan di keranjang belanja Anda.</p>
<p style="margin:0 0 12px;font-size:14px;color:#334155;line-height:1.6;">Selesaikan pesanan Anda sekarang — barang populer bisa cepat habis.</p>
<p style="margin:24px 0;"><a href="{{link}}" style="background:#10b981;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;display:inline-block;">Lanjutkan Belanja</a></p>
</div>
</div>
</div>`,
  },
  {
    name: "Ulang Tahun Pelanggan",
    subject: "Selamat Ulang Tahun, {{nama}}! 🎂",
    html: `<div style="background:#f1f5f9;padding:24px 12px;">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
<div style="background:#10b981;padding:20px 24px;"><span style="color:#fff;font-size:20px;font-weight:700;">KTD Store</span></div>
<div style="padding:24px;">
<p style="margin:0 0 12px;font-size:16px;color:#0f172a;">Halo <strong>{{nama}}</strong>,</p>
<p style="margin:0 0 12px;font-size:14px;color:#334155;line-height:1.6;">Selamat ulang tahun! Semoga hari Anda penuh kebahagiaan. Sebagai hadiah, kami berikan kode spesial <strong>{{kode}}</strong> untuk belanja berikutnya.</p>
<p style="margin:24px 0;"><a href="{{link}}" style="background:#10b981;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;display:inline-block;">Ambil Hadiah Saya</a></p>
<p style="margin:0;font-size:12px;color:#94a3b8;">Kode berlaku 7 hari sejak email ini dikirim.</p>
</div>
</div>
</div>`,
  },
  {
    name: "Minta Ulasan",
    subject: "Bagaimana Pengalaman Belanja Anda, {{nama}}?",
    html: `<div style="background:#f1f5f9;padding:24px 12px;">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
<div style="background:#10b981;padding:20px 24px;"><span style="color:#fff;font-size:20px;font-weight:700;">KTD Store</span></div>
<div style="padding:24px;">
<p style="margin:0 0 12px;font-size:16px;color:#0f172a;">Halo <strong>{{nama}}</strong>,</p>
<p style="margin:0 0 12px;font-size:14px;color:#334155;line-height:1.6;">Terima kasih sudah berbelanja di KTD Store. Penilaian Anda membantu kami melayani lebih baik.</p>
<p style="margin:0 0 12px;font-size:14px;color:#334155;line-height:1.6;">Luangkan 1 menit untuk berbagi pengalaman Anda.</p>
<p style="margin:24px 0;"><a href="{{link}}" style="background:#10b981;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;display:inline-block;">Tulis Ulasan</a></p>
</div>
</div>
</div>`,
  },
  {
    name: "Newsletter Bulanan",
    subject: "Kabar Terbaru KTD Store untuk {{nama}}",
    html: `<div style="background:#f1f5f9;padding:24px 12px;">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
<div style="background:#10b981;padding:20px 24px;"><span style="color:#fff;font-size:20px;font-weight:700;">KTD Store</span></div>
<div style="padding:24px;">
<p style="margin:0 0 12px;font-size:16px;color:#0f172a;">Halo <strong>{{nama}}</strong>,</p>
<p style="margin:0 0 12px;font-size:14px;color:#334155;line-height:1.6;">Inilah rangkuman kabar terbaru dari KTD Store: promo berjalan, produk baru, dan tips belanja hemat bulan ini.</p>
<p style="margin:24px 0;"><a href="{{link}}" style="background:#10b981;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;display:inline-block;">Baca Selengkapnya</a></p>
</div>
</div>
</div>`,
  },
  {
    name: "Yuk Kenalan KTD Store",
    subject: "🚀 Yuk, Kenalan dengan KTD STORE !",
    html: `<div style="background:#eef2f7;padding:28px 12px;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
<div style="background:#065f46;padding:26px 24px 22px;text-align:center;border-bottom:4px solid #10b981;">
<div style="font-size:24px;font-weight:800;color:#ffffff;letter-spacing:2px;">KTD STORE</div>
<div style="font-size:12px;color:#a7f3d0;margin-top:6px;letter-spacing:1px;">Satu Website, Semua Kebutuhan</div>
</div>
<div style="padding:30px 24px 8px;text-align:center;">
<div style="font-size:52px;line-height:1;">🚀</div>
<h1 style="margin:16px 0 8px;font-size:22px;font-weight:800;color:#0f172a;line-height:1.35;">Yuk, Kenalan dengan KTD STORE!</h1>
<p style="margin:0;font-size:15px;color:#475569;">Halo, apa kabar? 👋</p>
</div>
<div style="padding:14px 24px 4px;text-align:center;">
<p style="margin:0 0 14px;font-size:15px;color:#334155;line-height:1.7;">Sekarang saatnya mengenal <strong style="color:#059669;">KTD STORE</strong> 🎉</p>
<p style="margin:0;font-size:14px;color:#475569;line-height:1.7;">Temukan berbagai pilihan produk, layanan top up game, dan isi saldo dalam satu website.</p>
</div>
<div style="padding:16px 24px 8px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:8px;">
<tr>
<td width="33%" align="center" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px 8px;">
<div style="font-size:28px;line-height:1;">🛍️</div>
<div style="font-size:13px;font-weight:700;color:#065f46;margin-top:10px;">Produk Pilihan</div>
<div style="font-size:11px;color:#64748b;margin-top:3px;">kebutuhan harian</div>
</td>
<td width="33%" align="center" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px 8px;">
<div style="font-size:28px;line-height:1;">🎮</div>
<div style="font-size:13px;font-weight:700;color:#065f46;margin-top:10px;">Top Up Game</div>
<div style="font-size:11px;color:#64748b;margin-top:3px;">cepat &amp; mudah</div>
</td>
<td width="33%" align="center" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px 8px;">
<div style="font-size:28px;line-height:1;">💳</div>
<div style="font-size:13px;font-weight:700;color:#065f46;margin-top:10px;">Isi Saldo</div>
<div style="font-size:11px;color:#64748b;margin-top:3px;">praktis &amp; aman</div>
</td>
</tr>
</table>
</div>
<div style="padding:8px 24px 22px;text-align:center;">
<p style="margin:0 0 20px;font-size:14px;color:#475569;line-height:1.7;">Kami mengundang Anda untuk melihat layanan yang tersedia dan menemukan yang sesuai dengan kebutuhan Anda.</p>
<a href="https://toko.kustoro2026.com" style="background:#10b981;color:#ffffff;text-decoration:none;padding:14px 34px;border-radius:999px;font-size:16px;font-weight:700;display:inline-block;border-bottom:3px solid #059669;">👉 Mulai Kunjungi KTD STORE</a>
<div style="margin-top:14px;font-size:12px;color:#94a3b8;">atau buka langsung: <a href="https://toko.kustoro2026.com" style="color:#059669;font-weight:600;">toko.kustoro2026.com</a></div>
</div>
<div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:18px 24px;text-align:center;">
<p style="margin:0 0 4px;font-size:14px;color:#334155;">Terima kasih telah berkunjung! ❤️</p>
<p style="margin:0;font-size:13px;font-weight:700;color:#059669;">Tim KTD STORE</p>
</div>
</div>
</div>`,
  },
];

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

    CREATE TABLE IF NOT EXISTS lazada_web_sessions (
      seller_id TEXT PRIMARY KEY,
      cookie_text TEXT NOT NULL DEFAULT '',
      tk_expires_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS lazada_awb_jobs (
      order_id TEXT PRIMARY KEY,
      order_item_ids TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      pdf_base64 TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS lazada_bridge_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      heartbeat_at TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
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

    -- Afiliasi: jurnal undangan target collaboration (satu baris per kreator).
    CREATE TABLE IF NOT EXISTS affiliate_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id TEXT NOT NULL DEFAULT '',
      collaboration_id TEXT NOT NULL DEFAULT '',
      creator_open_id TEXT NOT NULL DEFAULT '',
      username TEXT NOT NULL DEFAULT '',
      nickname TEXT NOT NULL DEFAULT '',
      product_ids TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'sent',
      error_code TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_affiliate_invites_creator
      ON affiliate_invites (creator_open_id);
    CREATE INDEX IF NOT EXISTS idx_affiliate_invites_created
      ON affiliate_invites (created_at DESC);

    -- Afiliasi: cache kreator hasil pencarian marketplace (kolam kandidat cron).
    CREATE TABLE IF NOT EXISTS affiliate_creator_cache (
      creator_open_id TEXT PRIMARY KEY,
      username TEXT NOT NULL DEFAULT '',
      nickname TEXT NOT NULL DEFAULT '',
      avatar_url TEXT NOT NULL DEFAULT '',
      follower_count INTEGER NOT NULL DEFAULT 0,
      data TEXT NOT NULL DEFAULT '',
      invited_status TEXT NOT NULL DEFAULT '',
      cached_at TEXT NOT NULL DEFAULT ''
    );

    -- Afiliasi: pengaturan kunci–nilai (cap harian, filter, produk, komisi).
    CREATE TABLE IF NOT EXISTS affiliate_settings (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );

    -- Email Marketing: kontak, grup, template, kampanye, dan log event.
    CREATE TABLE IF NOT EXISTS email_contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL UNIQUE,
      note TEXT NOT NULL DEFAULT '',
      group_id INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'subscribed',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    -- Indeks group_id dibuat di blok migrasi setelah ALTER TABLE, karena
    -- tabel lama belum punya kolom itu saat blok DDL ini dijalankan.

    CREATE TABLE IF NOT EXISTS email_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS email_group_members (
      group_id INTEGER NOT NULL,
      contact_id INTEGER NOT NULL,
      PRIMARY KEY (group_id, contact_id)
    );

    CREATE TABLE IF NOT EXISTS email_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      subject TEXT NOT NULL DEFAULT '',
      html_body TEXT NOT NULL DEFAULT '',
      lang TEXT NOT NULL DEFAULT 'id',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS email_campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      template_id INTEGER NOT NULL DEFAULT 0,
      group_id INTEGER,
      smtp_account_id INTEGER NOT NULL DEFAULT 0,
      subject TEXT NOT NULL DEFAULT '',
      vars TEXT NOT NULL DEFAULT '',
      scheduled_at TEXT NOT NULL DEFAULT '',
      next_run_at TEXT NOT NULL DEFAULT '',
      pause_reason TEXT NOT NULL DEFAULT '',
      batch_sent INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL DEFAULT '',
      total INTEGER NOT NULL DEFAULT 0,
      sent INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      opened INTEGER NOT NULL DEFAULT 0,
      clicked INTEGER NOT NULL DEFAULT 0,
      bounced INTEGER NOT NULL DEFAULT 0,
      unsubscribed INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS email_campaign_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      contact_id INTEGER,
      smtp_account_id INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT NOT NULL DEFAULT '',
      message_id TEXT NOT NULL DEFAULT '',
      claimed_at TEXT NOT NULL DEFAULT '',
      sent_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_email_items_campaign
      ON email_campaign_items (campaign_id);

    CREATE TABLE IF NOT EXISTS email_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event TEXT NOT NULL DEFAULT '',
      campaign_item_id INTEGER NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_email_events_item
      ON email_events (campaign_item_id);

    -- Email Marketing: pengaturan SMTP kunci–nilai (akun Gmail bisa
    -- diganti dari UI tanpa menyentuh env).
    CREATE TABLE IF NOT EXISTS email_settings (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );

    -- Email Marketing: beberapa akun SMTP dengan aturan kirim masing-masing
    -- (batch, jeda, batas harian). Kredensial di DB supaya akun bisa
    -- diganti dari UI tanpa redeploy.
    CREATE TABLE IF NOT EXISTS email_smtp_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      host TEXT NOT NULL DEFAULT '',
      port INTEGER NOT NULL DEFAULT 465,
      secure INTEGER NOT NULL DEFAULT 1,
      username TEXT NOT NULL DEFAULT '',
      password TEXT NOT NULL DEFAULT '',
      sender_email TEXT NOT NULL DEFAULT '',
      sender_name TEXT NOT NULL DEFAULT 'KTD Store',
      batch_size INTEGER NOT NULL DEFAULT 40,
      batch_pause_seconds INTEGER NOT NULL DEFAULT 60,
      delay_ms INTEGER NOT NULL DEFAULT 1000,
      daily_limit INTEGER NOT NULL DEFAULT 500,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    -- Riwayat import kontak — untuk memastikan angka laporan bisa
    -- direkonsiliasi dengan isi grup.
    CREATE TABLE IF NOT EXISTS email_import_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL DEFAULT 0,
      group_name TEXT NOT NULL DEFAULT '',
      total_lines INTEGER NOT NULL DEFAULT 0,
      valid_lines INTEGER NOT NULL DEFAULT 0,
      unique_emails INTEGER NOT NULL DEFAULT 0,
      added INTEGER NOT NULL DEFAULT 0,
      updated INTEGER NOT NULL DEFAULT 0,
      moved INTEGER NOT NULL DEFAULT 0,
      duplicates INTEGER NOT NULL DEFAULT 0,
      invalid INTEGER NOT NULL DEFAULT 0,
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS ops_backups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      data TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migrasi email marketing: kolom brevo_message_id → message_id (provider
  // kini Gmail; kolom lama ditinggal — belum ada data yang berarti).
  const emItemCols = db
    .prepare("PRAGMA table_info(email_campaign_items)")
    .all() as { name: string }[];
  if (
    emItemCols.length > 0 &&
    !emItemCols.some((c) => c.name === "message_id")
  ) {
    db.exec(
      "ALTER TABLE email_campaign_items ADD COLUMN message_id TEXT NOT NULL DEFAULT ''",
    );
  }

  // Migrasi email marketing 2: satu kontak = satu grup (group_id wajib),
  // pengaturan kirim per kampanye/akun SMTP, dan waktu kirim per item.
  const emContactCols = db
    .prepare("PRAGMA table_info(email_contacts)")
    .all() as { name: string }[];
  if (
    emContactCols.length > 0 &&
    !emContactCols.some((c) => c.name === "group_id")
  ) {
    db.exec(
      "ALTER TABLE email_contacts ADD COLUMN group_id INTEGER NOT NULL DEFAULT 0",
    );
  }
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_email_contacts_group ON email_contacts (group_id)",
  );
  // Pindahkan keanggotaan lama (tabel many-to-many) ke group_id sekali saja.
  db.exec(
    `UPDATE email_contacts SET group_id = (
       SELECT MIN(m.group_id) FROM email_group_members m
       WHERE m.contact_id = email_contacts.id
     )
     WHERE group_id = 0 AND EXISTS (
       SELECT 1 FROM email_group_members m WHERE m.contact_id = email_contacts.id
     )`,
  );

  const emCampaignCols = db
    .prepare("PRAGMA table_info(email_campaigns)")
    .all() as { name: string }[];
  const campaignAdd: [string, string][] = [
    ["smtp_account_id", "INTEGER NOT NULL DEFAULT 0"],
    ["next_run_at", "TEXT NOT NULL DEFAULT ''"],
    ["pause_reason", "TEXT NOT NULL DEFAULT ''"],
    ["batch_sent", "INTEGER NOT NULL DEFAULT 0"],
    ["started_at", "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [col, def] of campaignAdd) {
    if (!emCampaignCols.some((c) => c.name === col)) {
      db.exec(`ALTER TABLE email_campaigns ADD COLUMN ${col} ${def}`);
    }
  }

  const emItemCols2 = db
    .prepare("PRAGMA table_info(email_campaign_items)")
    .all() as { name: string }[];
  const itemAdd: [string, string][] = [
    ["smtp_account_id", "INTEGER NOT NULL DEFAULT 0"],
    ["sent_at", "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [col, def] of itemAdd) {
    if (!emItemCols2.some((c) => c.name === col)) {
      db.exec(`ALTER TABLE email_campaign_items ADD COLUMN ${col} ${def}`);
    }
  }
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_email_items_account ON email_campaign_items (smtp_account_id, sent_at)",
  );

  // Akun SMTP pertama diisi dari pengaturan Gmail lama bila ada — supaya
  // kredensial yang sudah tersimpan langsung tampil di halaman SMTP baru.
  const accSeed = db
    .prepare("SELECT COUNT(*) AS c FROM email_smtp_accounts")
    .get() as { c: number };
  if (accSeed.c === 0) {
    const rows = db
      .prepare("SELECT k, v FROM email_settings")
      .all() as { k: string; v: string }[];
    const map: Record<string, string> = {};
    for (const r of rows) map[r.k] = r.v;
    const user = (
      map.gmail_smtp_user ??
      process.env.GMAIL_SMTP_USER ??
      ""
    ).trim();
    const pass = map.gmail_smtp_pass ?? process.env.GMAIL_SMTP_PASS ?? "";
    if (user && pass) {
      db.prepare(
        `INSERT INTO email_smtp_accounts
           (name, host, port, secure, username, password, sender_email,
            sender_name, batch_size, batch_pause_seconds, delay_ms,
            daily_limit, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "Gmail Utama",
        "smtp.gmail.com",
        465,
        1,
        user,
        pass,
        (map.gmail_sender_email ?? process.env.GMAIL_SENDER_EMAIL ?? user).trim() || user,
        "KTD Store",
        40,
        60,
        1000,
        500,
        1,
      );
    }
  }

  // Benih 6 template email marketing bawaan (hanya bila tabel kosong).
  const tplSeed = db
    .prepare("SELECT COUNT(*) AS c FROM email_templates")
    .get() as { c: number };
  if (tplSeed.c === 0) {
    const ins = db.prepare(
      "INSERT INTO email_templates (name, subject, html_body) VALUES (?, ?, ?)",
    );
    for (const t of EMAIL_SEED_TEMPLATES) {
      ins.run(t.name, t.subject, t.html);
    }
  }

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

    CREATE TABLE IF NOT EXISTS lazada_web_sessions (
      seller_id TEXT PRIMARY KEY,
      cookie_text TEXT NOT NULL DEFAULT '',
      tk_expires_at TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS lazada_awb_jobs (
      order_id TEXT PRIMARY KEY,
      order_item_ids TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      pdf_base64 TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS lazada_bridge_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      heartbeat_at TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
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

    -- Afiliasi: jurnal undangan target collaboration (satu baris per kreator).
    CREATE TABLE IF NOT EXISTS affiliate_invites (
      id SERIAL PRIMARY KEY,
      shop_id TEXT NOT NULL DEFAULT '',
      collaboration_id TEXT NOT NULL DEFAULT '',
      creator_open_id TEXT NOT NULL DEFAULT '',
      username TEXT NOT NULL DEFAULT '',
      nickname TEXT NOT NULL DEFAULT '',
      product_ids TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'sent',
      error_code TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_affiliate_invites_creator
      ON affiliate_invites (creator_open_id);
    CREATE INDEX IF NOT EXISTS idx_affiliate_invites_created
      ON affiliate_invites (created_at DESC);

    -- Afiliasi: cache kreator hasil pencarian marketplace (kolam kandidat cron).
    CREATE TABLE IF NOT EXISTS affiliate_creator_cache (
      creator_open_id TEXT PRIMARY KEY,
      username TEXT NOT NULL DEFAULT '',
      nickname TEXT NOT NULL DEFAULT '',
      avatar_url TEXT NOT NULL DEFAULT '',
      follower_count INTEGER NOT NULL DEFAULT 0,
      data TEXT NOT NULL DEFAULT '',
      invited_status TEXT NOT NULL DEFAULT '',
      cached_at TEXT NOT NULL DEFAULT ''
    );

    -- Afiliasi: pengaturan kunci–nilai (cap harian, filter, produk, komisi).
    CREATE TABLE IF NOT EXISTS affiliate_settings (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );

    -- Email Marketing: kontak, grup, template, kampanye, dan log event.
    CREATE TABLE IF NOT EXISTS email_contacts (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL UNIQUE,
      note TEXT NOT NULL DEFAULT '',
      group_id INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'subscribed',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- Indeks group_id dibuat setelah ALTER TABLE (lihat migrasi di bawah):
    -- tabel lama belum punya kolom itu saat DDL ini dijalankan.

    CREATE TABLE IF NOT EXISTS email_groups (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS email_group_members (
      group_id INTEGER NOT NULL,
      contact_id INTEGER NOT NULL,
      PRIMARY KEY (group_id, contact_id)
    );

    CREATE TABLE IF NOT EXISTS email_templates (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      subject TEXT NOT NULL DEFAULT '',
      html_body TEXT NOT NULL DEFAULT '',
      lang TEXT NOT NULL DEFAULT 'id',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS email_campaigns (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      template_id INTEGER NOT NULL DEFAULT 0,
      group_id INTEGER,
      smtp_account_id INTEGER NOT NULL DEFAULT 0,
      subject TEXT NOT NULL DEFAULT '',
      vars TEXT NOT NULL DEFAULT '',
      scheduled_at TEXT NOT NULL DEFAULT '',
      next_run_at TEXT NOT NULL DEFAULT '',
      pause_reason TEXT NOT NULL DEFAULT '',
      batch_sent INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL DEFAULT '',
      total INTEGER NOT NULL DEFAULT 0,
      sent INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      opened INTEGER NOT NULL DEFAULT 0,
      clicked INTEGER NOT NULL DEFAULT 0,
      bounced INTEGER NOT NULL DEFAULT 0,
      unsubscribed INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS email_campaign_items (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER NOT NULL,
      contact_id INTEGER,
      smtp_account_id INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT NOT NULL DEFAULT '',
      message_id TEXT NOT NULL DEFAULT '',
      claimed_at TEXT NOT NULL DEFAULT '',
      sent_at TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_email_items_campaign
      ON email_campaign_items (campaign_id);

    CREATE TABLE IF NOT EXISTS email_events (
      id SERIAL PRIMARY KEY,
      event TEXT NOT NULL DEFAULT '',
      campaign_item_id INTEGER NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_email_events_item
      ON email_events (campaign_item_id);

    -- Email Marketing: pengaturan SMTP kunci–nilai (akun Gmail bisa
    -- diganti dari UI tanpa menyentuh env).
    CREATE TABLE IF NOT EXISTS email_settings (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );

    -- Email Marketing: beberapa akun SMTP dengan aturan kirim masing-masing
    -- (batch, jeda, batas harian). Kredensial di DB supaya akun bisa
    -- diganti dari UI tanpa redeploy.
    CREATE TABLE IF NOT EXISTS email_smtp_accounts (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      host TEXT NOT NULL DEFAULT '',
      port INTEGER NOT NULL DEFAULT 465,
      secure INTEGER NOT NULL DEFAULT 1,
      username TEXT NOT NULL DEFAULT '',
      password TEXT NOT NULL DEFAULT '',
      sender_email TEXT NOT NULL DEFAULT '',
      sender_name TEXT NOT NULL DEFAULT 'KTD Store',
      batch_size INTEGER NOT NULL DEFAULT 40,
      batch_pause_seconds INTEGER NOT NULL DEFAULT 60,
      delay_ms INTEGER NOT NULL DEFAULT 1000,
      daily_limit INTEGER NOT NULL DEFAULT 500,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Riwayat import kontak — untuk memastikan angka laporan bisa
    -- direkonsiliasi dengan isi grup.
    CREATE TABLE IF NOT EXISTS email_import_runs (
      id SERIAL PRIMARY KEY,
      group_id INTEGER NOT NULL DEFAULT 0,
      group_name TEXT NOT NULL DEFAULT '',
      total_lines INTEGER NOT NULL DEFAULT 0,
      valid_lines INTEGER NOT NULL DEFAULT 0,
      unique_emails INTEGER NOT NULL DEFAULT 0,
      added INTEGER NOT NULL DEFAULT 0,
      updated INTEGER NOT NULL DEFAULT 0,
      moved INTEGER NOT NULL DEFAULT 0,
      duplicates INTEGER NOT NULL DEFAULT 0,
      invalid INTEGER NOT NULL DEFAULT 0,
      detail TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS ops_backups (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      data TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Migrasi email marketing: kolom brevo_message_id → message_id (provider
  // kini Gmail; kolom lama ditinggal — belum ada data yang berarti).
  const emCols = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'email_campaign_items'`,
  );
  if (
    emCols.rows.length > 0 &&
    !emCols.rows.some((c) => c.column_name === "message_id")
  ) {
    await pool.query(
      "ALTER TABLE email_campaign_items ADD COLUMN message_id TEXT NOT NULL DEFAULT ''",
    );
  }

  // Migrasi email marketing 2 (padanan SQLite): grup wajib per kontak,
  // pengaturan kirim per kampanye/akun SMTP, dan waktu kirim per item.
  await pool.query(
    "ALTER TABLE email_contacts ADD COLUMN IF NOT EXISTS group_id INTEGER NOT NULL DEFAULT 0",
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_email_contacts_group ON email_contacts (group_id)",
  );
  await pool.query(
    `UPDATE email_contacts SET group_id = x.min_group
     FROM (
       SELECT contact_id, MIN(group_id) AS min_group
       FROM email_group_members GROUP BY contact_id
     ) x
     WHERE email_contacts.id = x.contact_id AND email_contacts.group_id = 0`,
  );

  const campaignCols2: [string, string][] = [
    ["smtp_account_id", "INTEGER NOT NULL DEFAULT 0"],
    ["next_run_at", "TEXT NOT NULL DEFAULT ''"],
    ["pause_reason", "TEXT NOT NULL DEFAULT ''"],
    ["batch_sent", "INTEGER NOT NULL DEFAULT 0"],
    ["started_at", "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [col, def] of campaignCols2) {
    await pool.query(
      `ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS ${col} ${def}`,
    );
  }
  await pool.query(
    "ALTER TABLE email_campaign_items ADD COLUMN IF NOT EXISTS smtp_account_id INTEGER NOT NULL DEFAULT 0",
  );
  await pool.query(
    "ALTER TABLE email_campaign_items ADD COLUMN IF NOT EXISTS sent_at TEXT NOT NULL DEFAULT ''",
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_email_items_account ON email_campaign_items (smtp_account_id, sent_at)",
  );

  // Akun SMTP pertama diisi dari pengaturan Gmail lama bila ada.
  const accSeed = await pool.query<{ c: string }>(
    "SELECT COUNT(*)::int AS c FROM email_smtp_accounts",
  );
  if (Number(accSeed.rows[0]?.c ?? 0) === 0) {
    const legacy = await pool.query<{ k: string; v: string }>(
      "SELECT k, v FROM email_settings",
    );
    const map: Record<string, string> = {};
    for (const r of legacy.rows) map[r.k] = r.v;
    const user = (
      map.gmail_smtp_user ??
      process.env.GMAIL_SMTP_USER ??
      ""
    ).trim();
    const pass = map.gmail_smtp_pass ?? process.env.GMAIL_SMTP_PASS ?? "";
    if (user && pass) {
      await pool.query(
        `INSERT INTO email_smtp_accounts
           (name, host, port, secure, username, password, sender_email,
            sender_name, batch_size, batch_pause_seconds, delay_ms,
            daily_limit, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          "Gmail Utama",
          "smtp.gmail.com",
          465,
          1,
          user,
          pass,
          (map.gmail_sender_email ?? process.env.GMAIL_SENDER_EMAIL ?? user).trim() || user,
          "KTD Store",
          40,
          60,
          1000,
          500,
          1,
        ],
      );
    }
  }

  // Benih 6 template email marketing bawaan (hanya bila tabel kosong).
  const tplSeed = await pool.query<{ c: string }>(
    "SELECT COUNT(*)::int AS c FROM email_templates",
  );
  if (Number(tplSeed.rows[0]?.c ?? 0) === 0) {
    for (const t of EMAIL_SEED_TEMPLATES) {
      await pool.query(
        "INSERT INTO email_templates (name, subject, html_body) VALUES ($1, $2, $3)",
        [t.name, t.subject, t.html],
      );
    }
  }

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

// ---------- Afiliasi kreator (jurnal undangan, cache, pengaturan) ----------

export type AffiliateInviteRow = {
  id: number;
  shop_id: string;
  collaboration_id: string;
  creator_open_id: string;
  username: string;
  nickname: string;
  product_ids: string;
  status: string;
  error_code: string;
  detail: string;
  created_at: string;
};

/** Tulis satu baris jurnal undangan per kreator (hasil tiap batch invite). */
export async function saveAffiliateInvite(row: {
  shop_id: string;
  collaboration_id: string;
  creator_open_id: string;
  username?: string;
  nickname?: string;
  product_ids: string;
  status: string;
  error_code?: string;
  detail?: string;
}): Promise<void> {
  await queryRun(
    `INSERT INTO affiliate_invites (shop_id, collaboration_id, creator_open_id, username, nickname, product_ids, status, error_code, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.shop_id,
      row.collaboration_id,
      row.creator_open_id,
      row.username ?? "",
      row.nickname ?? "",
      row.product_ids,
      row.status,
      row.error_code ?? "",
      row.detail ?? "",
      new Date().toISOString(),
    ],
  );
}

/** Jurnal undangan terbaru (paling baru dulu). */
export async function listAffiliateInvites(
  opts: { limit?: number; offset?: number } = {},
): Promise<AffiliateInviteRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  return queryAll<AffiliateInviteRow>(
    "SELECT * FROM affiliate_invites ORDER BY id DESC LIMIT ? OFFSET ?",
    [limit, offset],
  );
}

/** Jumlah undangan berstatus sent sejak sejak `sinceIso` (dasar cap harian). */
export async function countAffiliateInvitesSentSince(
  sinceIso: string,
): Promise<number> {
  const row = await queryOne<{ n: number | string }>(
    "SELECT COUNT(*) AS n FROM affiliate_invites WHERE status = 'sent' AND created_at >= ?",
    [sinceIso],
  );
  return Number(row?.n ?? 0);
}

/** Open id kreator yang sudah pernah diundang (status sent) — untuk dedupe. */
export async function listInvitedCreatorOpenIds(): Promise<string[]> {
  const rows = await queryAll<{ creator_open_id: string }>(
    "SELECT DISTINCT creator_open_id FROM affiliate_invites WHERE status = 'sent'",
  );
  return rows.map((r) => r.creator_open_id);
}

export type AffiliateCreatorCacheRow = {
  creator_open_id: string;
  username: string;
  nickname: string;
  avatar_url: string;
  follower_count: number;
  data: string;
  invited_status: string;
  cached_at: string;
};

/** Simpan/timpa kreator hasil pencarian ke cache kandidat. */
export async function upsertAffiliateCreatorCache(
  rows: {
    creator_open_id: string;
    username?: string;
    nickname?: string;
    avatar_url?: string;
    follower_count?: number;
    data?: string;
  }[],
): Promise<void> {
  const nowIso = new Date().toISOString();
  for (const r of rows) {
    await queryRun(
      `INSERT INTO affiliate_creator_cache (creator_open_id, username, nickname, avatar_url, follower_count, data, invited_status, cached_at)
       VALUES (?, ?, ?, ?, ?, ?, '', ?)
       ON CONFLICT (creator_open_id) DO UPDATE SET username = excluded.username, nickname = excluded.nickname,
         avatar_url = excluded.avatar_url, follower_count = excluded.follower_count, data = excluded.data, cached_at = excluded.cached_at`,
      [
        r.creator_open_id,
        r.username ?? "",
        r.nickname ?? "",
        r.avatar_url ?? "",
        r.follower_count ?? 0,
        r.data ?? "",
        nowIso,
      ],
    );
  }
}

/** Kandidat dari cache yang belum berstatus undangan (untuk cron). */
export async function listAffiliateCreatorCandidates(
  opts: { limit?: number } = {},
): Promise<AffiliateCreatorCacheRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 2000);
  return queryAll<AffiliateCreatorCacheRow>(
    "SELECT * FROM affiliate_creator_cache WHERE invited_status = '' ORDER BY follower_count DESC LIMIT ?",
    [limit],
  );
}

/** Tandai status undangan kreator di cache (sent/failed). */
export async function markAffiliateCreatorStatus(
  creatorOpenIds: string[],
  status: string,
): Promise<void> {
  for (const id of creatorOpenIds) {
    await queryRun(
      "UPDATE affiliate_creator_cache SET invited_status = ? WHERE creator_open_id = ?",
      [status, id],
    );
  }
}

/** Baca seluruh pengaturan afiliasi sebagai objek kunci → nilai. */
export async function getAffiliateSettings(): Promise<Record<string, string>> {
  const rows = await queryAll<{ k: string; v: string }>(
    "SELECT k, v FROM affiliate_settings",
  );
  const out: Record<string, string> = {};
  for (const r of rows) out[r.k] = r.v;
  return out;
}

/** Simpan satu pengaturan afiliasi (kunci → nilai). */
export async function setAffiliateSetting(
  k: string,
  v: string,
): Promise<void> {
  await queryRun(
    `INSERT INTO affiliate_settings (k, v, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at`,
    [k, v, new Date().toISOString()],
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

/** Klaim atomik PERSIAPAN antrean eksekusi: sisipkan baris "menunggu" hanya
 *  bila belum ada baris untuk pesanan ini. Dua ronde pengecekan yang
 *  tumpang tindih sama-sama bisa lolos gerbang seen (snapshot dibaca di
 *  awal ronde) — tanpa klaim ini keduanya menyimpan dan KEDUANYA mengirim
 *  notif Setuju (peristiwa nyata 20 Okt 2026, order 586681679392114078).
 *  Kembali true bila ronde ini yang menang (boleh mengirim notif). */
export async function claimTiktokOrderExecPrepared(
  orderId: string,
  shopId: string,
  payload: string,
): Promise<boolean> {
  const r = await queryOne<{ order_id: string }>(
    `INSERT INTO tiktok_order_exec (order_id, shop_id, status, payload, aneka_payment_id, aneka_order_id, detail, executed_at)
     VALUES (?, ?, 'menunggu', ?, '', '', '', '')
     ON CONFLICT (order_id) DO NOTHING
     RETURNING order_id`,
    [orderId, shopId, payload],
  );
  return !!r;
}

/** Compare-and-set kolom payload: tulis payload baru HANYA bila isinya
 *  masih persis payload lama yang dibaca pemanggil. Dipakai saat pengisian
 *  label (isi-label) — dua ronde tumpang tindih sama-sama melihat label
 *  kosong, tetapi hanya ronde yang benar-benar menimpa payload kosong yang
 *  boleh mengirim notif ulang. Kembali true bila CAS berhasil. */
export async function updateTiktokOrderExecPayloadIfUnchanged(
  orderId: string,
  oldPayload: string,
  newPayload: string,
): Promise<boolean> {
  const r = await queryOne<{ order_id: string }>(
    `UPDATE tiktok_order_exec SET payload = ?
     WHERE order_id = ? AND payload = ?
     RETURNING order_id`,
    [newPayload, orderId, oldPayload],
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

/** Klaim atomik PERSIAPAN antrean eksekusi Blibli: sisipkan baris "menunggu"
 *  hanya bila belum ada baris untuk paket ini. Dua ronde pengecekan yang
 *  tumpang tindih sama-sama bisa lolos gerbang seen — tanpa klaim ini
 *  keduanya menyimpan dan KEDUANYA mengirim notif Setuju. Kembali true
 *  bila ronde ini yang menang (boleh mengirim notif). */
export async function claimBlibliOrderExecPrepared(
  packageId: string,
  storeCode: string,
  payload: string,
): Promise<boolean> {
  const r = await queryOne<{ package_id: string }>(
    `INSERT INTO blibli_order_exec (package_id, store_code, status, payload, aneka_payment_id, aneka_order_id, detail, executed_at)
     VALUES (?, ?, 'menunggu', ?, '', '', '', '')
     ON CONFLICT (package_id) DO NOTHING
     RETURNING package_id`,
    [packageId, storeCode, payload],
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

/** Timpa kolom payload baris eksekusi — dipakai menyimpan label resmi yang
 *  diunggah pemilik (diunduh dari Seller Center) tanpa menyentuh status,
 *  jejak pembayaran, maupun log. */
export async function updateLazadaOrderExecPayload(
  orderId: string,
  payload: string,
): Promise<void> {
  await queryRun(
    "UPDATE lazada_order_exec SET payload = ? WHERE order_id = ?",
    [payload, orderId],
  );
}

// ---------- Sesi web Seller Center (cetak AWB via mtop) ----------

export type LazadaWebSession = {
  seller_id: string;
  cookie_text: string;
  tk_expires_at: string;
  updated_at: string;
};

/** Simpan/timpa cookie sesi web Seller Center satu seller — dipakai memanggil
 *  API mtop internal (cetak AWB pesanan kurir terintegrasi) dari server.
 *  Cookie berisi token sesi sensitif; hanya route admin yang menulisnya. */
export async function saveLazadaWebSession(
  sellerId: string,
  cookieText: string,
  tkExpiresAt = "",
): Promise<void> {
  const nowUtc = new Date().toISOString().slice(0, 19).replace("T", " ");
  await queryRun(
    `INSERT INTO lazada_web_sessions (seller_id, cookie_text, tk_expires_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (seller_id) DO UPDATE SET cookie_text = excluded.cookie_text,
       tk_expires_at = excluded.tk_expires_at, updated_at = excluded.updated_at`,
    [sellerId, cookieText, tkExpiresAt, nowUtc],
  );
}

/** Ambil sesi web tersimpan satu seller (null bila belum pernah disimpan). */
export async function getLazadaWebSession(
  sellerId: string,
): Promise<LazadaWebSession | null> {
  const rows = await queryAll<LazadaWebSession>(
    "SELECT * FROM lazada_web_sessions WHERE seller_id = ?",
    [sellerId],
  );
  return rows[0] ?? null;
}

// ---------- Pekerjaan cetak AWB resmi lewat jembatan browser ----------

export type LazadaAwbJob = {
  order_id: string;
  order_item_ids: string;
  status: string; // pending | done | gagal
  pdf_base64: string;
  error: string;
  attempts: number;
  created_at: string;
  updated_at: string;
};

/** Simpan/timpa baris pekerjaan cetak AWB (status diatur pemanggil). */
async function saveLazadaAwbJob(
  orderId: string,
  orderItemIds: string,
  status: string,
  pdfBase64: string,
  error: string,
  attempts: number,
): Promise<void> {
  const nowUtc = new Date().toISOString().slice(0, 19).replace("T", " ");
  await queryRun(
    `INSERT INTO lazada_awb_jobs (order_id, order_item_ids, status, pdf_base64, error, attempts, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (order_id) DO UPDATE SET order_item_ids = excluded.order_item_ids,
       status = excluded.status, pdf_base64 = excluded.pdf_base64,
       error = excluded.error, attempts = excluded.attempts,
       updated_at = excluded.updated_at`,
    [orderId, orderItemIds, status, pdfBase64, error, attempts, nowUtc],
  );
}

/** Antrekan pekerjaan cetak AWB (status pending). */
export async function enqueueLazadaAwbJob(
  orderId: string,
  orderItemIds: string[],
  attempts = 1,
): Promise<void> {
  await saveLazadaAwbJob(
    orderId,
    JSON.stringify(orderItemIds),
    "pending",
    "",
    "",
    attempts,
  );
}

/** Ambil satu pekerjaan cetak AWB (null bila belum pernah dibuat). */
export async function getLazadaAwbJob(
  orderId: string,
): Promise<LazadaAwbJob | null> {
  const rows = await queryAll<LazadaAwbJob>(
    "SELECT * FROM lazada_awb_jobs WHERE order_id = ?",
    [orderId],
  );
  return rows[0] ?? null;
}

/** Daftar pekerjaan menunggu cetak — dikerjakan engine jembatan browser. */
export async function listLazadaAwbJobsPending(): Promise<LazadaAwbJob[]> {
  return queryAll<LazadaAwbJob>(
    "SELECT * FROM lazada_awb_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 10",
  );
}

/** Tandai pekerjaan selesai beserta PDF AWB (base64). */
export async function completeLazadaAwbJob(
  orderId: string,
  pdfBase64: string,
): Promise<void> {
  const nowUtc = new Date().toISOString().slice(0, 19).replace("T", " ");
  await queryRun(
    `UPDATE lazada_awb_jobs SET status = 'done', pdf_base64 = ?, error = '', updated_at = ? WHERE order_id = ?`,
    [pdfBase64, nowUtc, orderId],
  );
}

/** Tandai pekerjaan gagal beserta alasannya. */
export async function failLazadaAwbJob(
  orderId: string,
  error: string,
): Promise<void> {
  const nowUtc = new Date().toISOString().slice(0, 19).replace("T", " ");
  await queryRun(
    `UPDATE lazada_awb_jobs SET status = 'gagal', error = ?, updated_at = ? WHERE order_id = ?`,
    [error.slice(0, 500), nowUtc, orderId],
  );
}

/** Sentuh detak jembatan browser (kapan terakhir engine online). */
export async function touchLazadaBridge(status: string): Promise<void> {
  const nowUtc = new Date().toISOString().slice(0, 19).replace("T", " ");
  await queryRun(
    `INSERT INTO lazada_bridge_state (id, heartbeat_at, status, updated_at)
     VALUES (1, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET heartbeat_at = excluded.heartbeat_at,
       status = excluded.status, updated_at = excluded.updated_at`,
    [nowUtc, status.slice(0, 100), nowUtc],
  );
}

/** Baca detak jembatan browser terakhir. */
export async function getLazadaBridgeState(): Promise<{
  heartbeat_at: string;
  status: string;
} | null> {
  const rows = await queryAll<{ heartbeat_at: string; status: string }>(
    "SELECT heartbeat_at, status FROM lazada_bridge_state WHERE id = 1",
  );
  return rows[0] ?? null;
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

/** Klaim atomik PERSIAPAN antrean eksekusi Lazada: sisipkan baris "menunggu"
 *  hanya bila belum ada baris untuk pesanan ini. Dua ronde pengecekan yang
 *  tumpang tindih sama-sama bisa lolos gerbang seen — tanpa klaim ini
 *  keduanya menyimpan, lalu KEDUANYA melanjutkan autopack + notif Setuju.
 *  Kembali true bila ronde ini yang menang (boleh autopack + mengirim). */
export async function claimLazadaOrderExecPrepared(
  orderId: string,
  storeCode: string,
  payload: string,
): Promise<boolean> {
  const r = await queryOne<{ order_id: string }>(
    `INSERT INTO lazada_order_exec (order_id, store_code, status, payload, aneka_payment_id, aneka_order_id, detail, executed_at)
     VALUES (?, ?, 'menunggu', ?, '', '', '', '')
     ON CONFLICT (order_id) DO NOTHING
     RETURNING order_id`,
    [orderId, storeCode, payload],
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

// ---------- Email Marketing ----------
// Modul email massal via Gmail — pola sama dengan broadcast WhatsApp:
// kontak → grup → template → kampanye → penjadwalan. Gmail tidak punya
// webhook statistik: "dibuka" dilacak lewat pixel 1x1 di badan email.

// ---------- Pengaturan SMTP Gmail (kunci → nilai, disimpan di DB) ----------

/** Baca seluruh pengaturan email sebagai objek kunci → nilai. */
export async function getEmailSettings(): Promise<Record<string, string>> {
  const rows = await queryAll<{ k: string; v: string }>(
    "SELECT k, v FROM email_settings",
  );
  const out: Record<string, string> = {};
  for (const r of rows) out[r.k] = r.v;
  return out;
}

/** Simpan satu pengaturan email (kunci → nilai). */
export async function setEmailSetting(k: string, v: string): Promise<void> {
  await queryRun(
    `INSERT INTO email_settings (k, v, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at`,
    [k, v, new Date().toISOString()],
  );
}

export async function listEmailContacts(): Promise<EmailContact[]> {
  return queryAll<EmailContact>("SELECT * FROM email_contacts ORDER BY id DESC");
}

export async function countEmailContacts(): Promise<number> {
  const row = await queryOne<{ n: string | number }>(
    "SELECT COUNT(*) AS n FROM email_contacts",
  );
  return Number(row?.n ?? 0);
}

export async function countEmailContactsWithoutGroup(): Promise<number> {
  const row = await queryOne<{ n: string | number }>(
    "SELECT COUNT(*) AS n FROM email_contacts WHERE group_id = 0",
  );
  return Number(row?.n ?? 0);
}

export async function getEmailContactByEmail(
  email: string,
): Promise<EmailContact | undefined> {
  return queryOne<EmailContact>(
    "SELECT * FROM email_contacts WHERE email = ?",
    [email.trim().toLowerCase()],
  );
}

export type EmailContactSaveResult = {
  contact: EmailContact;
  created: boolean;
  movedFrom: number;
};

/** Simpan satu kontak. Grup WAJIB — tidak ada daftar umum. Alamat yang
 *  sudah ada dipindahkan ke grup tujuan (bukan digandakan). */
export async function addEmailContact(
  name: string,
  email: string,
  note: string,
  groupId: number,
): Promise<EmailContactSaveResult> {
  if (!groupId) throw new Error("Grup wajib dipilih");
  const clean = email.trim().toLowerCase();
  const existing = await getEmailContactByEmail(clean);
  if (existing) {
    const movedFrom = existing.group_id !== groupId ? existing.group_id : 0;
    // Nama kosong tidak boleh menghapus nama yang sudah ada.
    const nextName = name.trim() || existing.name;
    await queryRun(
      "UPDATE email_contacts SET name = ?, note = ?, group_id = ? WHERE id = ?",
      [nextName, note.trim(), groupId, existing.id],
    );
    return {
      contact: {
        ...existing,
        name: nextName,
        note: note.trim(),
        group_id: groupId,
      },
      created: false,
      movedFrom,
    };
  }
  const row = await queryOne<EmailContact>(
    "INSERT INTO email_contacts (name, email, note, group_id) VALUES (?, ?, ?, ?) RETURNING *",
    [name.trim(), clean, note.trim(), groupId],
  );
  if (!row) throw new Error("gagal menyimpan kontak email");
  return { contact: row, created: true, movedFrom: 0 };
}

export type EmailBulkSaveResult = {
  added: number;
  updated: number;
  moved: number;
};

/** Simpan banyak kontak sekaligus (sudah dedupe di pemanggil). Semua
 *  kontak dipindahkan ke `groupId` — tidak ada keanggotaan ganda. */
export async function bulkUpsertEmailContacts(
  rows: { name: string; email: string }[],
  groupId: number,
): Promise<EmailBulkSaveResult> {
  if (!groupId) throw new Error("Grup wajib dipilih");
  if (rows.length === 0) return { added: 0, updated: 0, moved: 0 };

  const existing = new Map<string, number>();
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const ph = chunk.map(() => "?").join(", ");
    const found = await queryAll<{ email: string; group_id: number }>(
      `SELECT email, group_id FROM email_contacts WHERE email IN (${ph})`,
      chunk.map((r) => r.email),
    );
    for (const f of found) existing.set(f.email, Number(f.group_id));
  }

  let added = 0;
  let updated = 0;
  let moved = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const values = chunk.map(() => "(?, ?, ?, ?)").join(", ");
    const params = chunk.flatMap((r) => [
      r.name.trim(),
      r.email,
      "",
      groupId,
    ]);
    await queryRun(
      `INSERT INTO email_contacts (name, email, note, group_id) VALUES ${values}
       ON CONFLICT (email) DO UPDATE SET
         name = CASE
           WHEN excluded.name != '' THEN excluded.name
           ELSE email_contacts.name
         END,
         group_id = excluded.group_id`,
      params,
    );
    for (const r of chunk) {
      const prev = existing.get(r.email);
      if (prev === undefined) added++;
      else {
        updated++;
        if (prev !== groupId) moved++;
      }
    }
  }
  return { added, updated, moved };
}

/** Status langganan: subscribed / unsubscribed / bounced. */
export async function setEmailContactStatus(
  id: number,
  status: string,
): Promise<void> {
  await queryRun("UPDATE email_contacts SET status = ? WHERE id = ?", [
    status,
    id,
  ]);
}

/** Hapus banyak kontak email (permanen). Riwayat kampanye tetap utuh —
 *  email_campaign_items menyimpan salinan alamatnya sendiri. */
export async function deleteEmailContacts(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  // Dipecah per 400 id supaya aman terhadap batas parameter SQLite (999).
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    const ph = chunk.map(() => "?").join(", ");
    await queryRun(
      `UPDATE email_campaign_items SET contact_id = NULL WHERE contact_id IN (${ph})`,
      chunk,
    );
    await queryRun(
      `DELETE FROM email_group_members WHERE contact_id IN (${ph})`,
      chunk,
    );
    await queryRun(`DELETE FROM email_contacts WHERE id IN (${ph})`, chunk);
  }
  return ids.length;
}

// ---------- Grup kontak email (wajib, satu grup per kontak) ----------

export async function listEmailGroups(): Promise<EmailGroup[]> {
  const rows = await queryAll<
    Omit<EmailGroup, "member_count" | "subscribed_count"> & {
      member_count: string | number;
      subscribed_count: string | number;
    }
  >(
    `SELECT g.id, g.name, g.created_at,
       (SELECT COUNT(*) FROM email_contacts c WHERE c.group_id = g.id) AS member_count,
       (SELECT COUNT(*) FROM email_contacts c WHERE c.group_id = g.id AND c.status = 'subscribed') AS subscribed_count
     FROM email_groups g ORDER BY LOWER(g.name)`,
  );
  return rows.map((r) => ({
    ...r,
    member_count: Number(r.member_count ?? 0),
    subscribed_count: Number(r.subscribed_count ?? 0),
  }));
}

export async function createEmailGroup(name: string): Promise<EmailGroup> {
  const row = await queryOne<Omit<EmailGroup, "member_count" | "subscribed_count">>(
    "INSERT INTO email_groups (name) VALUES (?) RETURNING id, name, created_at",
    [name.trim()],
  );
  if (!row) throw new Error("gagal membuat grup email");
  return { ...row, member_count: 0, subscribed_count: 0 };
}

export async function renameEmailGroup(id: number, name: string): Promise<void> {
  await queryRun("UPDATE email_groups SET name = ? WHERE id = ?", [
    name.trim(),
    id,
  ]);
}

export async function countEmailContactsInGroup(id: number): Promise<number> {
  const row = await queryOne<{ n: string | number }>(
    "SELECT COUNT(*) AS n FROM email_contacts WHERE group_id = ?",
    [id],
  );
  return Number(row?.n ?? 0);
}

/** Hapus grup email. Pemanggil wajib memastikan grup kosong — kontak
 *  tidak boleh menjadi yatim (tidak ada daftar umum). */
export async function deleteEmailGroup(id: number): Promise<void> {
  await queryRun("DELETE FROM email_group_members WHERE group_id = ?", [id]);
  await queryRun("DELETE FROM email_groups WHERE id = ?", [id]);
}

/** Pindahkan banyak kontak ke satu grup — keanggotaan lama otomatis lepas. */
export async function moveEmailContactsToGroup(
  contactIds: number[],
  groupId: number,
): Promise<number> {
  if (!groupId || contactIds.length === 0) return 0;
  const ids = [...new Set(contactIds.map(Number).filter((n) => n > 0))];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const ph = chunk.map(() => "?").join(", ");
    await queryRun(
      `UPDATE email_contacts SET group_id = ? WHERE id IN (${ph})`,
      [groupId, ...chunk],
    );
  }
  return ids.length;
}

/** Pindahkan kontak lama yang belum punya grup ke grup tertentu. */
export async function assignUngroupedEmailContacts(
  groupId: number,
): Promise<number> {
  if (!groupId) return 0;
  const row = await queryOne<{ n: string | number }>(
    "SELECT COUNT(*) AS n FROM email_contacts WHERE group_id = 0",
  );
  const n = Number(row?.n ?? 0);
  if (n > 0) {
    await queryRun("UPDATE email_contacts SET group_id = ? WHERE group_id = 0", [
      groupId,
    ]);
  }
  return n;
}

/** Kontak anggota satu grup email. */
export async function listEmailContactsByGroup(
  groupId: number,
): Promise<EmailContact[]> {
  return queryAll<EmailContact>(
    "SELECT * FROM email_contacts WHERE group_id = ? ORDER BY id DESC",
    [groupId],
  );
}

// ---------- Log import kontak ----------

export async function logEmailImportRun(
  run: Omit<EmailImportRun, "id" | "created_at">,
): Promise<void> {
  await queryRun(
    `INSERT INTO email_import_runs
       (group_id, group_name, total_lines, valid_lines, unique_emails,
        added, updated, moved, duplicates, invalid, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      run.group_id,
      run.group_name,
      run.total_lines,
      run.valid_lines,
      run.unique_emails,
      run.added,
      run.updated,
      run.moved,
      run.duplicates,
      run.invalid,
      run.detail,
    ],
  );
}

export async function listEmailImportRuns(
  limit = 10,
): Promise<EmailImportRun[]> {
  return queryAll<EmailImportRun>(
    "SELECT * FROM email_import_runs ORDER BY id DESC LIMIT ?",
    [limit],
  );
}

// ---------- Audit & perbaikan data kontak ----------

export type EmailContactAudit = {
  contacts: number;
  groups: number;
  ungrouped: number;
  orphanMembers: number;
  duplicateEmails: number;
};

export async function auditEmailContacts(): Promise<EmailContactAudit> {
  const [contacts, groups, ungrouped, orphanMembers, duplicateEmails] =
    await Promise.all([
      countEmailContacts(),
      queryOne<{ n: string | number }>(
        "SELECT COUNT(*) AS n FROM email_groups",
      ),
      countEmailContactsWithoutGroup(),
      queryOne<{ n: string | number }>(
        `SELECT COUNT(*) AS n FROM email_group_members m
         LEFT JOIN email_contacts c ON c.id = m.contact_id
         LEFT JOIN email_groups g ON g.id = m.group_id
         WHERE c.id IS NULL OR g.id IS NULL`,
      ),
      queryOne<{ n: string | number }>(
        `SELECT COUNT(*) AS n FROM (
           SELECT LOWER(TRIM(email)) AS e FROM email_contacts
           GROUP BY LOWER(TRIM(email)) HAVING COUNT(*) > 1
         ) d`,
      ),
    ]);
  return {
    contacts: contacts,
    groups: Number(groups?.n ?? 0),
    ungrouped: ungrouped,
    orphanMembers: Number(orphanMembers?.n ?? 0),
    duplicateEmails: Number(duplicateEmails?.n ?? 0),
  };
}

/** Bersihkan keanggotaan lama yang yatim + pindahkan kontak tanpa grup. */
export async function repairEmailContacts(options: {
  ungroupedGroupId?: number;
}): Promise<{ orphansRemoved: number; ungroupedMoved: number }> {
  const before = await queryOne<{ n: string | number }>(
    `SELECT COUNT(*) AS n FROM email_group_members m
     LEFT JOIN email_contacts c ON c.id = m.contact_id
     LEFT JOIN email_groups g ON g.id = m.group_id
     WHERE c.id IS NULL OR g.id IS NULL`,
  );
  await queryRun(
    `DELETE FROM email_group_members
     WHERE contact_id NOT IN (SELECT id FROM email_contacts)
        OR group_id NOT IN (SELECT id FROM email_groups)`,
  );
  let ungroupedMoved = 0;
  if (options.ungroupedGroupId) {
    ungroupedMoved = await assignUngroupedEmailContacts(
      options.ungroupedGroupId,
    );
  }
  return {
    orphansRemoved: Number(before?.n ?? 0),
    ungroupedMoved,
  };
}

// ---------- Akun SMTP email (multi-akun) ----------

export type EmailSmtpAccountInput = Omit<
  EmailSmtpAccount,
  "id" | "created_at"
>;

function normalizeSmtpAccount(row: EmailSmtpAccount): EmailSmtpAccount {
  return {
    ...row,
    port: Math.max(1, Number(row.port) || 465),
    secure: Number(row.secure) ? 1 : 0,
    batch_size: Math.max(1, Number(row.batch_size) || 40),
    batch_pause_seconds: Math.max(0, Number(row.batch_pause_seconds) || 0),
    delay_ms: Math.max(0, Number(row.delay_ms) || 0),
    daily_limit: Math.max(0, Number(row.daily_limit) || 0),
    active: Number(row.active) ? 1 : 0,
  };
}

/** Daftar akun SMTP. Password hanya disertakan bila `includePassword`. */
export async function listEmailSmtpAccounts(
  includePassword = false,
): Promise<EmailSmtpAccount[]> {
  const rows = await queryAll<EmailSmtpAccount>(
    "SELECT * FROM email_smtp_accounts ORDER BY id",
  );
  return rows.map((r) => {
    const a = normalizeSmtpAccount(r);
    if (!includePassword) a.password = "";
    return a;
  });
}

export async function getEmailSmtpAccount(
  id: number,
): Promise<EmailSmtpAccount | undefined> {
  const row = await queryOne<EmailSmtpAccount>(
    "SELECT * FROM email_smtp_accounts WHERE id = ?",
    [id],
  );
  return row ? normalizeSmtpAccount(row) : undefined;
}

export async function getDefaultEmailSmtpAccount(): Promise<
  EmailSmtpAccount | undefined
> {
  const row = await queryOne<EmailSmtpAccount>(
    "SELECT * FROM email_smtp_accounts WHERE active = 1 ORDER BY id LIMIT 1",
  );
  return row ? normalizeSmtpAccount(row) : undefined;
}

export async function createEmailSmtpAccount(
  input: EmailSmtpAccountInput,
): Promise<EmailSmtpAccount> {
  const row = await queryOne<EmailSmtpAccount>(
    `INSERT INTO email_smtp_accounts
       (name, host, port, secure, username, password, sender_email,
        sender_name, batch_size, batch_pause_seconds, delay_ms,
        daily_limit, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    [
      input.name.trim(),
      input.host.trim(),
      input.port,
      input.secure,
      input.username.trim(),
      input.password,
      input.sender_email.trim(),
      input.sender_name.trim(),
      input.batch_size,
      input.batch_pause_seconds,
      input.delay_ms,
      input.daily_limit,
      input.active,
    ],
  );
  if (!row) throw new Error("gagal menyimpan akun SMTP");
  return normalizeSmtpAccount(row);
}

export async function updateEmailSmtpAccount(
  id: number,
  patch: Partial<EmailSmtpAccountInput>,
): Promise<EmailSmtpAccount | undefined> {
  const cur = await getEmailSmtpAccount(id);
  if (!cur) return undefined;
  const next: EmailSmtpAccount = {
    ...cur,
    ...patch,
    password: patch.password?.trim() ? patch.password : cur.password,
  };
  await queryRun(
    `UPDATE email_smtp_accounts SET name = ?, host = ?, port = ?, secure = ?,
       username = ?, password = ?, sender_email = ?, sender_name = ?,
       batch_size = ?, batch_pause_seconds = ?, delay_ms = ?, daily_limit = ?,
       active = ? WHERE id = ?`,
    [
      next.name.trim(),
      next.host.trim(),
      next.port,
      next.secure,
      next.username.trim(),
      next.password,
      next.sender_email.trim(),
      next.sender_name.trim(),
      next.batch_size,
      next.batch_pause_seconds,
      next.delay_ms,
      next.daily_limit,
      next.active,
      id,
    ],
  );
  return getEmailSmtpAccount(id);
}

export async function deleteEmailSmtpAccount(id: number): Promise<void> {
  await queryRun("DELETE FROM email_smtp_accounts WHERE id = ?", [id]);
}

export async function countCampaignsUsingSmtpAccount(
  id: number,
): Promise<number> {
  const row = await queryOne<{ n: string | number }>(
    `SELECT COUNT(*) AS n FROM email_campaigns
     WHERE smtp_account_id = ? AND status IN ('draft', 'sending', 'paused')`,
    [id],
  );
  return Number(row?.n ?? 0);
}

/** Kiriman sukses hari ini per akun (jendela kalender lokal). */
export async function countEmailsSentTodayByAccounts(
  accountIds: number[],
): Promise<Record<number, number>> {
  const out: Record<number, number> = {};
  if (accountIds.length === 0) return out;
  // sent_at disimpan sebagai teks UTC; batas harian dihitung di JS supaya
  // perbandingannya teks-vs-teks (di Postgres teks vs timestamptz = error).
  const since = startOfTodayStamp();
  const ph = accountIds.map(() => "?").join(", ");
  const rows = await queryAll<{ smtp_account_id: number; n: string | number }>(
    `SELECT smtp_account_id, COUNT(*) AS n FROM email_campaign_items
     WHERE smtp_account_id IN (${ph})
       AND status IN ('sent', 'delivered', 'opened', 'clicked')
       AND sent_at != '' AND sent_at >= ?
     GROUP BY smtp_account_id`,
    [...accountIds, since],
  );
  for (const r of rows) out[Number(r.smtp_account_id)] = Number(r.n ?? 0);
  return out;
}

export async function countEmailsSentTodayByAccount(
  accountId: number,
): Promise<number> {
  const map = await countEmailsSentTodayByAccounts([accountId]);
  return map[accountId] ?? 0;
}

// ---------- Template email ----------

export async function listEmailTemplates(): Promise<EmailTemplate[]> {
  return queryAll<EmailTemplate>(
    "SELECT * FROM email_templates ORDER BY id DESC",
  );
}

export async function getEmailTemplate(
  id: number,
): Promise<EmailTemplate | undefined> {
  return queryOne<EmailTemplate>(
    "SELECT * FROM email_templates WHERE id = ?",
    [id],
  );
}

export async function createEmailTemplate(
  name: string,
  subject: string,
  htmlBody: string,
  lang = "id",
): Promise<EmailTemplate> {
  const row = await queryOne<EmailTemplate>(
    "INSERT INTO email_templates (name, subject, html_body, lang) VALUES (?, ?, ?, ?) RETURNING *",
    [name.trim(), subject.trim(), htmlBody, lang],
  );
  if (!row) throw new Error("gagal membuat template email");
  return row;
}

export async function updateEmailTemplate(
  id: number,
  subject: string,
  htmlBody: string,
  lang = "id",
): Promise<void> {
  await queryRun(
    "UPDATE email_templates SET subject = ?, html_body = ?, lang = ? WHERE id = ?",
    [subject.trim(), htmlBody, lang, id],
  );
}

export async function deleteEmailTemplate(id: number): Promise<void> {
  await queryRun("DELETE FROM email_templates WHERE id = ?", [id]);
}

// ---------- Kampanye email ----------

export async function listEmailCampaigns(): Promise<EmailCampaign[]> {
  return queryAll<EmailCampaign>(
    "SELECT * FROM email_campaigns ORDER BY id DESC",
  );
}

export async function getEmailCampaign(
  id: number,
): Promise<EmailCampaign | undefined> {
  return queryOne<EmailCampaign>(
    "SELECT * FROM email_campaigns WHERE id = ?",
    [id],
  );
}

export async function listEmailCampaignItems(
  campaignId: number,
): Promise<EmailCampaignItem[]> {
  return queryAll<EmailCampaignItem>(
    "SELECT * FROM email_campaign_items WHERE campaign_id = ? ORDER BY id",
    [campaignId],
  );
}

/** Stempel waktu UTC "YYYY-MM-DD HH:MM:SS" — format yang dipakai SQLite
 *  maupun Postgres di modul ini. */
function utcStamp(at: Date = new Date()): string {
  return at.toISOString().slice(0, 19).replace("T", " ");
}

/** Awal hari kalender WIB (UTC+7, tanpa DST) sebagai stempel UTC — batas
 *  hitung kuota harian per akun. Disamakan dengan waktu lanjut mesin kirim
 *  supaya reset kuota selalu pukul 00:00 WIB, bukan tengah malam UTC. */
function startOfTodayStamp(): string {
  const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
  const nowWib = Date.now() + WIB_OFFSET_MS;
  const startOfDayWib = Math.floor(nowWib / 86_400_000) * 86_400_000;
  return utcStamp(new Date(startOfDayWib - WIB_OFFSET_MS));
}

export type EmailCampaignCreateInput = {
  name: string;
  templateId: number;
  smtpAccountId: number;
  groupId: number | null;
  subject: string;
  vars?: Record<string, string>;
  scheduledAt?: string;
  items: { contactId: number | null; name: string; email: string }[];
};

export async function createEmailCampaignWithItems(
  input: EmailCampaignCreateInput,
): Promise<EmailCampaign> {
  const campaign = await queryOne<EmailCampaign>(
    `INSERT INTO email_campaigns
       (name, template_id, group_id, smtp_account_id, subject, vars, scheduled_at, total)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    [
      input.name.trim(),
      input.templateId,
      input.groupId,
      input.smtpAccountId,
      input.subject.trim(),
      JSON.stringify(input.vars ?? {}),
      input.scheduledAt ?? "",
      input.items.length,
    ],
  );
  if (!campaign) throw new Error("gagal membuat kampanye email");
  // Item ditulis per potongan 100 baris (5 nilai per baris) supaya jumlah
  // parameter tidak melewati batas SQLite (999) / Postgres (65535).
  for (let i = 0; i < input.items.length; i += 100) {
    const chunk = input.items.slice(i, i + 100);
    const values = chunk.map(() => "(?, ?, ?, ?, ?)").join(", ");
    const params = chunk.flatMap((it) => [
      campaign.id,
      it.contactId,
      input.smtpAccountId,
      it.name,
      it.email,
    ]);
    await queryRun(
      `INSERT INTO email_campaign_items (campaign_id, contact_id, smtp_account_id, name, email) VALUES ${values}`,
      params,
    );
  }
  return campaign;
}

export type EmailCampaignRunPatch = Partial<
  Pick<
    EmailCampaign,
    | "status"
    | "next_run_at"
    | "pause_reason"
    | "batch_sent"
    | "started_at"
    | "sent"
    | "failed"
  >
>;

/** Perbarui status jalan kampanye (status, jadwal lanjut, alasan jeda, dsb). */
export async function updateEmailCampaignRun(
  id: number,
  patch: EmailCampaignRunPatch,
): Promise<void> {
  const keys = Object.keys(patch) as (keyof EmailCampaignRunPatch)[];
  if (keys.length === 0) return;
  const set = keys.map((k) => `${k} = ?`).join(", ");
  await queryRun(`UPDATE email_campaigns SET ${set} WHERE id = ?`, [
    ...keys.map((k) => patch[k] ?? ""),
    id,
  ]);
}

/** Sama seperti updateEmailCampaignRun, tetapi tidak menimpa jeda manual /
 *  fatal. Dipakai mesin kirim di akhir ronde: klik "Jeda" saat ronde masih
 *  berjalan tidak boleh dibatalkan oleh tulisan status "sending" / cooldown.
 *  Mengembalikan true bila baris benar-benar diperbarui. */
export async function updateEmailCampaignRunIfActive(
  id: number,
  patch: EmailCampaignRunPatch,
): Promise<boolean> {
  const keys = Object.keys(patch) as (keyof EmailCampaignRunPatch)[];
  if (keys.length === 0) return false;
  const set = keys.map((k) => `${k} = ?`).join(", ");
  const rows = await queryAll<{ id: number }>(
    `UPDATE email_campaigns SET ${set}
     WHERE id = ?
       AND NOT (status = 'paused' AND pause_reason IN ('manual', 'fatal'))
     RETURNING id`,
    [...keys.map((k) => patch[k] ?? ""), id],
  );
  return rows.length > 0;
}

/** Hentikan kampanye. "manual" tidak pernah auto-lanjut; "cooldown" dijadwalkan
 *  lanjut sendiri oleh mesin kirim setelah jeda batch. */
export async function pauseEmailCampaign(
  id: number,
  reason: "manual" | "cooldown" | "fatal",
  nextRunAt = "",
): Promise<void> {
  await updateEmailCampaignRun(id, {
    status: "paused",
    pause_reason: reason,
    next_run_at: nextRunAt,
  });
}

export async function resumeEmailCampaign(id: number): Promise<void> {
  await updateEmailCampaignRun(id, {
    status: "sending",
    pause_reason: "",
    next_run_at: "",
  });
}

// Ambil-sekaligus-tandai item yang akan dikirim pada ronde ini (atomik,
// pola claimPendingBroadcastItems) supaya dua ronde tidak kirim dobel.
export async function claimPendingEmailItems(
  campaignId: number,
  limit = 10,
): Promise<EmailCampaignItem[]> {
  return queryAll<EmailCampaignItem>(
    "UPDATE email_campaign_items SET status = 'queued', claimed_at = ? WHERE id IN (SELECT id FROM email_campaign_items WHERE campaign_id = ? AND status = 'pending' ORDER BY id LIMIT ?) RETURNING *",
    [utcStamp(), campaignId, limit],
  );
}

/** Lepaskan klaim yang tidak sempat diproses pada ronde ini — dikembalikan
 *  ke pending supaya ronde berikutnya tidak pernah kehilangan email. */
export async function requeueEmailItems(ids: number[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const ph = chunk.map(() => "?").join(", ");
    await queryRun(
      `UPDATE email_campaign_items SET status = 'pending', claimed_at = '' WHERE id IN (${ph})`,
      chunk,
    );
  }
}

// Kembalikan item yang sempat di-claim tapi rondenya tidak selesai.
export async function requeueStaleQueuedEmailItems(
  campaignId: number,
  staleMinutes = 5,
): Promise<void> {
  const cutoff = utcStamp(new Date(Date.now() - staleMinutes * 60_000));
  await queryRun(
    "UPDATE email_campaign_items SET status = 'pending', claimed_at = '' WHERE campaign_id = ? AND status = 'queued' AND claimed_at != '' AND claimed_at <= ?",
    [campaignId, cutoff],
  );
}

export async function markEmailCampaignItem(
  id: number,
  status: "sent" | "delivered" | "opened" | "clicked" | "failed",
  error = "",
  messageId = "",
): Promise<void> {
  if (status === "failed") {
    await queryRun(
      "UPDATE email_campaign_items SET status = 'failed', error = ?, message_id = ?, claimed_at = '' WHERE id = ?",
      [error, messageId, id],
    );
    return;
  }
  await queryRun(
    "UPDATE email_campaign_items SET status = ?, error = ?, message_id = ?, claimed_at = '', sent_at = ? WHERE id = ?",
    [status, error, messageId, utcStamp(), id],
  );
}

export async function emailCampaignProgress(id: number): Promise<{
  total: number;
  sent: number;
  failed: number;
  pending: number;
  queued: number;
  remaining: number;
}> {
  const row = await queryOne<{
    total: string | number | null;
    sent: string | number | null;
    failed: string | number | null;
    pending: string | number | null;
    queued: string | number | null;
  }>(
    `SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status IN ('sent', 'delivered', 'opened', 'clicked') THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued
    FROM email_campaign_items WHERE campaign_id = ?`,
    [id],
  );
  const total = Number(row?.total ?? 0);
  const pending = Number(row?.pending ?? 0);
  const queued = Number(row?.queued ?? 0);
  return {
    total,
    sent: Number(row?.sent ?? 0),
    failed: Number(row?.failed ?? 0),
    pending,
    queued,
    remaining: pending + queued,
  };
}

// Email terkirim dari Hub hari ini (jendela kalender WIB) — dasar panel
// batas harian. Dihitung dari waktu kirim sebenarnya (sent_at), bukan waktu
// item dibuat.
export async function countEmailsSentToday(): Promise<number> {
  const since = startOfTodayStamp();
  const rows = await queryAll<{ n: string | number | null }>(
    `SELECT COUNT(*) AS n FROM email_campaign_items
     WHERE status IN ('sent', 'delivered', 'opened', 'clicked')
       AND sent_at != '' AND sent_at >= ?`,
    [since],
  );
  return Number(rows[0]?.n ?? 0);
}

/** Kampanye yang perlu dilanjutkan otomatis:
 *  - draft yang jadwalnya sudah tiba,
 *  - kampanye berstatus sending yang terputus (tab ditutup / fungsi habis),
 *  - kampanye yang dijeda karena jeda batch (cooldown) dan waktunya tiba.
 *  Jeda manual & fatal tidak pernah dilanjutkan otomatis. */
export async function listDueScheduledEmailCampaigns(): Promise<
  EmailCampaign[]
> {
  const nowUtc = utcStamp();
  return queryAll<EmailCampaign>(
    `SELECT * FROM email_campaigns
     WHERE (status = 'draft' AND scheduled_at != '' AND scheduled_at <= ?)
        OR (status = 'sending' AND (next_run_at = '' OR next_run_at <= ?))
        OR (status = 'paused' AND pause_reason = 'cooldown' AND next_run_at != '' AND next_run_at <= ?)
     ORDER BY id ASC`,
    [nowUtc, nowUtc, nowUtc],
  );
}

// ---------- Statistik via event (pixel buka + berhenti langganan) ----------

/** Urutan status item email: hanya boleh naik. "failed" final. */
const EMAIL_RANK: Record<string, number> = {
  pending: 0,
  queued: 0,
  sent: 1,
  delivered: 2,
  opened: 3,
  clicked: 4,
  failed: 9,
};

/** Nama event → status item. Event lain diabaikan. */
const EMAIL_EVENT_STATUS: Record<string, string> = {
  delivered: "delivered",
  opened: "opened",
  click: "clicked",
};

/** Terapkan satu event ke item kampanye (pixel buka, berhenti langganan,
 *  atau — bila nanti pakai penyedia ber-webhook — delivered/klik/bounce).
 *  Status item hanya naik (guard rank) sehingga event dobel tidak
 *  menggandakan counter kampanye maupun status kontak. */
export async function applyEmailEvent(
  campaignItemId: number,
  event: string,
  detail = "",
): Promise<void> {
  const item = await queryOne<{
    id: number;
    campaign_id: number;
    email: string;
    status: string;
  }>(
    "SELECT id, campaign_id, email, status FROM email_campaign_items WHERE id = ?",
    [campaignItemId],
  );
  if (!item) return;
  const current = EMAIL_RANK[item.status] ?? 0;
  const insert = () =>
    queryRun(
      "INSERT INTO email_events (event, campaign_item_id, detail) VALUES (?, ?, ?)",
      [event, campaignItemId, detail],
    );

  // Berhenti berlangganan / keluhan spam: dedupe lewat tabel event — satu
  // kontak hanya dihitung satu kali walau event unsubscribed & complaint
  // dua-duanya datang.
  if (event === "unsubscribed" || event === "complaint") {
    const exists = await queryOne<{ x: number }>(
      "SELECT 1 AS x FROM email_events WHERE campaign_item_id = ? AND event IN ('unsubscribed', 'complaint')",
      [campaignItemId],
    );
    if (!exists) {
      await insert();
      await queryRun(
        "UPDATE email_campaigns SET unsubscribed = unsubscribed + 1 WHERE id = ?",
        [item.campaign_id],
      );
      const contact = await getEmailContactByEmail(item.email);
      if (contact) await setEmailContactStatus(contact.id, "unsubscribed");
    }
    return;
  }

  // Bounce (keras/lunak): item gagal + kontak ditandai (hanya hard bounce
  // yang menandai kontak, supaya salah ketik tidak langsung dibuang).
  if (event === "hard_bounce" || event === "soft_bounce") {
    if (current >= EMAIL_RANK.failed) return;
    await queryRun(
      "UPDATE email_campaign_items SET status = 'failed', error = ? WHERE id = ?",
      [`${event} ${detail}`.trim(), campaignItemId],
    );
    await queryRun(
      "UPDATE email_campaigns SET bounced = bounced + 1 WHERE id = ?",
      [item.campaign_id],
    );
    await insert();
    if (event === "hard_bounce") {
      const contact = await getEmailContactByEmail(item.email);
      if (contact) await setEmailContactStatus(contact.id, "bounced");
    }
    return;
  }

  const nextStatus = EMAIL_EVENT_STATUS[event];
  if (!nextStatus) return;
  const next = EMAIL_RANK[nextStatus] ?? 0;
  if (next <= current) return; // status tidak boleh turun / event lama
  await queryRun(
    "UPDATE email_campaign_items SET status = ? WHERE id = ?",
    [nextStatus, campaignItemId],
  );
  if (nextStatus === "opened") {
    await queryRun(
      "UPDATE email_campaigns SET opened = opened + 1 WHERE id = ?",
      [item.campaign_id],
    );
  }
  if (nextStatus === "clicked") {
    await queryRun(
      "UPDATE email_campaigns SET clicked = clicked + 1 WHERE id = ?",
      [item.campaign_id],
    );
  }
  await insert();
}
