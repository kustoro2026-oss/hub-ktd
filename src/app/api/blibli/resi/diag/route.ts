// Diagnostik pesanan Blibli (dijaga secret cron, READ-ONLY): membaca data
// pesanan dari API Blibli — qty per item, varian (variantName), isi paket —
// lalu menjalankan checkBlibliExecutable supaya terlihat KENAPA sebuah
// pesanan tidak dieksekusi otomatis. Tidak mengubah apa pun.
//
// Mode:
// 1. GET /api/blibli/resi/diag?secret=...&mode=list
//    → daftar paket pesanan terbaru (FP 30 hari): item per paket +
//      productSku yang jadi kunci pemetaan.
// 2. GET /api/blibli/resi/diag?order_item_id=...&secret=...
//    → detail satu order item + baris seen + exec_check + baris antrean
//      eksekusi (bila paket sudah disiapkan).
// 3. GET /api/blibli/resi/diag?secret=...&mode=mapping
//    → dump SELURUH tabel pemetaan blibli_product_map + cek tiap baris ke
//      katalog Aneka (ada? harga modal ada?).
// 4. GET /api/blibli/resi/diag?secret=...&mode=audit
//    → audit menyeluruh: semua paket terbaru diperiksa dengan logika
//      produksi yang sama (detail per item → checkBlibliExecutable) —
//      hasil per paket: bisa eksekusi otomatis atau TIDAK + alasannya.
import { findAnekaCatalogById } from "@/lib/aneka-map";
import { blibliEnv, blibliProductSku, getBlibliOrderDetail, listBlibliOrders } from "@/lib/blibli";
import { checkBlibliExecutable, type BlibliExecSourceItem } from "@/lib/blibli-exec";
import {
  getBlibliOrderExec,
  listBlibliOrderExecs,
  listBlibliProductMaps,
  listSeenBlibliOrders,
} from "@/lib/db";

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

/** "Rp18.450" → 18450. */
function parseRp(s: string): number {
  const n = Number(String(s).replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Ambil detail item (sekali) dan petakan ke bahan checkBlibliExecutable —
 *  persis alur produksi di blibli-resi.ts. */
async function detToSource(
  orderItemId: string,
  fallbackName: string,
  fallbackSellerSku: string,
): Promise<
  | { ok: true; src: BlibliExecSourceItem; status: string; cancelled: boolean; packageId: string }
  | { ok: false; detail: string }
> {
  const d = await getBlibliOrderDetail(orderItemId);
  if (!d.ok) return { ok: false, detail: d.detail };
  const st = String(d.data.status ?? "");
  return {
    ok: true,
    src: {
      blibli_sku: blibliProductSku(
        d.data.product?.blibliSku ?? fallbackSellerSku,
      ),
      seller_sku: String(d.data.product?.sellerSku ?? fallbackSellerSku),
      item_name: d.data.product?.name || fallbackName,
      // Petunjuk varian = variantName + catatan pembeli (sama dengan
      // blibli-resi.ts — ukuran/warna sering hanya ada di notes).
      variant_name: [
        String(d.data.product?.variantName ?? ""),
        String(d.data.product?.notes ?? "").trim(),
      ]
        .filter((s) => s !== "")
        .join(" | "),
      qty: Number(d.data.quantity) > 0 ? Number(d.data.quantity) : 0,
    },
    status: st,
    cancelled: st === "X" || /cancel/i.test(st),
    packageId: d.data.packageId ?? "",
  };
}

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const url = new URL(request.url);
  const orderItemId = url.searchParams.get("order_item_id") ?? "";
  const mode = url.searchParams.get("mode") ?? "detail";

  const out: Record<string, unknown> = {
    order_item_id: orderItemId || "(daftar)",
  };

  // Mode pemetaan tidak butuh API Blibli — langsung dump tabel + cek
  // silang ke katalog Aneka.
  if (mode === "mapping") {
    const rows = await listBlibliProductMaps();
    out.total = rows.length;
    out.aktif = rows.filter((r) => r.enabled === 1).length;
    out.maps = rows.map((r) => {
      const cat = findAnekaCatalogById(r.aneka_product_id);
      const harga = parseRp(cat?.hargaModal ?? "");
      return {
        blibli_sku: r.blibli_sku,
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

  const env = blibliEnv();
  out.kredensial = env.ready ? "siap" : "belum diatur";
  if (!env.ready) {
    out.error = "Kredensial Blibli belum diatur (env BLIBLI_*).";
    return Response.json(out);
  }

  const list = await listBlibliOrders({
    statusFPDateRange: {
      start: Date.now() - 30 * 24 * 60 * 60 * 1000,
      end: Date.now(),
    },
    paging: { page: 0, size: 50 },
  });
  if (!list.ok) {
    out.list_error = list.detail;
    return Response.json(out);
  }
  out.total_record = list.data.totalRecord;

  // Mode daftar: ringkasan paket + item beserta kunci productSku.
  if (mode === "list") {
    out.packages = list.data.packages.map((p) => ({
      package_id: p.packageId,
      lines: p.orderItems.length,
      items: p.orderItems.map((it) => ({
        // Kunci baris seen & path detail = order.itemId (Order item number).
        order_item_id: it.order.itemId,
        order_id: it.order.id,
        item_status: it.order.itemStatus,
        item_name: it.product.itemName,
        seller_sku: it.product.sellerSku,
        blibli_sku: it.product.blibliSku ?? "",
        product_sku: blibliProductSku(
          it.product.blibliSku ?? it.product.sellerSku,
        ),
        qty: it.order.quantity,
      })),
    }));
    return Response.json(out);
  }

  // Mode audit: semua paket diperiksa dengan logika produksi. Detail
  // diambil per item (batas API Blibli 100 request/30 menit) — cukup
  // untuk 50 paket terbaru, dipotong 30 paket agar aman berbagi kuota
  // dengan pengecekan produksi.
  if (mode === "audit") {
    let bisa = 0;
    let manual = 0;
    const hasil: Record<string, unknown>[] = [];
    for (const p of list.data.packages.slice(0, 30)) {
      const dets = await Promise.all(
        p.orderItems.map((x) =>
          detToSource(x.order.itemId, x.product.itemName, x.product.sellerSku),
        ),
      );
      const gagal = dets.filter(
        (d): d is { ok: false; detail: string } => !d.ok,
      );
      if (gagal.length > 0) {
        manual++;
        hasil.push({
          package_id: p.packageId,
          lines: p.orderItems.length,
          exec_ok: false,
          alasan: `detail item tidak bisa diambil: ${gagal[0].detail}`,
        });
        continue;
      }
      const okDets = dets as Exclude<(typeof dets)[number], { ok: false }>[];
      const adaBatal = okDets.some((d) => d.cancelled);
      const srcItems: BlibliExecSourceItem[] = okDets
        .filter((d) => !d.cancelled)
        .map((d) => d.src);
      const check = adaBatal
        ? {
            ok: false as const,
            detail: "Sebagian item paket dibatalkan pembeli — proses manual",
          }
        : await checkBlibliExecutable(srcItems);
      if (check.ok) bisa++;
      else manual++;
      hasil.push({
        package_id: p.packageId,
        lines: p.orderItems.length,
        exec_ok: check.ok,
        ...(check.ok
          ? {
              items: check.items.map((it) => ({
                produk: it.item_name,
                blibli_sku: it.blibli_sku,
                varian: it.variant_name,
                qty: it.qty,
                aneka: it.aneka_product_id,
                modal: it.harga_modal,
              })),
            }
          : { alasan: check.detail }),
      });
    }
    out.paket_diaudit = hasil.length;
    out.hasil = hasil;
    out.ringkasan = { bisa_otomatis: bisa, manual };
    return Response.json(out);
  }

  // Mode antrean: baris eksekusi dari DATABASE saja — TANPA panggilan API
  // Blibli (aman dipakai saat kuota detail habis).
  if (mode === "queue") {
    const pkg = url.searchParams.get("package_id") ?? "";
    const rows = await listBlibliOrderExecs();
    out.antrean = rows
      .filter((r) => !pkg || r.package_id === pkg)
      .map((r) => {
        let payloadAwb = "";
        try {
          const pl = JSON.parse(r.payload) as { awb_number?: string };
          payloadAwb = pl.awb_number ?? "";
        } catch {
          payloadAwb = "(payload rusak)";
        }
        return {
          package_id: r.package_id,
          status: r.status,
          detail: r.detail,
          aneka_payment_id: r.aneka_payment_id,
          aneka_order_id: r.aneka_order_id,
          executed_at: r.executed_at,
          payload_awb: payloadAwb,
          log: r.log.split("\n").slice(-40).join("\n"),
        };
      });
    return Response.json(out);
  }

  // Mode detail: satu order item.
  if (!orderItemId) {
    out.error = "order_item_id tidak ada (pakai mode=list/audit untuk daftar)";
    return Response.json(out);
  }
  const seen = (await listSeenBlibliOrders()).find(
    (r) => r.order_item_id === orderItemId,
  );
  if (seen) {
    out.seen_row = {
      notify: seen.notify,
      attempts: seen.attempts,
      last_attempt_at: seen.last_attempt_at,
    };
  }
  const fallback = list.data.packages
    .flatMap((p) => p.orderItems)
    .find(
      (x) => x.order.id === orderItemId || x.order.itemId === orderItemId,
    );
  // Bila yang diberikan adalah order.id (kunci lama sebelum perbaikan),
  // detail tetap dipanggil dengan order.itemId — path API memakai itemId.
  const detId = fallback?.order.itemId ?? orderItemId;
  const det = await detToSource(
    detId,
    fallback?.product.itemName ?? "",
    fallback?.product.sellerSku ?? "",
  );
  if (!det.ok) {
    out.detail_error = det.detail;
    return Response.json(out);
  }
  out.package_id = det.packageId;
  out.status = det.status;
  out.batal = det.cancelled;
  out.item = {
    product_sku: det.src.blibli_sku,
    seller_sku: det.src.seller_sku,
    item_name: det.src.item_name,
    varian: det.src.variant_name,
    qty: det.src.qty,
  };
  out.exec_check = det.cancelled
    ? { ok: false, detail: "Item dibatalkan pembeli — proses manual" }
    : await checkBlibliExecutable([det.src]);
  if (det.packageId) {
    const row = await getBlibliOrderExec(det.packageId);
    if (row) {
      let payloadAwb = "";
      try {
        const pl = JSON.parse(row.payload) as { awb_number?: string };
        payloadAwb = pl.awb_number ?? "";
      } catch {
        payloadAwb = "(payload rusak)";
      }
      out.exec_row = {
        status: row.status,
        detail: row.detail,
        aneka_payment_id: row.aneka_payment_id,
        aneka_order_id: row.aneka_order_id,
        executed_at: row.executed_at,
        payload_awb: payloadAwb,
        // Jejak langkah eksekusi — potongan terakhir cukup untuk diagnosa.
        log: row.log.split("\n").slice(-40).join("\n"),
      };
    }
  }
  return Response.json(out);
}
