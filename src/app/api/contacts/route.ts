// CRUD kontak: POST tambah (opsional langsung masuk satu grup),
// DELETE hapus (satu atau banyak sekaligus). Semua mutasi butuh login admin.
import { isAuthed } from "@/lib/auth";
import {
  addContact,
  addContactsToGroup,
  deleteContacts,
  listGroups,
} from "@/lib/db";
import { normalizePhone } from "@/lib/wa";

export async function POST(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  let body: {
    name?: string;
    phone?: string;
    note?: string;
    groupId?: number;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body tidak valid" }, { status: 400 });
  }
  const phone = body.phone ? normalizePhone(body.phone) : null;
  if (!phone) {
    return Response.json(
      { error: "Nomor tidak valid (contoh: 0821xxxxxxx)" },
      { status: 400 },
    );
  }
  const groupId = body.groupId ?? 0;
  if (groupId > 0) {
    const groups = await listGroups();
    if (!groups.some((g) => g.id === groupId)) {
      return Response.json({ error: "Grup tidak ditemukan" }, { status: 400 });
    }
  }
  try {
    const contact = await addContact(body.name ?? "", phone, body.note ?? "");
    if (groupId > 0) {
      await addContactsToGroup([contact.id], groupId);
    }
    return Response.json({ ok: true, contact }, { status: 201 });
  } catch {
    return Response.json({ error: "Nomor sudah ada di daftar" }, { status: 409 });
  }
}

export async function DELETE(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  let body: { id?: number; ids?: number[] } = {};
  try {
    body = (await request.json()) as { id?: number; ids?: number[] };
  } catch {
    return Response.json({ error: "Body tidak valid" }, { status: 400 });
  }
  const ids = body.ids?.length
    ? body.ids
    : body.id
      ? [body.id]
      : [];
  if (ids.length === 0) {
    return Response.json({ error: "id kontak wajib diisi" }, { status: 400 });
  }
  const deleted = await deleteContacts(ids);
  return Response.json({ ok: true, deleted });
}
