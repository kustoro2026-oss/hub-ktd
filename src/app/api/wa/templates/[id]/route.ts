// Ajukan ulang (edit) template yang DITOLAK Meta — isi baru masuk
// antrean review lagi tanpa membuat nama baru.
import { isAuthed } from "@/lib/auth";
import { editTemplate } from "@/lib/wa";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  let body: { body?: string; example?: string[] } = {};
  try {
    body = (await request.json()) as { body?: string; example?: string[] };
  } catch {
    return Response.json({ error: "Body tidak valid" }, { status: 400 });
  }
  const text = (body.body ?? "").trim();
  if (text.length < 1 || text.length > 1024) {
    return Response.json(
      { error: "Isi pesan harus 1–1024 karakter" },
      { status: 400 },
    );
  }
  const { id } = await params;
  const result = await editTemplate(id, {
    body: text,
    example: body.example?.map((e) => e.trim()).filter(Boolean),
  });
  return Response.json(result);
}
