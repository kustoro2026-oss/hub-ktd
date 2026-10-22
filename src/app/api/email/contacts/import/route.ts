// Import massal kontak email ke SATU grup wajib.
//
// Semua baris diproses dulu di memori (bukan per baris ke database) supaya
// angka laporan bisa direkonsiliasi dengan isi grup:
//   total baris → valid → unik → baru / diperbarui / dipindah
// Setiap import dicatat di email_import_runs sehingga kejadian "import 400
// tapi grup hanya 300" bisa ditelusuri kapan saja.
//
// Format baris yang diterima: "Nama, email", "Nama; email", "email, Nama",
// "Nama <email>", atau email saja. Alamat di mana pun dalam baris dikenali.
import { isAuthed } from "@/lib/auth";
import {
  bulkUpsertEmailContacts,
  countEmailContactsInGroup,
  listEmailGroups,
  logEmailImportRun,
} from "@/lib/db";

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

function parseLine(line: string): { name: string; email: string } | null {
  const match = line.match(EMAIL_RE);
  if (!match) return null;
  const email = match[0].trim().toLowerCase();
  // Nama = sisa baris setelah alamat dibuang, pemisah & tanda kutip dibuang.
  const name = line
    .replace(match[0], " ")
    .replace(/[<>"';,|\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return { name, email };
}

export async function POST(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  let body: { text?: string; groupId?: number } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body tidak valid" }, { status: 400 });
  }

  const groupId = Number(body.groupId ?? 0);
  if (!groupId) {
    return Response.json(
      { error: "Grup wajib dipilih — buat grup dulu di Langkah 1" },
      { status: 400 },
    );
  }
  const groups = await listEmailGroups();
  const group = groups.find((g) => g.id === groupId);
  if (!group) {
    return Response.json({ error: "Grup tidak ditemukan" }, { status: 400 });
  }

  const lines = (body.text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) {
    return Response.json(
      { error: "Tidak ada baris untuk diimpor" },
      { status: 400 },
    );
  }

  let validLines = 0;
  let duplicates = 0;
  const invalid: string[] = [];
  const seen = new Set<string>();
  const rows: { name: string; email: string }[] = [];

  for (const line of lines) {
    const parsed = parseLine(line);
    if (!parsed) {
      invalid.push(line.length > 80 ? `${line.slice(0, 80)}…` : line);
      continue;
    }
    validLines++;
    if (seen.has(parsed.email)) {
      duplicates++;
      continue;
    }
    seen.add(parsed.email);
    rows.push(parsed);
  }

  if (rows.length === 0) {
    return Response.json(
      {
        ok: false,
        error: "Tidak ada alamat email valid yang bisa diimpor",
        totalLines: lines.length,
        validLines,
        invalid: invalid.slice(0, 20),
      },
      { status: 400 },
    );
  }

  const saved = await bulkUpsertEmailContacts(rows, groupId);
  const memberCount = await countEmailContactsInGroup(groupId);

  await logEmailImportRun({
    group_id: groupId,
    group_name: group.name,
    total_lines: lines.length,
    valid_lines: validLines,
    unique_emails: rows.length,
    added: saved.added,
    updated: saved.updated,
    moved: saved.moved,
    duplicates,
    invalid: invalid.length,
    detail: invalid.slice(0, 20).join(" | ").slice(0, 2000),
  });

  return Response.json({
    ok: true,
    groupId,
    groupName: group.name,
    totalLines: lines.length,
    validLines,
    uniqueEmails: rows.length,
    added: saved.added,
    updated: saved.updated,
    moved: saved.moved,
    duplicates,
    invalid,
    invalidCount: invalid.length,
    memberCount,
  });
}
