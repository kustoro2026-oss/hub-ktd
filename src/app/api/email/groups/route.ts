// Kelola grup kontak email: GET daftar + jumlah anggota, POST buat,
// PATCH ganti nama, DELETE hapus. Grup yang masih berisi kontak TIDAK
// boleh dihapus — kontak tidak punya daftar umum tempat mendarat.
import { isAuthed } from "@/lib/auth";
import {
  countEmailContactsInGroup,
  createEmailGroup,
  deleteEmailGroup,
  listEmailGroups,
  renameEmailGroup,
} from "@/lib/db";

export async function GET() {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  return Response.json({ ok: true, groups: await listEmailGroups() });
}

export async function POST(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  let body: { name?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body tidak valid" }, { status: 400 });
  }
  const name = (body.name ?? "").trim();
  if (name.length < 2) {
    return Response.json({ error: "Nama grup minimal 2 karakter" }, { status: 400 });
  }
  try {
    const group = await createEmailGroup(name);
    return Response.json({ ok: true, group }, { status: 201 });
  } catch {
    return Response.json({ error: "Nama grup sudah ada" }, { status: 409 });
  }
}

export async function PATCH(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  let body: { id?: number; name?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body tidak valid" }, { status: 400 });
  }
  const name = (body.name ?? "").trim();
  if (!body.id || name.length < 2) {
    return Response.json(
      { error: "id dan nama (minimal 2 karakter) wajib diisi" },
      { status: 400 },
    );
  }
  try {
    await renameEmailGroup(body.id, name);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Nama grup sudah ada" }, { status: 409 });
  }
}

export async function DELETE(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  let body: { id?: number } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body tidak valid" }, { status: 400 });
  }
  if (!body.id) {
    return Response.json({ error: "id grup wajib diisi" }, { status: 400 });
  }
  const members = await countEmailContactsInGroup(body.id);
  if (members > 0) {
    return Response.json(
      {
        error: `Grup masih berisi ${members} kontak. Pindahkan atau hapus kontaknya dulu, baru hapus grup.`,
      },
      { status: 409 },
    );
  }
  await deleteEmailGroup(body.id);
  return Response.json({ ok: true });
}
