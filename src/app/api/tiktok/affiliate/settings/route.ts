// Pengaturan fitur Afiliasi KTD Hub (kunci–nilai di tabel
// affiliate_settings): cap harian cron auto, filter follower, produk,
// komisi, kontak penjual, dan saklar pengundang otomatis.
// GET  → { ok, settings }
// POST → body { settings: {k:v}, } atau { key, value }.
//
// Auth: sesi admin (isAuthed) ATAU CRON_SECRET — pola route afiliasi.
import { isAuthed } from "@/lib/auth";
import { getAffiliateSettings, setAffiliateSetting } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** True bila secret cocok lewat salah satu saluran yang didukung. */
function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  const given =
    (auth.startsWith("Bearer ") ? auth.slice(7) : "") ||
    request.headers.get("x-cron-secret") ||
    new URL(request.url).searchParams.get("secret");
  return given === secret;
}

async function handle(request: Request) {
  if (!cronAuthorized(request) && !(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const settings = await getAffiliateSettings();
  return Response.json({ ok: true, settings });
}

export function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  if (!cronAuthorized(request) && !(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const changes: Record<string, string> = {};
  if (body.settings && typeof body.settings === "object") {
    for (const [k, v] of Object.entries(
      body.settings as Record<string, unknown>,
    )) {
      changes[k] = String(v ?? "");
    }
  } else if (typeof body.key === "string") {
    changes[body.key] = String(body.value ?? "");
  }
  if (Object.keys(changes).length === 0) {
    return Response.json({ ok: false, detail: "Tidak ada pengaturan dikirim." });
  }
  for (const [k, v] of Object.entries(changes)) {
    await setAffiliateSetting(k, v);
  }
  const settings = await getAffiliateSettings();
  return Response.json({ ok: true, settings });
}
