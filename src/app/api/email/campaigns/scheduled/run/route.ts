// Jalankan kampanye email terjadwal yang waktunya sudah tiba.
//
// Dipanggil oleh tick ringan di sisi klien (tab admin yang terbuka)
// setiap menit, dan bisa juga dipanggil manual. Pengiriman sendiri ada di
// src/lib/email-send.ts — dipakai bersama dengan tombol kirim manual.
import { isAuthed } from "@/lib/auth";
import { runDueScheduledEmailCampaigns } from "@/lib/email-send";

export async function POST() {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const res = await runDueScheduledEmailCampaigns();
  return Response.json({ ok: true, ...res });
}
