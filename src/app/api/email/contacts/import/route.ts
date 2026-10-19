// Import massal kontak email: body { text, groupId? }. Satu baris = satu
// kontak dengan format "Nama, email" atau email saja (pemisah koma
// terakhir — nama boleh mengandung koma). Baris kosong dilewati, alamat
// tidak valid dilaporkan, alamat ganda tidak diduplikasi.
import { isAuthed } from "@/lib/auth";
import {
  addEmailContact,
  addEmailContactsToGroup,
  listEmailGroups,
} from "@/lib/db";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const groupId = body.groupId ?? 0;
  if (groupId > 0) {
    const groups = await listEmailGroups();
    if (!groups.some((g) => g.id === groupId)) {
      return Response.json({ error: "Grup tidak ditemukan" }, { status: 400 });
    }
  }

  const rows = (body.text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (rows.length === 0) {
    return Response.json({ error: "Tidak ada baris untuk diimpor" }, { status: 400 });
  }

  let added = 0;
  let skipped = 0;
  const invalid: string[] = [];
  const importedIds: number[] = [];
  for (const line of rows) {
    const comma = line.lastIndexOf(",");
    const name = comma >= 0 ? line.slice(0, comma).trim() : "";
    const email = (comma >= 0 ? line.slice(comma + 1) : line).trim();
    if (!EMAIL_RE.test(email)) {
      invalid.push(line.length > 60 ? `${line.slice(0, 60)}…` : line);
      skipped++;
      continue;
    }
    try {
      const contact = await addEmailContact(name, email);
      importedIds.push(contact.id);
      added++;
    } catch {
      skipped++;
    }
  }
  if (groupId > 0 && importedIds.length > 0) {
    await addEmailContactsToGroup(importedIds, groupId);
  }
  return Response.json({
    ok: true,
    added,
    skipped,
    invalid: invalid.slice(0, 10),
    groupId: groupId > 0 ? groupId : undefined,
  });
}
