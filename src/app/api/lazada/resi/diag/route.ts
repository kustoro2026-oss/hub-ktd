// Diagnostik pesanan Lazada (dijaga secret cron, READ-ONLY): membaca data
// pesanan dari API Lazada — order item per unit, SellerSku, status — lalu
// menjalankan checkLazadaExecutable supaya terlihat KENAPA sebuah pesanan
// tidak dieksekusi otomatis. Tidak mengubah apa pun.
//
// Mode:
// 1. GET /api/lazada/resi/diag?secret=...&mode=list
//    → daftar pesanan terbaru (30 hari): ringkasan per pesanan TANPA
//      panggilan /order/items/get (hemat kuota).
// 2. GET /api/lazada/resi/diag?order_id=...&secret=...
//    → detail satu pesanan: semua order item + baris seen + exec_check +
//      baris antrean eksekusi (bila pesanan sudah disiapkan).
// 3. GET /api/lazada/resi/diag?secret=...&mode=mapping
//    → dump SELURUH tabel pemetaan lazada_product_map + cek tiap baris ke
//      katalog Aneka (ada? harga modal ada?).
// 4. GET /api/lazada/resi/diag?secret=...&mode=audit
//    → audit menyeluruh: 15 pesanan terbaru diperiksa dengan logika
//      produksi yang sama (item per pesanan → checkLazadaExecutable) —
//      hasil per pesanan: bisa eksekusi otomatis atau TIDAK + alasannya.
import { findAnekaCatalogById } from "@/lib/aneka-map";
import {
  getLazadaCtx,
  getLazadaOrderItems,
  getLazadaOrders,
  type LazadaOrderItemRow,
} from "@/lib/lazada";
import {
  checkLazadaExecutable,
  lazadaTrackingNumber,
  type LazadaExecSourceItem,
} from "@/lib/lazada-exec";
import {
  getLazadaOrderExec,
  listLazadaOrderExecs,
  listLazadaProductMaps,
  listSeenLazadaOrders,
} from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Status item yang berarti "tidak akan dikirim" — pembatalan pembeli
 *  (canceled) atau pengembalian/gagal antar (returned/failed/lost). */
const PROBLEM_STATUSES = ["canceled", "returned", "failed", "lost"];

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

/** "Rp18.450" → 18450. */
function parseRp(s: string): number {
  const n = Number(String(s).replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Petakan satu order item ke bahan checkLazadaExecutable — persis alur
 *  produksi di lazada-resi.ts (satu order item = satu unit). */
function itemToSource(d: LazadaOrderItemRow): {
  src: LazadaExecSourceItem;
  cancelled: boolean;
} {
  const st = String(d.status ?? "").toLowerCase();
  return {
    src: {
      // Kunci pemetaan = SellerSku; API kadang mengembalikannya sebagai
      // kolom "sku" (seller_sku kosong) — fallback seperti produksi.
      // shop_sku untuk tampilan.
      lazada_sku: String(d.seller_sku || d.sku || ""),
      seller_sku: String(d.shop_sku ?? ""),
      item_name: String(d.name ?? ""),
      variant_name: String(d.variation ?? ""),
      qty: 1,
    },
    cancelled: PROBLEM_STATUSES.includes(st),
  };
}

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const url = new URL(request.url);
  const orderId = url.searchParams.get("order_id") ?? "";
  const mode = url.searchParams.get("mode") ?? "detail";

  const out: Record<string, unknown> = {
    order_id: orderId || "(daftar)",
  };

  // Mode pemetaan tidak butuh API Lazada — langsung dump tabel + cek
  // silang ke katalog Aneka.
  if (mode === "mapping") {
    const rows = await listLazadaProductMaps();
    out.total = rows.length;
    out.aktif = rows.filter((r) => r.enabled === 1).length;
    out.maps = rows.map((r) => {
      const cat = findAnekaCatalogById(r.aneka_product_id);
      const harga = parseRp(cat?.hargaModal ?? "");
      return {
        lazada_sku: r.lazada_sku,
        seller_sku: r.seller_sku,
        product_name: r.product_name,
        aneka_product_id: r.aneka_product_id,
        aneka_variant_id: r.aneka_variant_id,
        aneka_product_name: r.aneka_product_name,
        enabled: r.enabled,
        katalog_ada: Boolean(cat),
        harga_modal: harga,
        peringatan:
          r.enabled !== 1
            ? "nonaktif"
            : !cat
              ? "produk Aneka tidak ada di katalog"
              : harga <= 0
                ? "harga modal kosong"
                : "",
      };
    });
    return Response.json(out);
  }

  const ctx = await getLazadaCtx();
  out.kredensial = ctx.ok ? "siap" : "belum diatur";
  if (!ctx.ok) {
    out.error = ctx.detail;
    return Response.json(out);
  }

  const list = await getLazadaOrders({
    created_after: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    sort_by: "updated_at",
    sort_direction: "DESC",
    offset: 0,
    limit: 100,
  });
  if (!list.ok) {
    out.list_error = list.detail;
    return Response.json(out);
  }
  out.total_record = list.data.countTotal;

  // Mode daftar: ringkasan pesanan TANPA panggilan /order/items/get —
  // rincian SKU butuh satu panggilan per pesanan, hemat untuk daftar.
  if (mode === "list") {
    out.orders = list.data.orders.map((o) => ({
      order_id: o.order_id,
      order_number: o.order_number,
      statuses: o.statuses,
      items_count: o.items_count,
      price: o.price,
      pelanggan: [o.address_shipping?.first_name, o.address_shipping?.last_name]
        .filter(Boolean)
        .join(" "),
      created_at: o.created_at,
      updated_at: o.updated_at,
    }));
    return Response.json(out);
  }

  // Mode audit: semua pesanan diperiksa dengan logika produksi. Detail
  // diambil per pesanan (satu panggilan /order/items/get per pesanan) —
  // dipotong 15 pesanan agar aman berbagi kuota dengan pengecekan
  // produksi.
  if (mode === "audit") {
    let bisa = 0;
    let manual = 0;
    const hasil: Record<string, unknown>[] = [];
    for (const o of list.data.orders.slice(0, 15)) {
      const det = await getLazadaOrderItems(o.order_id);
      if (!det.ok) {
        manual++;
        hasil.push({
          order_id: o.order_id,
          exec_ok: false,
          alasan: `item pesanan tidak bisa diambil: ${det.detail}`,
        });
        continue;
      }
      if (det.data.length === 0) {
        manual++;
        hasil.push({
          order_id: o.order_id,
          exec_ok: false,
          alasan: "Pesanan tanpa order item",
        });
        continue;
      }
      const mapped = det.data.map(itemToSource);
      const adaBatal = mapped.some((d) => d.cancelled);
      const srcItems: LazadaExecSourceItem[] = mapped
        .filter((d) => !d.cancelled)
        .map((d) => d.src);
      const check = adaBatal
        ? {
            ok: false as const,
            detail: "Sebagian item pesanan dibatalkan pembeli — proses manual",
          }
        : await checkLazadaExecutable(srcItems);
      if (check.ok) bisa++;
      else manual++;
      hasil.push({
        order_id: o.order_id,
        order_number: o.order_number,
        lines: det.data.length,
        exec_ok: check.ok,
        ...(check.ok
          ? {
              items: check.items.map((it) => ({
                produk: it.item_name,
                lazada_sku: it.lazada_sku,
                varian: it.variant_name,
                qty: it.qty,
                aneka: it.aneka_product_id,
                modal: it.harga_modal,
              })),
            }
          : { alasan: check.detail }),
      });
    }
    out.pesanan_diaudit = hasil.length;
    out.hasil = hasil;
    out.ringkasan = { bisa_otomatis: bisa, manual };
    return Response.json(out);
  }

  // Mode antrean: baris eksekusi dari DATABASE saja — TANPA panggilan API
  // Lazada (aman dipakai saat kuota habis).
  if (mode === "queue") {
    const rows = await listLazadaOrderExecs();
    out.antrean = rows
      .filter((r) => !orderId || r.order_id === orderId)
      .map((r) => {
        let payloadResi = "";
        let labelAda = false;
        try {
          const pl = JSON.parse(r.payload) as {
            tracking_number?: string;
            label_pdf_base64?: string;
          };
          payloadResi = pl.tracking_number ?? "";
          labelAda = typeof pl.label_pdf_base64 === "string" &&
            pl.label_pdf_base64.length > 0;
        } catch {
          payloadResi = "(payload rusak)";
        }
        return {
          order_id: r.order_id,
          status: r.status,
          detail: r.detail,
          aneka_payment_id: r.aneka_payment_id,
          aneka_order_id: r.aneka_order_id,
          executed_at: r.executed_at,
          payload_resi: payloadResi,
          label_tersedia: labelAda,
          log: r.log.split("\n").slice(-40).join("\n"),
        };
      });
    return Response.json(out);
  }

  // Mode detail: satu pesanan.
  if (!orderId) {
    out.error = "order_id tidak ada (pakai mode=list/audit untuk daftar)";
    return Response.json(out);
  }
  const orderRow = list.data.orders.find((o) => o.order_id === orderId);
  const items = await getLazadaOrderItems(orderId);
  if (!items.ok) {
    out.items_error = items.detail;
    return Response.json(out);
  }
  out.order_row = orderRow
    ? {
        order_number: orderRow.order_number,
        statuses: orderRow.statuses,
        items_count: orderRow.items_count,
        price: orderRow.price,
        pelanggan: [
          orderRow.address_shipping?.first_name,
          orderRow.address_shipping?.last_name,
        ]
          .filter(Boolean)
          .join(" "),
        // Alamat utuh (dipakai resi cadangan) — dipakai juga untuk
        // memeriksa apakah Lazada menyamarkan data pelanggan di API.
        alamat: orderRow.address_shipping ?? null,
        created_at: orderRow.created_at,
      }
    : null;

  const seenRows = await listSeenLazadaOrders();
  out.items = await Promise.all(
    items.data.map(async (it) => {
      const seen = seenRows.find((r) => r.order_item_id === it.order_item_id);
      const { src, cancelled } = itemToSource(it);
      return {
        order_item_id: it.order_item_id,
        status: it.status,
        item_name: it.name,
        seller_sku: it.seller_sku,
        shop_sku: it.shop_sku,
        variation: it.variation,
        tracking_code: it.tracking_code,
        shipment_provider: it.shipment_provider,
        cancelled,
        ...(seen
          ? {
              seen_row: {
                notify: seen.notify,
                attempts: seen.attempts,
                last_attempt_at: seen.last_attempt_at,
              },
            }
          : {}),
        exec_check: cancelled
          ? { ok: false, detail: "Item dibatalkan pembeli — proses manual" }
          : await checkLazadaExecutable([src]),
      };
    }),
  );
  const row = await getLazadaOrderExec(orderId);
  if (row) {
    let payloadResi = "";
    let labelAda = false;
    try {
      const pl = JSON.parse(row.payload) as {
        tracking_number?: string;
        label_pdf_base64?: string;
      };
      payloadResi = pl.tracking_number ?? "";
      labelAda =
        typeof pl.label_pdf_base64 === "string" &&
        pl.label_pdf_base64.length > 0;
    } catch {
      payloadResi = "(payload rusak)";
    }
    out.exec_row = {
      status: row.status,
      detail: row.detail,
      aneka_payment_id: row.aneka_payment_id,
      aneka_order_id: row.aneka_order_id,
      executed_at: row.executed_at,
      payload_resi: payloadResi,
      label_tersedia: labelAda,
      // Jejak langkah eksekusi — potongan terakhir cukup untuk diagnosa.
      log: row.log.split("\n").slice(-40).join("\n"),
    };
  }
  out.resi_sistem = lazadaTrackingNumber(orderId);
  return Response.json(out);
}
