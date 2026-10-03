// CRUD kontak: POST tambah, DELETE hapus. Semua mutasi butuh login admin.
import { isAuthed } from "@/lib/auth";
import { addContact, deleteContact } from "@/lib/db";
import { normalizePhone } from "@/lib/wa";

export async function POST(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  let body: { name?: string; phone?: string; note?: string } = {};
  try {
    body = (await request.json()) as { name?: string; phone?: string };
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
  try {
    const contact = await addContact(body.name ?? "", phone, body.note ?? "");
    return Response.json({ ok: true, contact }, { status: 201 });
  } catch {
    return Response.json({ error: "Nomor sudah ada di daftar" }, { status: 409 });
  }
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
    return Response.json({ error: "id kontak wajib diisi" }, { status: 400 });
  }
  await deleteContact(body.id);
  return Response.json({ ok: true });
}
