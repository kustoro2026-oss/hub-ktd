// Health check ringan: memastikan koneksi DB hidup dan migrasi awal lolos.
// Publik tanpa data sensitif — dipakai pemantauan uptime.
import { countMessages } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await countMessages();
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
