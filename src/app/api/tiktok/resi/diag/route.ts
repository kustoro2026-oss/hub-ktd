// Diagnostik pesanan TikTok (dijaga secret cron, READ-ONLY): membaca detail
// pesanan dari API TikTok — qty per baris (sku_count), varian (sku_name),
// jumlah paket — lalu menjalankan checkAnekaExecutable supaya terlihat
// KENAPA sebuah pesanan tidak dieksekusi otomatis. Tidak mengubah apa pun.
// Dipakai lewat GET /api/tiktok/resi/diag?order_id=...&secret=CRON_SECRET.
import { checkAnekaExecutable } from "@/lib/aneka-exec";
import { getTiktokOrderExec, listTiktokShopTokens } from "@/lib/db";
import { getTiktokOrderDetail, type TiktokOrderSummary } from "@/lib/tiktok";
import { prepareShop } from "@/lib/tiktok-orders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** True bila secret cocok (saluran yang sama dengan route pengecekan). */
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

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const orderId = new URL(request.url).searchParams.get("order_id") ?? "";
  if (!orderId) {
    return Response.json({ error: "order_id tidak ada" }, { status: 400 });
  }

  const out: Record<string, unknown> = { order_id: orderId };
  const shops = await listTiktokShopTokens();
  out.shops = shops.length;
  for (const shop of shops) {
    const prep = await prepareShop(shop);
    if (!prep.ok) {
      out.prepare_error = prep.detail;
      continue;
    }
    const detail = await getTiktokOrderDetail(
      { cipher: prep.cipher, access_token: prep.access_token },
      [orderId],
    );
    if (!detail.ok) {
      out.detail_error = detail.detail;
      continue;
    }
    const d = detail.orders.find((x) => x.id === orderId);
    if (!d) {
      out.not_found = true;
      continue;
    }
    out.status = d.status;
    out.packages = (d.package_list ?? []).length;
    // Ringkas line_items: cukup untuk diagnosis qty/varian/pemetaan —
    // TANPA data pembeli/alamat.
    out.line_items = d.line_items.map((li) => ({
      product_id: li.product_id,
      sku_id: li.sku_id,
      product_name: li.product_name,
      sku_name: li.sku_name,
      seller_sku: li.seller_sku,
      sku_count: li.sku_count,
      combined_listing_skus: li.combined_listing_skus,
    }));
    const summary: TiktokOrderSummary = {
      order_id: d.id,
      order_status: d.status,
      create_time: d.create_time,
      update_time: d.update_time,
      items: (out.line_items as Record<string, unknown>[]).map((li) => ({
        product_id: String(li.product_id ?? ""),
        sku_id: String(li.sku_id ?? ""),
        product_name: String(li.product_name ?? ""),
        sku_count: Number(li.sku_count ?? 0),
        sku_name: String(li.sku_name ?? ""),
        seller_sku: String(li.seller_sku ?? ""),
      })),
    };
    out.exec_check = await checkAnekaExecutable(summary);
    const row = await getTiktokOrderExec(orderId);
    if (row) {
      out.exec_row = {
        status: row.status,
        detail: row.detail,
        aneka_payment_id: row.aneka_payment_id,
        aneka_order_id: row.aneka_order_id,
        executed_at: row.executed_at,
      };
    }
    break;
  }
  return Response.json(out);
}
