// Jalankan pemindaian bounce via IMAP untuk semua akun SMTP yang punya
// konfigurasi imap_host. Biasanya dipanggil worker tiap 5 menit; route ini
// memungkinkan pemicu manual dari tombol "Pindai inbox sekarang".
import { isAuthed } from "@/lib/auth";
import { runEmailBounceScan } from "@/lib/email-bounce";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const res = await runEmailBounceScan();
  return Response.json(res);
}
