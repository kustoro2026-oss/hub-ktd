// Atur keanggotaan grup kontak.
// PUT  {contactId, groupIds}   — ganti seluruh grup satu kontak.
// POST {contactIds, groupId}   — tambahkan banyak kontak ke satu grup
//                                (keanggotaan lama dipertahankan).
import { isAuthed } from "@/lib/auth";
import { addContactsToGroup, setContactGroups } from "@/lib/db";

export async function PUT(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  let body: { contactId?: number; groupIds?: number[] } = {};
  try {
    body = (await request.json()) as { contactId?: number; groupIds?: number[] };
  } catch {
    return Response.json({ error: "Body tidak valid" }, { status: 400 });
  }
  if (!body.contactId) {
    return Response.json({ error: "contactId wajib diisi" }, { status: 400 });
  }
  const groupIds = (body.groupIds ?? []).filter(
    (n) => Number.isInteger(n) && n > 0,
  );
  await setContactGroups(body.contactId, groupIds);
  return Response.json({ ok: true });
}

export async function POST(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  let body: { contactIds?: number[]; groupId?: number } = {};
  try {
    body = (await request.json()) as { contactIds?: number[]; groupId?: number };
  } catch {
    return Response.json({ error: "Body tidak valid" }, { status: 400 });
  }
  if (!body.groupId) {
    return Response.json({ error: "groupId wajib diisi" }, { status: 400 });
  }
  const contactIds = (body.contactIds ?? []).filter(
    (n) => Number.isInteger(n) && n > 0,
  );
  if (contactIds.length === 0) {
    return Response.json({ error: "Tidak ada kontak terpilih" }, { status: 400 });
  }
  await addContactsToGroup(contactIds, body.groupId);
  return Response.json({ ok: true });
}
