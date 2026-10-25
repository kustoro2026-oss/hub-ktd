// Hapus banyak kontak email berdasarkan alamat (bukan id) — dipakai
// pembersih email tidak aktif: daftar hasil paste (notifikasi Gmail
// "Delivery incomplete") maupun daftar gagal kampanye.
//
// body { emails: string[] }
import { isAuthed } from "@/lib/auth";
import { deleteEmailContactsByEmails } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  let body: { emails?: string[] } = {};
  try {
    body = (await request.json()) as { emails?: string[] };
  } catch {
    return Response.json({ error: "Body tidak valid" }, { status: 400 });
  }
  const emails = Array.isArray(body.emails)
    ? body.emails
        .map((e) => String(e ?? "").trim().toLowerCase())
        .filter(Boolean)
    : [];
  if (emails.length === 0) {
    return Response.json({ error: "Daftar email wajib diisi" }, { status: 400 });
  }
  if (emails.length > 5000) {
    return Response.json(
      { error: "Maksimal 5000 alamat per sekali hapus" },
      { status: 400 },
    );
  }
  const deleted = await deleteEmailContactsByEmails(emails);
  return Response.json({
    ok: true,
    deleted,
    requested: emails.length,
    missing: emails.length - deleted,
  });
}
