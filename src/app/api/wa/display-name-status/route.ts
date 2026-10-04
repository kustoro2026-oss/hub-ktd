// Baca status nama tampilan nomor API langsung dari Graph Meta — dipakai
// halaman Pengaturan untuk memantau review display name tanpa bergantung
// pada UI WhatsApp Manager yang kadang tidak sinkron. Selalu HTTP 200;
// bila gagal, pesan ada di field detail.
import { isAuthed } from "@/lib/auth";
import { getDisplayNameStatus } from "@/lib/wa";

export async function GET() {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const result = await getDisplayNameStatus();
  return Response.json(result);
}
