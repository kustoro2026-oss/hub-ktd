// CRUD kontak email: GET daftar, POST tambah (opsional langsung masuk satu
// grup), PATCH ubah status (unsubscribe manual), DELETE hapus (satu atau
// banyak sekaligus). Semua mutasi butuh login admin. Alamat email
// diduplikasi-aman — baris lama diperbarui.
import { isAuthed } from "@/lib/auth";
import {
  addEmailContact,
  addEmailContactsToGroup,
  deleteEmailContacts,
  listEmailGroups,
  setEmailContactStatus,
} from "@/lib/db";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET() {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const { listEmailContacts } = await import("@/lib/db");
  return Response.json({ ok: true, contacts: await listEmailContacts() });
}

export async function POST(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  let body: {
    name?: string;
    email?: string;
    note?: string;
    groupId?: number;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body tidak valid" }, { status: 400 });
  }
  const email = (body.email ?? "").trim();
  if (!EMAIL_RE.test(email)) {
    return Response.json(
      { error: "Alamat email tidak valid (contoh: nama@gmail.com)" },
      { status: 400 },
    );
  }
  const groupId = body.groupId ?? 0;
  if (groupId > 0) {
    const groups = await listEmailGroups();
    if (!groups.some((g) => g.id === groupId)) {
      return Response.json({ error: "Grup tidak ditemukan" }, { status: 400 });
    }
  }
  try {
    const contact = await addEmailContact(body.name ?? "", email, body.note ?? "");
    if (groupId > 0) {
      await addEmailContactsToGroup([contact.id], groupId);
    }
    return Response.json({ ok: true, contact }, { status: 201 });
  } catch {
    return Response.json(
      { error: "Gagal menyimpan kontak email" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  let body: { id?: number; status?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body tidak valid" }, { status: 400 });
  }
  const status = (body.status ?? "").trim();
  if (!body.id || !["subscribed", "unsubscribed", "bounced"].includes(status)) {
    return Response.json(
      { error: "id kontak dan status (subscribed/unsubscribed/bounced) wajib" },
      { status: 400 },
    );
  }
  await setEmailContactStatus(body.id, status as "subscribed" | "unsubscribed" | "bounced");
  return Response.json({ ok: true });
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
  const ids = body.ids?.length ? body.ids : body.id ? [body.id] : [];
  if (ids.length === 0) {
    return Response.json(
      { error: "id kontak wajib diisi" },
      { status: 400 },
    );
  }
  const deleted = await deleteEmailContacts(ids);
  return Response.json({ ok: true, deleted });
}
