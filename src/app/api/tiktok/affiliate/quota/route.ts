// Probe kuota undang kreator affiliate (read-only) — dipakai untuk
// memverifikasi scope affiliate aktif pada token tersimpan, dan nantinya
// menjadi dasar tampilan kuota di halaman Afiliasi.
//
// Auth: sesi admin (isAuthed) ATAU CRON_SECRET (Bearer / x-cron-secret /
// ?secret=) — pola sama dengan /api/tiktok/resi/check.
import { isAuthed } from "@/lib/auth";
import { getAffiliateCreatorQuota } from "@/lib/tiktok";
import { prepareShop } from "@/lib/tiktok-orders";
import { listTiktokShopTokens } from "@/lib/db";

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
  const shops = await listTiktokShopTokens();
  if (shops.length === 0) {
    return Response.json({
      ok: false,
      detail: "Belum ada toko TikTok Shop yang terotorisasi.",
    });
  }
  const shop = shops[0];
  const prep = await prepareShop(shop);
  if (!prep.ok) {
    return Response.json({ ok: false, detail: prep.detail });
  }
  const quota = await getAffiliateCreatorQuota({
    cipher: prep.cipher,
    access_token: prep.access_token,
  });
  if (!quota.ok) {
    return Response.json({ ok: false, detail: quota.detail });
  }
  return Response.json({
    ok: true,
    shop: { shop_id: shop.shop_id, shop_name: shop.shop_name },
    quota: {
      quota_sum: quota.quota_sum,
      quota_use: quota.quota_use,
      unlimited: quota.unlimited,
      gmv_tier: quota.gmv_tier,
      reached_max_follower_cnt: quota.reached_max_follower_cnt,
      details: quota.details,
      raw: quota.raw,
    },
  });
}

export function GET(request: Request) {
  return handle(request);
}

export function POST(request: Request) {
  return handle(request);
}
