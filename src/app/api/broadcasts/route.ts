// Buat kampanye broadcast baru: nama kampanye + daftar penerima.
// Penerima: semua kontak (default), kontak pilihan (contactIds), atau
// seluruh anggota satu grup (groupId).
import { isAuthed } from "@/lib/auth";
import {
  createBroadcastWithItems,
  listContacts,
  listContactsByGroup,
} from "@/lib/db";

export async function POST(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  let body: {
    name?: string;
    template?: string;
    contactIds?: number[];
    groupId?: number;
  } = {};
  try {
    body = (await request.json()) as {
      name?: string;
      template?: string;
      contactIds?: number[];
      groupId?: number;
    };
  } catch {
    return Response.json({ error: "Body tidak valid" }, { status: 400 });
  }
  if (!body.name?.trim()) {
    return Response.json({ error: "Nama kampanye wajib diisi" }, { status: 400 });
  }

  let selected;
  if (body.groupId) {
    selected = await listContactsByGroup(body.groupId);
  } else if (body.contactIds?.length) {
    const all = await listContacts();
    selected = all.filter((c) => body.contactIds!.includes(c.id));
  } else {
    selected = await listContacts();
  }
  if (selected.length === 0) {
    return Response.json(
      { error: "Tidak ada kontak — tambahkan kontak dulu" },
      { status: 400 },
    );
  }

  const broadcast = await createBroadcastWithItems(
    body.name,
    body.template?.trim() || "info_promo_v2",
    selected.map((c) => ({ contactId: c.id, phone: c.phone })),
    body.groupId ?? null,
  );
  return Response.json({ ok: true, broadcast }, { status: 201 });
}
