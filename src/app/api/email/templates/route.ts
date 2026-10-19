// Kelola template email (HTML + variabel {{...}}): GET daftar, POST buat,
// PATCH ubah subject/body/bahasa, DELETE hapus. Semua mutasi butuh login
// admin. Template disimpan di DB KTD Hub sendiri (bukan dashboard penyedia)
// supaya variabel dan pratinjau konsisten dengan pola template WhatsApp.
import { isAuthed } from "@/lib/auth";
import {
  createEmailTemplate,
  deleteEmailTemplate,
  listEmailTemplates,
  updateEmailTemplate,
} from "@/lib/db";

const NAME_RE = /^[a-z0-9][a-z0-9 _-]{1,60}$/i;

export async function GET() {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  return Response.json({ ok: true, templates: await listEmailTemplates() });
}

export async function POST(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  let body: { name?: string; subject?: string; html_body?: string; lang?: string } =
    {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body tidak valid" }, { status: 400 });
  }
  const name = (body.name ?? "").trim();
  const subject = (body.subject ?? "").trim();
  const html = body.html_body ?? "";
  if (!NAME_RE.test(name)) {
    return Response.json(
      { error: "Nama template 2–60 karakter (huruf, angka, spasi, - atau _)" },
      { status: 400 },
    );
  }
  if (!subject) {
    return Response.json({ error: "Subjek email wajib diisi" }, { status: 400 });
  }
  if (subject.length > 300) {
    return Response.json(
      { error: "Subjek maksimal 300 karakter" },
      { status: 400 },
    );
  }
  if (!html.trim()) {
    return Response.json({ error: "Isi email wajib diisi" }, { status: 400 });
  }
  try {
    const template = await createEmailTemplate(
      name,
      subject,
      html,
      (body.lang ?? "id").trim() || "id",
    );
    return Response.json({ ok: true, template }, { status: 201 });
  } catch {
    return Response.json({ error: "Nama template sudah ada" }, { status: 409 });
  }
}

export async function PATCH(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  let body: { id?: number; subject?: string; html_body?: string; lang?: string } =
    {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body tidak valid" }, { status: 400 });
  }
  const subject = (body.subject ?? "").trim();
  const html = body.html_body ?? "";
  if (!body.id) {
    return Response.json({ error: "id template wajib diisi" }, { status: 400 });
  }
  if (!subject || !html.trim()) {
    return Response.json(
      { error: "Subjek dan isi email wajib diisi" },
      { status: 400 },
    );
  }
  await updateEmailTemplate(
    body.id,
    subject,
    html,
    (body.lang ?? "id").trim() || "id",
  );
  return Response.json({ ok: true });
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
    return Response.json({ error: "id template wajib diisi" }, { status: 400 });
  }
  await deleteEmailTemplate(body.id);
  return Response.json({ ok: true });
}
