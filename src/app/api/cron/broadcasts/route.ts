// Titik masuk cron Vercel untuk kampanye terjadwal (jaring pengaman).
//
// Tick utama datang dari tab admin yang terbuka + webhook pesan masuk,
// tetapi cron harian ini memastikan kampanye tetap terkirim walau tidak ada
// yang membuka Hub. Wajib menyertakan secret yang sama dengan env
// CRON_SECRET (header x-cron-secret atau query ?secret=). Bila CRON_SECRET
// tidak diatur di Vercel, endpoint ini menolak semua panggilan.
import { runDueScheduledBroadcasts } from "@/lib/broadcast-send";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json(
      { ok: false, detail: "CRON_SECRET belum diatur" },
      { status: 403 },
    );
  }
  const given =
    request.headers.get("x-cron-secret") ??
    new URL(request.url).searchParams.get("secret");
  if (given !== secret) {
    return Response.json({ ok: false, detail: "Secret salah" }, { status: 403 });
  }
  const res = await runDueScheduledBroadcasts();
  return Response.json({ ok: true, ...res });
}
