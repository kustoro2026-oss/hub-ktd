// Keanggotaan grup email satu kontak: PUT ganti seluruh grup, POST
// tambahkan banyak kontak ke satu grup. Semua mutasi butuh login admin.
import { isAuthed } from "@/lib/auth";
import {
  addEmailContactsToGroup,
  listEmailGroups,
  setEmailContactGroups,
} from "@/lib/db";

async function groupExists(groupId: number): Promise<boolean> {
  const groups = await listEmailGroups();
  return groups.some((g) => g.id === groupId);
}

export async function PUT(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  let body: { contactId?: number; groupIds?: number[] } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body tidak valid" }, { status: 400 });
  }
  if (!body.contactId) {
    return Response.json({ error: "contactId wajib diisi" }, { status: 400 });
  }
  const groupIds = Array.isArray(body.groupIds) ? body.groupIds : [];
  const unique = [...new Set(groupIds.map(Number).filter((n) => n > 0))];
  for (const gid of unique) {
    if (!(await groupExists(gid))) {
      return Response.json({ error: "Grup tidak ditemukan" }, { status: 400 });
    }
  }
  await setEmailContactGroups(body.contactId, unique);
  return Response.json({ ok: true });
}

export async function POST(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  let body: { contactIds?: number[]; groupId?: number } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body tidak valid" }, { status: 400 });
  }
  const groupId = body.groupId ?? 0;
  const contactIds = Array.isArray(body.contactIds)
    ? body.contactIds.map(Number).filter((n) => n > 0)
    : [];
  if (!groupId || contactIds.length === 0) {
    return Response.json(
      { error: "groupId dan contactIds wajib diisi" },
      { status: 400 },
    );
  }
  if (!(await groupExists(groupId))) {
    return Response.json({ error: "Grup tidak ditemukan" }, { status: 400 });
  }
  await addEmailContactsToGroup(contactIds, groupId);
  return Response.json({ ok: true });
}
