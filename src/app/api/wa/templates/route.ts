// Kelola template pesan Meta langsung dari Hub — tidak perlu buka
// WhatsApp Manager lagi. Semua respons HTTP 200 dengan ok/detail supaya
// error dari Meta tampil rapi di UI (konvensi error anggun proyek ini).
import { isAuthed } from "@/lib/auth";
import { createTemplate, deleteTemplate, listTemplates } from "@/lib/wa";

export async function GET() {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  return Response.json(await listTemplates());
}

export async function POST(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  let body: {
    name?: string;
    category?: string;
    language?: string;
    body?: string;
    example?: string[];
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body tidak valid" }, { status: 400 });
  }
  const name = (body.name ?? "").trim();
  if (!/^[a-z][a-z0-9_]{1,60}$/.test(name)) {
    return Response.json(
      { error: "Nama template: huruf kecil, angka, garis bawah (mis. promo_oktober)" },
      { status: 400 },
    );
  }
  const category = body.category ?? "";
  if (!["MARKETING", "UTILITY"].includes(category)) {
    return Response.json(
      { error: "Kategori harus MARKETING atau UTILITY" },
      { status: 400 },
    );
  }
  const language = (body.language ?? "id").trim() || "id";
  const LANGS = ["id", "en", "en_US", "en_GB", "ms", "ar", "zh_CN"];
  if (!LANGS.includes(language)) {
    return Response.json(
      { error: "Bahasa tidak dikenal — pilih dari daftar yang tersedia" },
      { status: 400 },
    );
  }
  const text = (body.body ?? "").trim();
  if (text.length < 1 || text.length > 1024) {
    return Response.json(
      { error: "Isi pesan harus 1–1024 karakter" },
      { status: 400 },
    );
  }
  const example = (body.example ?? []).map((e) => e.trim()).filter(Boolean);
  // Bila pesan memakai variabel {{n}}, Meta menolak tanpa contoh nilai
  // yang lengkap — validasi lebih awal supaya errornya jelas di UI.
  const vars = [...text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) =>
    Number(m[1]),
  );
  const maxVar = vars.length > 0 ? Math.max(...vars) : 0;
  if (maxVar > 0 && example.length < maxVar) {
    return Response.json(
      {
        error: `Pesan memakai variabel {{1}}–{{${maxVar}}} — isi contoh nilai variabel minimal ${maxVar} (pisahkan koma)`,
      },
      { status: 400 },
    );
  }
  const result = await createTemplate({
    name,
    category,
    language,
    body: text,
    example,
  });
  return Response.json(result);
}

export async function DELETE(request: Request) {
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
  if (!name) {
    return Response.json({ error: "name template wajib diisi" }, { status: 400 });
  }
  return Response.json(await deleteTemplate(name));
}
