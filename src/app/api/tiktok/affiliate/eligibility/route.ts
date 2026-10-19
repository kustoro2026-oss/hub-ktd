// Cek eligibilitas outreach untuk daftar kreator (maksimal 500 open id —
// lib memotong jadi batch 100 per panggilan TikTok).
// Body: { creator_open_ids: string[] }.
//
// Auth: sesi admin (isAuthed) ATAU CRON_SECRET — pola route afiliasi.
import { isAuthed } from "@/lib/auth";
import {
  checkCreatorOutreachEligibility,
  prepareAffiliateShop,
} from "@/lib/tiktok-affiliate";

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

export async function POST(request: Request) {
  if (!cronAuthorized(request) && !(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const openIds = Array.isArray(body.creator_open_ids)
    ? (body.creator_open_ids as unknown[])
        .map(String)
        .filter((s) => s !== "")
    : [];
  if (openIds.length === 0) {
    return Response.json({
      ok: false,
      detail: "Kirim minimal satu creator open id.",
    });
  }
  if (openIds.length > 500) {
    return Response.json({
      ok: false,
      detail: "Maksimal 500 kreator per pengecekan.",
    });
  }

  const prep = await prepareAffiliateShop();
  if (!prep.ok) {
    return Response.json({ ok: false, detail: prep.detail });
  }
  const res = await checkCreatorOutreachEligibility(prep.ctx, openIds);
  if (!res.ok) {
    return Response.json({ ok: false, detail: res.detail });
  }
  return Response.json({
    ok: true,
    results: res.results,
    ineligible_levels: res.ineligibleLevels,
    batch_quota_consumable: res.batchQuotaConsumable,
  });
}
