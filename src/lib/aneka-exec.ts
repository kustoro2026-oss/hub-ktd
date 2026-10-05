// Orkestrasi eksekusi pesanan TikTok Shop → Anekadropship (Fase 2, mode
// SEMI-OTOMATIS). Alur:
//
//  1. PERSIAPAN (murah, saat pesanan baru terdeteksi setelah masa tunggu):
//     cek semua produk pesanan sudah dipetakan ke Aneka → simpan label resmi
//     + rincian produk ke tabel tiktok_order_exec (status "menunggu") →
//     kirim notif WA "Setuju" berisi tautan halaman Eksekusi.
//  2. PERSETUJUAN (tombol Setuju di halaman Eksekusi, dipicu pemilik toko):
//     baru DI SINI rantai Aneka dijalankan penuh — login → payment/create →
//     variant/save → token checkout → pembayaran/process (bayar saldo) →
//     baca kode pesanan Aneka (ORDER-{payment_id}-...) dari riwayat — lalu
//     kabari WA.
//
// Rantai Aneka TIDAK dijalankan saat persiapan supaya tidak menumpuk
// pembayaran mangkrak di akun Aneka bila pemilik tidak menyetujui.
import { findAnekaCatalogById } from "@/lib/aneka-map";
import {
  anekaCheckoutToken,
  anekaCreatePayment,
  anekaFindOrderByPayment,
  anekaLogin,
  anekaProcessPayment,
  anekaResolveVariant,
  anekaVariantSave,
  type AnekaCartItem,
} from "@/lib/aneka-checkout";
import {
  appendTiktokOrderExecLog,
  clearTiktokOrderExecLog,
  getAnekaProductMap,
  getTiktokOrderExec,
  saveTiktokOrderExec,
} from "@/lib/db";
import type { TiktokOrderSummary } from "@/lib/tiktok";
import {
  NOTIF_TEMPLATE,
  ownerNumber,
  sendTemplateParams,
  sendText,
} from "@/lib/wa";

const EKSEKUSI_URL =
  "https://admin.kustoro2026.com/marketplace/tiktok/eksekusi";

/** Satu baris produk pesanan yang siap dibelikan di Aneka. */
export type AnekaExecItem = {
  tiktok_product_id: string;
  product_name: string;
  /** Nama varian dari pesanan TikTok (mis. "100 ml", "BLACK - S") —
   *  petunjuk utama mencocokkan varian Aneka. */
  sku_name: string;
  qty: number;
  aneka_product_id: string;
  aneka_variant_id: string;
  aneka_product_name: string;
  harga_modal: number;
  subtotal: number;
};

/** Muatan tersimpan di tiktok_order_exec.payload (JSON) — cukup untuk
 *  menjalankan checkout Aneka kapan saja tanpa memanggil API TikTok lagi. */
export type AnekaExecPayload = {
  order_id: string;
  shop_id: string;
  shop_name: string;
  tracking_number: string;
  label_pdf_base64: string;
  items: AnekaExecItem[];
  total_modal: number;
};

/** Dokumen resi resmi hasil cetak (struktur minimal dari tiktok-resi). */
export type AnekaExecOfficial = {
  pdf: Buffer;
  tracking_number: string;
};

/** "Rp18.450" → 18450. */
function parseRp(s: string): number {
  const n = Number(String(s).replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** 18450 → "Rp18.450". */
function fmtRp(n: number): string {
  return "Rp" + n.toLocaleString("id-ID");
}

/** Kirim notifikasi teks ke WA admin: teks bebas (window 24 jam) → template
 *  teks cadangan (bebas window, menunggu review Meta). */
async function sendExecNotice(msg: string): Promise<string> {
  const owner = ownerNumber();
  if (!owner) return "gagal: OWNER_WA_NUMBER belum diatur";
  const free = await sendText(owner, msg);
  if (free.ok) return "ok";
  const tpl = await sendTemplateParams(owner, NOTIF_TEMPLATE, [msg]);
  if (tpl.ok) return "ok (template)";
  return `gagal: ${free.error ?? "teks ditolak"} | template: ${tpl.error ?? "ditolak"}`;
}

/** Cek apakah SEMUA produk pesanan sudah dipetakan ke Aneka (dan ada di
 *  katalog snapshot) — prasyarat eksekusi otomatis. Bila belum, pesanan
 *  tetap diproses jalur lama (kirim resi ke WA). */
export async function checkAnekaExecutable(
  order: TiktokOrderSummary,
): Promise<{ ok: true; items: AnekaExecItem[] } | { ok: false; detail: string }> {
  if (order.items.length === 0) {
    return { ok: false, detail: "Pesanan tanpa item" };
  }
  const items: AnekaExecItem[] = [];
  const missing: string[] = [];
  for (const it of order.items) {
    const map = await getAnekaProductMap(it.product_id);
    if (!map || map.enabled !== 1 || !map.aneka_product_id) {
      missing.push(it.product_name);
      continue;
    }
    const cat = findAnekaCatalogById(map.aneka_product_id);
    const harga = parseRp(cat?.hargaModal ?? "");
    if (!cat || harga <= 0) {
      missing.push(`${it.product_name} (harga Aneka tidak ditemukan)`);
      continue;
    }
    items.push({
      tiktok_product_id: it.product_id,
      product_name: it.product_name,
      sku_name: it.sku_name ?? "",
      qty: it.sku_count,
      aneka_product_id: map.aneka_product_id,
      aneka_variant_id: map.aneka_variant_id ?? "",
      aneka_product_name: cat.name,
      harga_modal: harga,
      subtotal: harga * it.sku_count,
    });
  }
  if (missing.length > 0) {
    return {
      ok: false,
      detail: `Belum bisa dieksekusi otomatis: ${missing.join(", ")}`,
    };
  }
  return { ok: true, items };
}

/** PERSIAPAN: simpan label resmi + rincian produk sebagai antrean eksekusi
 *  "menunggu" dan kirim notif WA berisi tautan Setuju. Idempoten — bila
 *  barisnya sudah menunggu, tidak menyimpan/kirim ulang. */
export async function prepareAnekaExec(
  shop: { shop_id: string; shop_name: string },
  order: TiktokOrderSummary,
  official: AnekaExecOfficial,
): Promise<{ ok: boolean; detail: string }> {
  const existing = await getTiktokOrderExec(order.order_id);
  if (existing?.status === "menunggu") {
    return { ok: true, detail: "Sudah menunggu persetujuan" };
  }

  const check = await checkAnekaExecutable(order);
  if (!check.ok) return { ok: false, detail: check.detail };

  const total = check.items.reduce((s, it) => s + it.subtotal, 0);
  const payload: AnekaExecPayload = {
    order_id: order.order_id,
    shop_id: shop.shop_id,
    shop_name: shop.shop_name,
    tracking_number: official.tracking_number,
    label_pdf_base64: official.pdf.toString("base64"),
    items: check.items,
    total_modal: total,
  };

  await saveTiktokOrderExec({
    order_id: order.order_id,
    shop_id: shop.shop_id,
    status: "menunggu",
    payload: JSON.stringify(payload),
    detail: "",
    executed_at: "",
  });
  // Persiapan ulang = antrean baru — jejak log percobaan lama dihapus.
  await clearTiktokOrderExecLog(order.order_id);

  const baris = check.items
    .map((it) => `- ${it.qty}x ${it.product_name} (${fmtRp(it.subtotal)})`)
    .join("\n");
  const notice = await sendExecNotice(
    `Pesanan TikTok ${order.order_id} siap dieksekusi ke Aneka (${shop.shop_name}).\n${baris}\nTotal modal ${fmtRp(total)}. No resi ${official.tracking_number}.\nSetuju/batalkan: ${EKSEKUSI_URL}?order=${order.order_id}`,
  );
  if (!notice.startsWith("ok")) {
    return { ok: false, detail: `Tersimpan, tetapi notif WA gagal: ${notice}` };
  }
  return { ok: true, detail: "Menunggu persetujuan" };
}

/** Batal (dari tombol Batalkan atau deteksi pesanan dibatalkan TikTok). */
export async function cancelAnekaExec(orderId: string): Promise<void> {
  const row = await getTiktokOrderExec(orderId);
  if (!row || row.status !== "menunggu") return;
  await appendTiktokOrderExecLog(orderId, "Dibatalkan — tombol Batalkan");
  await saveTiktokOrderExec({
    order_id: orderId,
    status: "batal",
    payload: row.payload,
    detail: "",
    executed_at: new Date().toISOString().slice(0, 19).replace("T", " "),
  });
}

/** Jalankan rantai checkout Aneka penuh untuk satu antrean "menunggu"
 *  (atau coba ulang baris "gagal"). Sukses → status "selesai" + ID pesanan
 *  Aneka dikirim ke WA; gagal → status "gagal" + keterangan (bisa dicoba
 *  lagi). */
export async function executeAnekaOrder(
  orderId: string,
): Promise<{ ok: boolean; detail: string }> {
  const row = await getTiktokOrderExec(orderId);
  if (!row) return { ok: false, detail: "Pesanan ini belum disiapkan untuk eksekusi" };
  if (row.status === "selesai") {
    return { ok: false, detail: "Pesanan ini sudah dieksekusi" };
  }
  if (row.status === "batal") {
    return { ok: false, detail: "Pesanan ini dibatalkan" };
  }

  let payload: AnekaExecPayload;
  try {
    payload = JSON.parse(row.payload) as AnekaExecPayload;
  } catch {
    return { ok: false, detail: "Data eksekusi rusak — siapkan ulang pesanan ini" };
  }
  if (!payload.items?.length || !payload.label_pdf_base64) {
    return { ok: false, detail: "Data eksekusi tidak lengkap — siapkan ulang pesanan ini" };
  }

  const gagal = async (detail: string) => {
    await saveTiktokOrderExec({
      order_id: orderId,
      status: "gagal",
      payload: row.payload,
      detail,
    });
    await sendExecNotice(
      `Eksekusi Aneka GAGAL untuk pesanan ${orderId}: ${detail}\nCoba lagi: ${EKSEKUSI_URL}?order=${orderId}`,
    );
    return { ok: false, detail };
  };

  // 1. Login + buat pembayaran (payment_id baru setiap percobaan).
  //    Tiap langkah dicatat ke kolom log baris ini — ditulis langsung per
  //    langkah supaya bila proses serverless terputus (mis. batas waktu),
  //    jejak sampai langkah terakhir tetap tersimpan untuk diagnosa.
  await clearTiktokOrderExecLog(orderId);
  await saveTiktokOrderExec({
    order_id: orderId,
    status: "berjalan",
    payload: row.payload,
    detail: "",
  });
  const logStep = async (langkah: string, pesan: string) => {
    const t = new Date().toISOString().slice(0, 19).replace("T", " ");
    await appendTiktokOrderExecLog(orderId, `${t} | ${langkah} | ${pesan}`);
  };

  await logStep("mulai", "rantai checkout Aneka dijalankan");
  const login = await anekaLogin();
  if (!login.ok) {
    await logStep("login", `GAGAL — ${login.detail}`);
    return gagal(login.detail);
  }
  await logStep("login", "berhasil masuk");
  const pay = await anekaCreatePayment(login.session);
  if (!pay.ok) {
    await logStep("payment/create", `GAGAL — ${pay.detail}`);
    return gagal(pay.detail);
  }
  await logStep("payment/create", `berhasil — payment_id ${pay.paymentId}`);

  // 1b. Tentukan varian produk ber-varian yang belum dipetakan manual
  //     (data varian diambil dari halaman produk Aneka; nama varian pesanan
  //     sku_name jadi petunjuk pencocokan, fallback ke nama produk).
  for (const it of payload.items) {
    if (it.aneka_variant_id) continue;
    const langkah = `varian:${it.aneka_product_id}`;
    await logStep(
      langkah,
      `mencari varian untuk "${it.sku_name || it.product_name}"`,
    );
    const v = await anekaResolveVariant(
      login.session,
      it.aneka_product_id,
      it.sku_name || it.product_name,
    );
    if (!v.ok) {
      await logStep(langkah, `GAGAL — ${v.detail}`);
      return gagal(v.detail);
    }
    if (v.variantId) it.aneka_variant_id = v.variantId;
    await logStep(
      langkah,
      v.variantId
        ? `dipakai variant_id ${v.variantId}${v.label ? ` (${v.label})` : ""}`
        : "produk tanpa varian",
    );
  }

  // 2. Masukkan produk: satu slot resi untuk pesanan ini (satu paket
  //    TikTok = satu label) — slot dipasang di produk pertama.
  const items: AnekaCartItem[] = payload.items.map((it, i) => ({
    productId: it.aneka_product_id,
    variantId: it.aneka_variant_id || undefined,
    qty: it.qty,
    resiCount: i === 0 ? 1 : 0,
  }));
  const save = await anekaVariantSave(login.session, pay.paymentId, items);
  if (!save.ok) {
    await logStep("variant/save", `GAGAL — ${save.detail}`);
    return gagal(save.detail);
  }
  await logStep(
    "variant/save",
    `berhasil — ${items.length} item masuk keranjang (slot resi 1)`,
  );

  // 3. Token halaman checkout → bayar saldo + upload label resmi.
  const tok = await anekaCheckoutToken(login.session, pay.paymentId);
  if (!tok.ok) {
    await logStep("checkout", `GAGAL — ${tok.detail}`);
    return gagal(tok.detail);
  }
  await logStep(
    "checkout",
    `token didapat — ${tok.itemResiIds.length} baris item_resi`,
  );
  const process = await anekaProcessPayment(
    login.session,
    pay.paymentId,
    tok.token,
    tok.itemResiIds,
    {
      number: payload.tracking_number,
      pdf: Buffer.from(payload.label_pdf_base64, "base64"),
    },
  );
  if (!process.ok) {
    await logStep("pembayaran/process", `GAGAL — ${process.detail}`);
    return gagal(process.detail);
  }
  await logStep(
    "pembayaran/process",
    `berhasil — bayar saldo wallet + upload label ${payload.tracking_number}`,
  );

  // 4. Kode pesanan Aneka dari riwayat (ORDER-{payment_id}-...); bukan
  //    penentu sukses — pembayaran sudah lolos — hanya untuk laporan.
  const found = await anekaFindOrderByPayment(login.session, pay.paymentId);
  const anekaId = found.ok && found.orderCode ? found.orderCode : "";
  await logStep(
    "verifikasi",
    anekaId
      ? `kode pesanan ${anekaId} ditemukan di riwayat`
      : "kode pesanan belum terbaca — cek riwayat manual",
  );

  const nowUtc = new Date().toISOString().slice(0, 19).replace("T", " ");
  await saveTiktokOrderExec({
    order_id: orderId,
    status: "selesai",
    payload: row.payload,
    aneka_payment_id: pay.paymentId,
    aneka_order_id: anekaId,
    detail: "",
    executed_at: nowUtc,
  });
  await logStep(
    "selesai",
    `status selesai — ${anekaId || "tanpa kode pesanan"}`,
  );

  await sendExecNotice(
    anekaId
      ? `Eksekusi Aneka BERHASIL untuk pesanan ${orderId}.\nID pesanan Aneka: ${anekaId}`
      : `Eksekusi Aneka BERHASIL untuk pesanan ${orderId} (payment ${pay.paymentId}), tetapi kode pesanan belum terbaca otomatis — cek riwayat: https://anekadropship.id/riwayat-pemesanan`,
  );
  return {
    ok: true,
    detail: `Selesai — ID pesanan Aneka: ${anekaId || "(cek riwayat)"}`,
  };
}
