// Jalankan kampanye terjadwal yang waktunya sudah tiba.
//
// Dipanggil oleh tick ringan di sisi klien (tab admin yang terbuka) setiap
// menit, dan bisa juga dipanggil manual. Pengiriman sendiri ada di
// src/lib/broadcast-send.ts — dipakai bersama dengan tombol kirim manual.
import { isAuthed } from "@/lib/auth";
import { runDueScheduledBroadcasts } from "@/lib/broadcast-send";

export async function POST() {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const res = await runDueScheduledBroadcasts();
  return Response.json({ ok: true, ...res });
}
