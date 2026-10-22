// Pindah kontak ke grup email. Satu kontak hanya punya SATU grup:
//   PUT  { contactId, groupId }        — pindahkan satu kontak
//   POST { contactIds: number[], groupId } — pindahkan banyak kontak
// Tidak ada lagi penambahan keanggotaan ganda.
import { isAuthed } from "@/lib/auth";
import { listEmailGroups, moveEmailContactsToGroup } from "@/lib/db";

async function groupName(groupId: number): Promise<string | null> {
  const groups = await listEmailGroups();
  return groups.find((g) => g.id === groupId)?.name ?? null;
}

export async function PUT(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  let body: { contactId?: number; groupId?: number } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body tidak valid" }, { status: 400 });
  }
  const contactId = Number(body.contactId ?? 0);
  const groupId = Number(body.groupId ?? 0);
  if (!contactId || !groupId) {
    return Response.json(
      { error: "contactId dan groupId wajib diisi" },
      { status: 400 },
    );
  }
  if (!(await groupName(groupId))) {
    return Response.json({ error: "Grup tidak ditemukan" }, { status: 400 });
  }
  const moved = await moveEmailContactsToGroup([contactId], groupId);
  return Response.json({ ok: true, moved });
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
  const groupId = Number(body.groupId ?? 0);
  const contactIds = Array.isArray(body.contactIds)
    ? body.contactIds.map(Number).filter((n) => n > 0)
    : [];
  if (!groupId || contactIds.length === 0) {
    return Response.json(
      { error: "groupId dan contactIds wajib diisi" },
      { status: 400 },
    );
  }
  if (!(await groupName(groupId))) {
    return Response.json({ error: "Grup tidak ditemukan" }, { status: 400 });
  }
  const moved = await moveEmailContactsToGroup(contactIds, groupId);
  return Response.json({ ok: true, moved });
}
