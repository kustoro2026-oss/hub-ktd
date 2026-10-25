// Pemindai bounce email via IMAP — pendamping mesin kirim Gmail SMTP.
//
// Gmail tidak memberi webhook statistik, tetapi notifikasi gagal kirim
// (NDR — "Delivery incomplete", "Address not found", "Undelivered Mail
// Returned to Sender") masuk kembali ke INBOX akun pengirim dari
// mailer-daemon. Pemindai ini membaca pesan tersebut lewat IMAP dan
// membersihkan daftar kontak otomatis:
//
// - hard bounce (alamat tidak ada / ditolak permanen) → kontak dihapus
// - soft bounce (masalah sementara, "Gmail will retry") → cacahan +1;
//   pada cacahan ke-2 kontak dihapus (alamat terbukti mati).
//
// Hanya pesan dari mailer-daemon/postmaster yang disentuh; pesan lain
// tidak pernah ditandai terbaca. Kiriman sukses ke alamat yang sama
// mereset cacahan (lihat email-send.ts).
import { ImapFlow } from "imapflow";
import {
  deleteEmailContactsByEmails,
  getEmailContactByEmail,
  incrementEmailContactBounceStrike,
  listEmailSmtpAccounts,
} from "@/lib/db";

/** Cacahan soft-bounce yang membuat kontak dihapus. */
const SOFT_BOUNCE_DELETE_AT = 2;
/** Maksimal pesan NDR diproses per akun per ronde — batas waktu aman. */
const MAX_NDR_PER_ACCOUNT = 50;

export type EmailBounceScanResult = {
  ok: boolean;
  accounts: number;
  scanned: number;
  hardDeleted: number;
  softStrikes: number;
  softDeleted: number;
  errors: string[];
};

const EMAIL_FIND = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Penanda NDR dari Gmail / mailer-daemon umum. */
function isNdrSender(address: string): boolean {
  const a = (address || "").toLowerCase();
  return (
    a.includes("mailer-daemon") ||
    a.includes("postmaster") ||
    a.includes("mail-delivery-subsystem")
  );
}

function isNdrSubject(subject: string): boolean {
  const s = (subject || "").toLowerCase();
  return (
    s.includes("delivery status notification") ||
    s.includes("undelivered mail returned") ||
    s.includes("delivery incomplete") ||
    s.includes("delivery failed") ||
    s.includes("failure notice") ||
    s.includes("returned to sender")
  );
}

/** Marker kegagalan permanen (alamat mati). */
function isHardBounce(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes("address not found") ||
    t.includes("user unknown") ||
    t.includes("no such user") ||
    t.includes("does not exist") ||
    t.includes("recipient address rejected") ||
    t.includes("unrouteable") ||
    t.includes("unroutable") ||
    t.includes("mailbox unavailable") ||
    t.includes("unknown recipient") ||
    t.includes("550 5.1.1") ||
    t.includes("554 delivery error")
  );
}

/** Marker kegagalan sementara (Gmail akan mencoba ulang). */
function isSoftBounce(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes("will retry") ||
    t.includes("temporary problem") ||
    t.includes("delivery incomplete") ||
    t.includes("temporarily rejected") ||
    t.includes("over quota") ||
    t.includes("mailbox full") ||
    t.includes("try again") ||
    t.includes("4.2.1") ||
    t.includes("4.2.2") ||
    t.includes("421")
  );
}

/** Kumpulkan alamat email yang dikenal (ada di kontak) dari teks NDR —
 *  mengabaikan alamat pengirim akun dan alamat mailer-daemon. */
async function knownRecipients(
  text: string,
  senderEmail: string,
): Promise<string[]> {
  const found = new Set<string>();
  for (const m of text.matchAll(EMAIL_FIND)) {
    const addr = m[0].toLowerCase();
    if (addr === senderEmail.toLowerCase()) continue;
    if (isNdrSender(addr)) continue;
    if (found.has(addr)) continue;
    found.add(addr);
  }
  const known: string[] = [];
  for (const addr of found) {
    const contact = await getEmailContactByEmail(addr);
    if (contact) known.push(addr);
    // Amankan waktu: maksimal 12 kandidat per pesan.
    if (known.length >= 12) break;
  }
  return known;
}

/** Pindai INBOX satu akun SMTP untuk NDR. Mengembalikan ringkasan. */
async function scanAccount(
  account: {
    imap_host: string;
    imap_port: number;
    imap_secure: number;
    username: string;
    password: string;
    sender_email: string;
    name: string;
  },
  budget: { deadline: number },
  summary: {
    scanned: number;
    hardDeleted: number;
    softStrikes: number;
    softDeleted: number;
  },
): Promise<string | undefined> {
  const client = new ImapFlow({
    host: account.imap_host,
    port: account.imap_port,
    secure: account.imap_secure === 1,
    auth: { user: account.username, pass: account.password },
    logger: false,
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      // Amplop dulu (murah) → filter NDR → ambil sumber hanya yang cocok.
      const candidates: { uid: number }[] = [];
      for await (const msg of client.fetch("UNSEEN", { envelope: true }, { uid: true })) {
        const from = msg.envelope?.from?.[0]?.address ?? "";
        const subject = msg.envelope?.subject ?? "";
        if (isNdrSender(from) || isNdrSubject(subject)) {
          candidates.push({ uid: msg.uid });
          if (candidates.length >= MAX_NDR_PER_ACCOUNT) break;
        }
      }
      if (candidates.length === 0) return undefined;

      const uids = candidates.map((c) => c.uid);
      for await (const msg of client.fetch(
        { uid: uids.join(",") },
        { source: true, envelope: true },
        { uid: true },
      )) {
        if (Date.now() > budget.deadline) break;
        const source = String(msg.source ?? "");
        const text = source.replace(/=\r?\n/g, "").replace(/=3D/g, "=");
        const recipients = await knownRecipients(
          text,
          account.sender_email || account.username,
        );
        if (recipients.length === 0) {
          // NDR bukan milik kampanye kita — tetap tandai terbaca supaya
          // tidak dipindai ulang tiap ronde.
          try {
            await msg.flags?.add("\\Seen");
          } catch {
            // abaikan — akan dicoba ronde berikutnya
          }
          continue;
        }
        summary.scanned++;
        const hard = isHardBounce(text);
        for (const addr of recipients) {
          if (hard) {
            const deleted = await deleteEmailContactsByEmails([addr]);
            if (deleted > 0) summary.hardDeleted++;
          } else if (isSoftBounce(text)) {
            const strikes = await incrementEmailContactBounceStrike(addr);
            if (strikes === 0) continue; // tidak ada di kontak
            if (strikes >= SOFT_BOUNCE_DELETE_AT) {
              const deleted = await deleteEmailContactsByEmails([addr]);
              if (deleted > 0) summary.softDeleted++;
            } else {
              summary.softStrikes++;
            }
          }
        }
        try {
          await msg.flags?.add("\\Seen");
        } catch {
          // abaikan — akan dicoba ronde berikutnya
        }
      }
    } finally {
      lock.release();
    }
    return undefined;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  } finally {
    try {
      await client.logout().catch(() => undefined);
    } catch {
      // abaikan
    }
  }
}

/** Pindai semua akun SMTP aktif yang punya konfigurasi IMAP. Dipanggil
 *  dari worker VPS tiap 5 menit dan dari tombol "Pindai sekarang" di UI. */
export async function runEmailBounceScan(): Promise<EmailBounceScanResult> {
  const accounts = (await listEmailSmtpAccounts(true)).filter(
    (a) => a.active === 1 && (a.imap_host || "").trim() !== "",
  );
  const summary: EmailBounceScanResult = {
    ok: true,
    accounts: accounts.length,
    scanned: 0,
    hardDeleted: 0,
    softStrikes: 0,
    softDeleted: 0,
    errors: [],
  };
  if (accounts.length === 0) return summary;
  const deadline = Date.now() + 55_000;
  for (const account of accounts) {
    if (Date.now() > deadline) {
      summary.errors.push("Batas waktu ronde tercapai — lanjut ronde berikut.");
      break;
    }
    const state = {
      scanned: 0,
      hardDeleted: 0,
      softStrikes: 0,
      softDeleted: 0,
    };
    const error = await scanAccount(account, { deadline }, state);
    if (error) {
      summary.errors.push(
        `Akun "${account.name}": ${error.slice(0, 160)}`,
      );
    }
    summary.scanned += state.scanned;
    summary.hardDeleted += state.hardDeleted;
    summary.softStrikes += state.softStrikes;
    summary.softDeleted += state.softDeleted;
  }
  return summary;
}

