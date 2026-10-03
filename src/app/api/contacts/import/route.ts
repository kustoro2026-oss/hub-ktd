// Import banyak kontak sekaligus. Format per baris:
//   "Nama, 0821xxxxxxxx"  atau cukup "0821xxxxxxxx"
// Baris yang nomornya tidak valid / duplikat dilewati dan dilaporkan.
import { isAuthed } from "@/lib/auth";
import { addContact } from "@/lib/db";
import { normalizePhone } from "@/lib/wa";

export async function POST(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  let body: { text?: string } = {};
  try {
    body = (await request.json()) as { text?: string };
  } catch {
    return Response.json({ error: "Body tidak valid" }, { status: 400 });
  }
  const lines = (body.text ?? "").split(/\r?\n/);
  let added = 0;
  const skipped: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    // Format: nama, nomor — nama opsional.
    const parts = line.split(/[;,]\s*/);
    let name = "";
    let phoneRaw = line;
    if (parts.length >= 2 && /\d/.test(parts[parts.length - 1])) {
      name = parts.slice(0, -1).join(" ").trim();
      phoneRaw = parts[parts.length - 1].trim();
    }
    const phone = normalizePhone(phoneRaw);
    if (!phone) {
      skipped.push(line);
      continue;
    }
    try {
      addContact(name, phone);
      added++;
    } catch {
      skipped.push(line); // duplikat
    }
  }
  return Response.json({ ok: true, added, skipped });
}
