// Kirim undangan target collaboration ke kreator terpilih.
// Body: creator_open_ids (string[], maks 500), product_ids (string[],
// maks 100), commission_percent? (default 15), shop_ads_commission_percent?,
// message?, name?, end_time? (epoch detik string, default 30 hari ke depan),
// preferred_content_type? ("LIVE" | "VIDEO").
// Open id otomatis dipotong jadi batch maksimal 50; kegagalan dengan kode
// per-kreator dipecah adaptif. Tiap batch dijurnalkan ke affiliate_invites
// dan status cache kandidat diperbarui.
//
// Auth: sesi admin (isAuthed) ATAU CRON_SECRET — pola route afiliasi.
import { isAuthed } from "@/lib/auth";
import {
  collaborationNameStamp,
  describeAffiliateError,
  journalInviteBatch,
  prepareAffiliateShop,
  sanitizeCollaborationName,
  sendTargetCollaborationInvites,
} from "@/lib/tiktok-affiliate";
import { getAffiliateSettings } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

function strOf(v: unknown): string {
  return typeof v === "string" ? v : "";
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
  const productIds = Array.isArray(body.product_ids)
    ? (body.product_ids as unknown[])
        .map(String)
        .filter((s) => s !== "")
    : [];
  if (openIds.length === 0) {
    return Response.json({ ok: false, detail: "Pilih minimal satu kreator." });
  }
  if (productIds.length === 0) {
    return Response.json({ ok: false, detail: "Pilih minimal satu produk." });
  }
  if (productIds.length > 100) {
    return Response.json({
      ok: false,
      detail: "Maksimal 100 produk per undangan.",
    });
  }
  if (openIds.length > 500) {
    return Response.json({
      ok: false,
      detail: "Maksimal 500 kreator per pengiriman.",
    });
  }

  const settings = await getAffiliateSettings();
  const commissionRaw = Number(body.commission_percent ?? settings.commission_percent ?? 15);
  const commissionPercent = Math.min(
    Math.max(Number.isFinite(commissionRaw) ? commissionRaw : 15, 0.01),
    50,
  );
  const adsRaw = body.shop_ads_commission_percent;
  const adsPercent =
    adsRaw === undefined || adsRaw === null || adsRaw === ""
      ? undefined
      : Number(adsRaw);
  const products = productIds.map((id) => {
    const row: { id: string; targetCommissionRate: number; shopAdsCommissionRate?: number } = {
      id,
      targetCommissionRate: Math.round(commissionPercent * 100),
    };
    if (
      adsPercent !== undefined &&
      Number.isFinite(adsPercent) &&
      adsPercent > 0
    ) {
      row.shopAdsCommissionRate = Math.round(adsPercent * 100);
    }
    return row;
  });
  const endTime =
    strOf(body.end_time) ||
    String(Math.floor(Date.now() / 1000) + 30 * 86400);
  // Nama harus bebas karakter terlarang (':' '-' dst. memicu 98001004) —
  // sanitasi nama dari UI, dan pakai stempel kompak bila kosong.
  const rawName = strOf(body.name);
  const name = rawName
    ? sanitizeCollaborationName(rawName)
    : `UndanganKTD${collaborationNameStamp()}`;
  const contentTypeRaw = strOf(body.preferred_content_type);
  const preferredContentType =
    contentTypeRaw === "LIVE" || contentTypeRaw === "VIDEO"
      ? contentTypeRaw
      : undefined;

  const prep = await prepareAffiliateShop();
  if (!prep.ok) {
    return Response.json({ ok: false, detail: prep.detail });
  }

  const summary = await sendTargetCollaborationInvites(
    prep.ctx,
    {
      name,
      message: strOf(body.message) || undefined,
      endTime,
      products,
      creatorUserOpenIds: openIds,
      sellerContactInfo: {
        email: settings.contact_email ?? "",
        phoneNumber: settings.contact_phone ?? "",
        whatsapp: settings.contact_whatsapp ?? "",
        telegram: settings.contact_telegram ?? "",
        line: "",
      },
      // Kebijakan toko: tanpa sampel gratis (anti-penyalahgunaan sampel).
      freeSampleRule: { hasFreeSample: false, isSampleApprovalExempt: false },
      preferredContentType,
    },
    async (_index, batch) => {
      await journalInviteBatch(prep.shop.shop_id, productIds, batch);
    },
  );
  if (!summary.ok) {
    return Response.json({ ok: false, detail: summary.detail });
  }
  return Response.json({
    ok: true,
    invited: summary.invitedCount,
    batches: summary.batches.map((b) => ({
      ok: b.ok,
      count: b.creatorOpenIds.length,
      collaboration_id: b.ok ? b.collaborationId : "",
      invalid: b.ok ? b.invalidOpenIds.length : 0,
      conflicts: b.ok ? b.conflicts.length : 0,
      code: b.ok ? null : b.code,
      detail: b.ok ? "" : b.detail,
      hint: b.ok ? "" : describeAffiliateError(b.code),
    })),
  });
}
