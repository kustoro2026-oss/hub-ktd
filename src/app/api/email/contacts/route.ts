// CRUD kontak email: GET daftar, POST tambah (WAJIB satu grup), PATCH ubah
// status langganan, DELETE hapus (satu atau banyak sekaligus). Semua mutasi
// butuh login admin. Satu kontak = satu grup — tidak ada daftar umum.
import { isAuthed } from "@/lib/auth";
import {
  addEmailContact,
  deleteEmailContacts,
  listEmailContacts,
  listEmailGroups,
  setEmailContactStatus,
} from "@/lib/db";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET() {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
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
  const email = (body.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return Response.json(
      { error: "Alamat email tidak valid (contoh: nama@gmail.com)" },
      { status: 400 },
    );
  }
  const groupId = Number(body.groupId ?? 0);
  if (!groupId) {
    return Response.json(
      { error: "Grup wajib dipilih — buat grup dulu di Langkah 1" },
      { status: 400 },
    );
  }
  const groups = await listEmailGroups();
  if (!groups.some((g) => g.id === groupId)) {
    return Response.json({ error: "Grup tidak ditemukan" }, { status: 400 });
  }
  try {
    const result = await addEmailContact(
      body.name ?? "",
      email,
      body.note ?? "",
      groupId,
    );
    return Response.json(
      {
        ok: true,
        contact: result.contact,
        created: result.created,
        movedFrom: result.movedFrom,
      },
      { status: result.created ? 201 : 200 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Gagal menyimpan kontak email";
    return Response.json({ error: msg }, { status: 500 });
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
  await setEmailContactStatus(
    body.id,
    status as "subscribed" | "unsubscribed" | "bounced",
  );
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
    return Response.json({ error: "id kontak wajib diisi" }, { status: 400 });
  }
  const deleted = await deleteEmailContacts(ids);
  return Response.json({ ok: true, deleted });
}
