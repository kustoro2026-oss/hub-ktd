// Ajukan nama tampilan baru lewat API Meta
// (POST /{phone-number-id}?new_display_name=...). Nama masuk antrean
// verifikasi Meta (maks 10 perubahan per 30 hari); statusnya dipantau
// lewat GET /api/wa/display-name-status dan diterapkan dengan
// /api/wa/register-apply (PIN 2 langkah).
import { isAuthed } from "@/lib/auth";
import { updateDisplayName } from "@/lib/wa";

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
  if (name.length < 3 || name.length > 25) {
    return Response.json(
      { error: "Nama tampilan harus 3–25 karakter" },
      { status: 400 },
    );
  }
  const result = await updateDisplayName(name);
  return Response.json(result);
}
