// Diagnostik pesanan TikTok (dijaga secret cron, READ-ONLY): membaca data
// pesanan dari API TikTok — qty per baris (sku_count), varian (sku_name),
// jumlah paket — lalu menjalankan checkAnekaExecutable supaya terlihat
// KENAPA sebuah pesanan tidak dieksekusi otomatis. Tidak mengubah apa pun.
//
// Dua mode:
// 1. GET /api/tiktok/resi/diag?secret=CRON_SECRET&mode=list
//    → daftar pesanan terbaru (ringkasan pencarian): jumlah baris per
//      pesanan + sku_count mentah tiap baris.
// 2. GET /api/tiktok/resi/diag?order_id=...&secret=CRON_SECRET
//    → detail pesanan + line_items mentah dari respons TikTok (untuk
//      melihat field qty apa saja yang benar-benar ada).
import { checkAnekaExecutable } from "@/lib/aneka-exec";
import { getTiktokOrderExec, listTiktokShopTokens } from "@/lib/db";
import {
  getTiktokOrderDetail,
  getTiktokOrders,
  resolveLineQty,
  type TiktokOrderSummary,
} from "@/lib/tiktok";
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

/** Ringkas item tanpa data pembeli/alamat. */
function ringkasLineItems(
  items: TiktokOrderSummary["items"],
): Record<string, unknown>[] {
  return items.map((it) => ({
    product_id: it.product_id,
    sku_id: it.sku_id,
    product_name: it.product_name,
    sku_name: it.sku_name,
    seller_sku: it.seller_sku,
    sku_count: it.sku_count,
  }));
}

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const url = new URL(request.url);
  const orderId = url.searchParams.get("order_id") ?? "";
  const mode = url.searchParams.get("mode") ?? "detail";

  const out: Record<string, unknown> = { order_id: orderId || "(daftar)" };
  const shops = await listTiktokShopTokens();
  out.shops = shops.length;

  for (const shop of shops) {
    const prep = await prepareShop(shop);
    if (!prep.ok) {
      out.prepare_error = prep.detail;
      continue;
    }
    const cred = { cipher: prep.cipher, access_token: prep.access_token };

    // Mode daftar: ringkasan pencarian — jumlah baris & sku_count mentah.
    if (mode === "list") {
      const list = await getTiktokOrders(cred, { daysBack: 14, pageSize: 50 });
      if (!list.ok) {
        out.list_error = list.detail;
        continue;
      }
      out.total_count = list.total_count;
      out.orders = list.orders.map((o) => ({
        order_id: o.order_id,
        order_status: o.order_status,
        create_time: o.create_time,
        lines: o.items.length,
        items: ringkasLineItems(o.items),
      }));
      break;
    }

    if (!orderId) {
      out.error = "order_id tidak ada (pakai mode=list untuk daftar)";
      break;
    }
    const detail = await getTiktokOrderDetail(cred, [orderId]);
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
    out.line_items = ringkasLineItems(d.line_items);
    // Dump mentah: hanya line_items & packages dari respons TikTok (bukan
    // data pembeli) — untuk melihat field qty yang sebenarnya dikirim.
    const rawO = detail.raw.find((x) => String(x.id) === orderId);
    if (rawO) {
      out.raw_line_items = (rawO.line_items ?? []) as unknown;
      out.raw_packages = (rawO.packages ?? rawO.package_list ?? []) as unknown;
    }
    const summary: TiktokOrderSummary = {
      order_id: d.id,
      order_status: d.status,
      create_time: d.create_time,
      update_time: d.update_time,
      // Qty per baris di-resolusi persis seperti alur produksi
      // (resolveLineQty) — tanpa ini exec_check selalu tampak gagal
      // "qty 0" padahal pipeline akan lanjut.
      items: d.line_items.map((li) => ({
        product_id: li.product_id,
        sku_id: li.sku_id,
        product_name: li.product_name,
        sku_count: resolveLineQty(li),
        sku_name: li.sku_name,
        seller_sku: li.seller_sku,
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
