// Panel kuota harian email: batas Gmail pribadi = 500 email per hari,
// dikurangi kiriman Hub hari ini (jendela kalender lokal). Angka kiriman
// dihitung dari tabel email_campaign_items — kiriman dari luar Hub tidak
// terhitung di sini.
import { isAuthed } from "@/lib/auth";
import { countEmailsSentToday } from "@/lib/db";

// Batas Gmail pribadi (500/hari; Workspace 2000). Naikkan bila akunnya
// Workspace — nilainya di sini supaya tampil jelas di UI.
const FREE_TIER_LIMIT = 500;

export async function GET() {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const sentToday = await countEmailsSentToday();
  return Response.json({
    ok: true,
    limit: FREE_TIER_LIMIT,
    sentToday,
    remaining: Math.max(0, FREE_TIER_LIMIT - sentToday),
  });
}
