// CRUD grup kontak: buat, ganti nama, hapus. Semua mutasi butuh login
// admin. Menghapus grup TIDAK menghapus kontak anggotanya.
import { isAuthed } from "@/lib/auth";
import {
  createGroup,
  deleteGroup,
  listGroups,
  renameGroup,
} from "@/lib/db";

export async function GET() {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  return Response.json(await listGroups());
}

export async function POST(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  let body: { name?: string } = {};
  try {
    body = (await request.json()) as { name?: string };
  } catch {
    return Response.json({ error: "Body tidak valid" }, { status: 400 });
  }
  const name = (body.name ?? "").trim();
  if (name.length < 2 || name.length > 40) {
    return Response.json({ error: "Nama grup harus 2–40 karakter" }, { status: 400 });
  }
  try {
    const group = await createGroup(name);
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
    body = (await request.json()) as { id?: number; name?: string };
  } catch {
    return Response.json({ error: "Body tidak valid" }, { status: 400 });
  }
  if (!body.id) {
    return Response.json({ error: "id grup wajib diisi" }, { status: 400 });
  }
  const name = (body.name ?? "").trim();
  if (name.length < 2 || name.length > 40) {
    return Response.json({ error: "Nama grup harus 2–40 karakter" }, { status: 400 });
  }
  await renameGroup(body.id, name);
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  let body: { id?: number } = {};
  try {
    body = (await request.json()) as { id?: number };
  } catch {
    return Response.json({ error: "Body tidak valid" }, { status: 400 });
  }
  if (!body.id) {
    return Response.json({ error: "id grup wajib diisi" }, { status: 400 });
  }
  await deleteGroup(body.id);
  return Response.json({ ok: true });
}
