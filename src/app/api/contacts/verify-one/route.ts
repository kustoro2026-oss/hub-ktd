// Cek satu kontak ke endpoint contacts Meta (gratis) lalu simpan hasilnya
// di kolom contacts.wa_status. Dicek SATU per SATU dari browser (halaman
// Verifikasi) supaya aman dari batas waktu serverless Vercel.
import { isAuthed } from "@/lib/auth";
import { getContact, setContactWaStatus } from "@/lib/db";
import { checkContactWa } from "@/lib/wa";

export async function POST(request: Request) {
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
  const contact = await getContact(body.id);
  if (!contact) {
    return Response.json({ error: "Kontak tidak ditemukan" }, { status: 404 });
  }
  const result = await checkContactWa(contact.phone);
  await setContactWaStatus(contact.id, result.status);
  return Response.json({
    ok: true,
    id: contact.id,
    status: result.status,
    detail: result.detail ?? "",
  });
}
