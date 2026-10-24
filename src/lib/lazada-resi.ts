// Deteksi pesanan Lazada baru → jalur dua arah, identik dengan pola modul
// Blibli (blibli-resi.ts):
//
//  a. Item belum terpetakan ke Aneka → pemenuhan Lazada (pack → rts dengan
//     nomor resi penjual "KT<order_id>" → unduh label resmi) lalu PDF
//     dikirim ke WhatsApp pemilik toko.
//  b. SEMUA item terpetakan ke Aneka → antrean eksekusi "menunggu"
//     disiapkan + AUTOPACK (pack → rts otomatis supaya status Seller Center
//     berubah tanpa menunggu Setuju, pola Blibli) — rantai checkout Aneka
//     tetap menunggu tombol Setuju.
//
// Alur pengecekan:
//  1. Tarik pesanan terbaru (7 hari) lewat /orders/get dan bandingkan per
//     order item dengan tabel lazada_order_seen (kunci order_item_id +
//     order_id).
//  2. Mode baseline: bila tabel masih kosong (pertama kali), semua item
//     lama hanya DITANDAI tanpa kirim resi — mencegah banjir PDF sekaligus.
//  3. Item dibatalkan: kabari admin lewat WA sekali, tandai "batal: ..." —
//     resi tidak pernah dikirim untuk item batal.
//  4. Item baru (status pending): ditahan NEW_ORDER_WAIT_MS (default 15
//     menit, env LAZADA_RESI_DELAY_MINUTES) sebelum diproses — memberi
//     kesempatan pembeli membatalkan. Selama menunggu statusnya
//     "menunggu:<epoch_ms>".
//  5. Setelah masa tunggu (dipicu item pending pertama pesanan): item
//     pesanan diambil lewat /order/items/get → bila SEMUA terpetakan ke
//     Aneka, pesanan disiapkan sebagai antrean Setuju; bila tidak,
//     pemenuhan dijalankan dan label resmi dikirim ke WA admin. Satu
//     pesanan = SATU proses, item anggota lain ikut ditandai.
//  6. Kirim gagal ditandai + hitungan percobaan naik — dicoba ulang pada
//     pengecekan berikutnya sampai batas, lalu dihentikan (label tetap
//     bisa dibuka manual dari halaman Pesanan).
//
// Status pesanan Lazada yang relevan: pending (baru), packed/ready_to_ship
// (sudah dipenuhi), canceled/returned/failed/lost (pembatalan/pengembalian).
import {
  countSeenLazadaOrders,
  getLazadaOrderExec,
  listSeenLazadaOrders,
  markLazadaOrderSeen,
  recordLazadaOrderFailure,
  touchLazadaOrderSeen,
  updateLazadaOrderExecPayload,
} from "@/lib/db";
import {
  autoPackLazadaOrder,
  buatResiFallback,
  cancelLazadaExec,
  checkLazadaExecutable,
  lazadaTrackingNumber,
  notifSiapEksekusiLazada,
  prepareLazadaExec,
  sendExecNotice,
  type LazadaExecPayload,
  type LazadaExecSourceItem,
} from "@/lib/lazada-exec";
import {
  fulfillLazadaOrderForItems,
  getLazadaCtx,
  getLazadaOrderItems,
  getLazadaOrders,
  printLazadaAwbPdf,
  type LazadaOrderItemRow,
  type LazadaOrderRow,
} from "@/lib/lazada";
import { LAZADA_STORE_NAME } from "@/lib/lazada-orders";
import { getLazadaResmiAWB } from "@/lib/lazada-mtop";
import { awbCachedPdf, awbEnqueue } from "@/lib/lazada-awb";
import {
  NOTIF_TEMPLATE,
  ownerNumber,
  sendDocument,
  sendDocumentTemplate,
  sendTemplateParams,
  sendText,
} from "@/lib/wa";

/** Batas percobaan kirim ulang untuk item yang resinya gagal terkirim.
 *  Dengan jeda RETRY_COOLDOWN_MS antar percobaan, batas ini mencakup
 *  sekitar 6 jam pemulihan (label belum tersedia, situs sibuk, dll.). */
const MAX_SEND_ATTEMPTS = 12;

/** Jeda minimal antar percobaan ulang item yang gagal. Penting karena
 *  pengecekan bisa berjalan tiap menit (tab admin terbuka) — tanpa jeda,
 *  kegagalan sementara menghabiskan seluruh kuota percobaan dalam beberapa
 *  menit lalu item diam selamanya. */
const RETRY_COOLDOWN_MS = 30 * 60 * 1000;

/** Lama item baru ditahan sebelum diproses (env LAZADA_RESI_DELAY_MINUTES,
 *  default 15 menit) — memberi kesempatan pembeli membatalkan supaya label
 *  tidak dicetak/dikirim percuma. */
const NEW_ORDER_WAIT_MS =
  (Number(process.env.LAZADA_RESI_DELAY_MINUTES) || 15) * 60 * 1000;

/** Jeda minimal antar cek ulang status pesanan yang SUDAH diproses (untuk
 *  deteksi pengembalian/pembatalan parsial) — /order/items/get dipanggil
 *  per pesanan, tanpa jeda tick tiap menit akan menghabiskan kuota API. */
const RETURN_CHECK_INTERVAL_MS = 30 * 60 * 1000;

/** Status item yang perlu diproses (belum dipenuhi). "pending" = pesanan
 *  baru menunggu penjual; to_pack/to_ship/ready_to_ship/packed/shipped/
 *  delivered = sudah lewat gerbang pemrosesan. */
const ACTIONABLE_STATUSES = [
  "pending",
  "to_pack",
  "to_ship",
  "packed",
  "ready_to_ship",
  "shipped",
  "delivered",
];

/** Status item yang berarti "tidak akan dikirim" — pembatalan pembeli
 *  (canceled) atau pengembalian/gagal antar (returned/failed/lost). */
const PROBLEM_STATUSES = ["canceled", "returned", "failed", "lost"];

const PESANAN_URL = "https://admin.kustoro2026.com/marketplace/lazada/pesanan";

/** UTC "YYYY-MM-DD HH:MM:SS" → epoch ms. */
function parseUtcMs(s: string): number {
  const t = Date.parse(s.replace(" ", "T") + "Z");
  return Number.isFinite(t) ? t : 0;
}

export type LazadaResiCheckResult = {
  ok: boolean;
  baseline?: boolean;
  newOrders?: number;
  sent?: string[];
  errors?: string[];
  detail?: string;
};

/** Dokumen label resmi satu pesanan — hasil pemenuhan Lazada. */
export type LazadaOfficialResiResult =
  | {
      ok: true;
      pdf: Buffer;
      tracking_number: string;
      /** true bila label resmi tidak tersedia lewat API dan PDF yang
       *  dikembalikan adalah resi cadangan buatan sendiri. */
      fallback?: boolean;
      /** true bila PDF berasal dari unggahan pemilik — dokumen resmi yang
       *  diunduh dari Seller Center (bukan hasil API Open Platform). */
      unggahan?: boolean;
      /** true bila PDF dicetak otomatis lewat sesi web Seller Center (mtop
       *  print) — dokumen AWB resmi Lazada, bukan unggahan atau tiruan. */
      resmi?: boolean;
    }
  | { ok: false; detail: string };

/** Kirim label resmi satu pesanan ke nomor admin; kembalikan hasil untuk
 *  riwayat. Rantai: dokumen bebas (window 24 jam) → template dokumen resi
 *  (bebas window, menunggu review Meta) → template teks berisi tautan
 *  halaman Pesanan. */
export async function sendLazadaResiPdf(
  orderId: string,
  opts: { pdf: Buffer; label?: string },
): Promise<string> {
  const owner = ownerNumber();
  if (!owner) return "gagal: OWNER_WA_NUMBER belum diatur";

  const filename = `resi-lazada-${orderId}.pdf`;
  const caption = opts.label
    ? `Resi resmi pesanan ${orderId} — ${LAZADA_STORE_NAME} (${opts.label})`
    : `Resi pesanan ${orderId} — ${LAZADA_STORE_NAME}`;
  const suffix = opts.label ? ` (${opts.label})` : "";

  // 1. Dokumen bebas — hanya sah dalam window 24 jam sejak pemilik chat ke
  //    nomor API. Bila aktif, ini jalur tercepat tanpa menunggu review.
  const free = await sendDocument(owner, opts.pdf, filename, caption);
  if (free.ok) return `ok${suffix}`;

  // 2. Template utility ber-header DOKUMEN — bebas window 24 jam, tetapi
  //    menunggu status APPROVED dari review Meta.
  const doc = await sendDocumentTemplate(owner, opts.pdf, filename, orderId);
  if (doc.ok) return `ok (template${suffix})`;

  // 3. Template teks biasa: kabari saja dengan tautan halaman Pesanan Hub
  //    supaya resi tetap bisa dibuka manual.
  const tpl = await sendTemplateParams(owner, NOTIF_TEMPLATE, [
    `Pesanan ${orderId} — resi PDF gagal terkirim otomatis. Buka halaman Pesanan untuk mencetaknya: ${PESANAN_URL}`,
  ]);
  if (tpl.ok) return `ok (template teks${suffix})`;

  return `gagal: ${doc.error ?? "dokumen ditolak"} | template: ${tpl.error ?? "ditolak"}`;
}

/** Kirim notifikasi teks ke WA admin: teks bebas (window 24 jam) → template
 *  teks cadangan (bebas window, menunggu review Meta). */
async function sendOwnerNotice(msg: string): Promise<string> {
  const owner = ownerNumber();
  if (!owner) return "gagal: OWNER_WA_NUMBER belum diatur";
  const free = await sendText(owner, msg);
  if (free.ok) return "ok";
  const tpl = await sendTemplateParams(owner, NOTIF_TEMPLATE, [msg]);
  if (tpl.ok) return "ok (template)";
  return `gagal: ${free.error ?? "teks ditolak"} | template: ${tpl.error ?? "ditolak"}`;
}

/** Ambil nama + alamat pembeli dari address_shipping dengan bagian
 *  tersamar disaring. Lazada menyamarkan data pelanggan di API — nama
 *  "S**o", jalan "k***a", telp "6**7" (peristiwa 17 Okt 2026) — jadi
 *  HANYA bagian yang tidak tersamar yang ikut dicetak; bila semua
 *  tersamar, blok alamat kosong supaya label tidak menampilkan deretan
 *  bintang yang membingungkan seller. */
function pelangganDariAlamat(
  address?: LazadaOrderRow["address_shipping"],
): { customerName: string; customerAddress: string } {
  const customerName = [address?.first_name, address?.last_name]
    .filter((n) => n && n.trim() !== "")
    .join(" ")
    .trim();
  const tidakTersamar = (x?: string): x is string =>
    !!x && x.trim() !== "" && !x.includes("*");
  const alamatJalan = [
    address?.address1,
    address?.address2,
    address?.address3,
    address?.address4,
    address?.address5,
  ]
    .filter(tidakTersamar)
    .join(", ");
  const kota = [address?.city, address?.post_code]
    .filter(tidakTersamar)
    .join(" ");
  const customerAddress =
    [alamatJalan, kota, address?.country].filter(tidakTersamar).join(", ") +
    (tidakTersamar(address?.phone) ? ` — Telp ${address.phone}` : "");
  return { customerName, customerAddress };
}

/** Buat resi PDF cadangan (A6) dengan nomor resi asli — dipakai ketika
 *  pemenuhan berhasil (pack + rts) tetapi label resmi tidak bisa diunduh
 *  lewat API (pesanan kurir terintegrasi; AWB hanya ada di Seller Center).
 *  Nama/alamat diambil dari antrean eksekusi, lalu dari data pesanan
 *  (tersamar) bila kosong. */
async function buatResiCadangan(
  orderId: string,
  tracking: string,
): Promise<Buffer> {
  const row = await getLazadaOrderExec(orderId);
  let customerName = "";
  let alamatPembeli = "";
  if (row) {
    try {
      const pl = JSON.parse(row.payload) as Partial<LazadaExecPayload>;
      customerName = (pl.customer_name ?? "").trim();
      alamatPembeli = (pl.alamat_pembeli ?? "").trim();
    } catch {
      // payload rusak — biarkan kosong.
    }
  }
  if (!customerName) {
    const orders = await getLazadaOrders({
      created_after: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      sort_by: "updated_at",
      sort_direction: "DESC",
      offset: 0,
      limit: 100,
    });
    const addr = orders.ok
      ? orders.data.orders.find((o) => o.order_id === orderId)
          ?.address_shipping
      : undefined;
    const bersih = pelangganDariAlamat(addr);
    customerName = bersih.customerName;
    alamatPembeli = bersih.customerAddress;
  }
  return buatResiFallback({
    order_id: orderId,
    order_item_ids: [],
    store_name: LAZADA_STORE_NAME,
    customer_name: customerName,
    alamat_pembeli: alamatPembeli,
    tracking_number: tracking,
    label_pdf_base64: "",
    items: [],
    total_modal: 0,
  });
}

/** Ambil label RESMI Lazada untuk satu pesanan (pemenuhan penuh: pack →
 *  rts → document) — tanpa mengirim WA. Dipakai route cetak resi (dibuka
 *  di tab baru dari halaman Pesanan) dan tombol "Kirim Resi". Bila label
 *  resmi tidak tersedia lewat API, dikembalikan resi cadangan (fallback)
 *  dengan nomor resi asli. */
export async function getLazadaResiPdf(
  orderId: string,
): Promise<LazadaOfficialResiResult> {
  const items = await getLazadaOrderItems(orderId);
  if (!items.ok) return { ok: false, detail: items.detail };
  if (items.data.length === 0) {
    return { ok: false, detail: "Item pesanan tidak ditemukan" };
  }
  const problem = items.data.filter((i) =>
    PROBLEM_STATUSES.includes((i.status ?? "").toLowerCase()),
  );
  if (problem.length > 0) {
    return {
      ok: false,
      detail: `Pesanan memuat item dibatalkan/dikembalikan (${problem
        .map((i) => i.order_item_id)
        .join(", ")}) — tidak bisa dicetak resinya`,
    };
  }
  // Label resmi yang diunggah pemilik (diunduh dari Seller Center — AWB
  // pesanan kurir terintegrasi tidak bisa diambil lewat Open Platform)
  // punya prioritas tertinggi: dokumen asli Lazada, bukan hasil API atau
  // tiruan. Disimpan di payload antrean eksekusi.
  const row = await getLazadaOrderExec(orderId);
  let labelUnggahan: Buffer | null = null;
  let trackingUnggahan = "";
  if (row) {
    try {
      const pl = JSON.parse(row.payload) as Partial<LazadaExecPayload>;
      const b64 = (pl.label_pdf_base64 ?? "").trim();
      if (b64) {
        const dec = Buffer.from(b64, "base64");
        if (
          dec.length >= 5 &&
          dec.subarray(0, 5).toString("latin1") === "%PDF-"
        ) {
          labelUnggahan = dec;
          trackingUnggahan = pl.tracking_number ?? "";
        }
      }
    } catch {
      // payload rusak — lanjut alur biasa.
    }
  }
  if (labelUnggahan) {
    const asli = items.data
      .map((x) => (x.tracking_code ?? "").trim())
      .find((x) => x !== "");
    return {
      ok: true,
      pdf: labelUnggahan,
      tracking_number:
        asli || trackingUnggahan || lazadaTrackingNumber(orderId),
      unggahan: true,
    };
  }

  // AWB resmi hasil jembatan browser (dicetak otomatis engine di halaman
  // Seller Center yang login) — prioritas setara unggahan, di bawahnya.
  const awbCache = await awbCachedPdf(orderId);
  if (awbCache) {
    const asliAwb = items.data
      .map((x) => (x.tracking_code ?? "").trim())
      .find((x) => x !== "");
    return {
      ok: true,
      pdf: awbCache,
      tracking_number: asliAwb || lazadaTrackingNumber(orderId),
      resmi: true,
    };
  }

  const fulf = await fulfillLazadaOrderForItems(
    items.data.map((i) => i.order_item_id),
    orderId,
  );
  if (!fulf.ok) {
    // Pemenuhan (pack + rts) berhasil tetapi label resmi tidak tersedia
    // lewat API (pesanan kurir terintegrasi — AWB hanya ada di Seller
    // Center). Buat resi cadangan dengan nomor resi ASLI supaya halaman
    // Pesanan tetap bisa mencetak dokumen yang sah untuk ditempel.
    if (fulf.rtsDone) {
      const tracking = fulf.trackingNumber ?? lazadaTrackingNumber(orderId);
      const itemIds = items.data.map((i) => i.order_item_id);

      // Prioritas 1 — cetak AWB RESMI lewat Open Platform (PrintAWB):
      // dokumen asli Lazada TANPA login browser. package_id diambil dari
      // hasil pack pemenuhan ini, atau dari items/get (pesanan yang sudah
      // dikemas sebelumnya). Bila tersedia, hasilnya disimpan ke payload
      // supaya pemanggilan berikutnya langsung pakai cache (sama seperti
      // label unggahan).
      const packageId =
        fulf.packageId ??
        items.data
          .map((i) => (i.package_id ?? "").trim())
          .find((x) => x !== "");
      if (packageId) {
        const awbApi = await printLazadaAwbPdf(packageId);
        if (awbApi.ok) {
          try {
            const baris = await getLazadaOrderExec(orderId);
            let payload: Record<string, unknown> = {};
            if (baris) {
              try {
                payload = JSON.parse(baris.payload) as Record<string, unknown>;
              } catch {
                payload = {};
              }
            }
            payload.label_pdf_base64 = awbApi.data.toString("base64");
            payload.tracking_number = tracking;
            payload.package_id = packageId;
            await updateLazadaOrderExecPayload(orderId, JSON.stringify(payload));
          } catch {
            // cache gagal — PDF tetap dikembalikan untuk cetak kali ini.
          }
          return {
            ok: true,
            pdf: awbApi.data,
            tracking_number: tracking,
            resmi: true,
          };
        }
      }

      // Prioritas: cetak AWB RESMI otomatis lewat sesi web Seller Center
      // (mtop print) — dokumen asli Lazada, bukan tiruan. Hasilnya
      // disimpan ke payload supaya pemanggilan berikutnya langsung pakai
      // cache (sama seperti label unggahan).
      const awb = await getLazadaResmiAWB(orderId, itemIds);
      if (awb.ok) {
        try {
          const baris = await getLazadaOrderExec(orderId);
          let payload: Record<string, unknown> = {};
          if (baris) {
            try {
              payload = JSON.parse(baris.payload) as Record<string, unknown>;
            } catch {
              payload = {};
            }
          }
          payload.label_pdf_base64 = awb.pdf.toString("base64");
          payload.tracking_number = tracking;
          await updateLazadaOrderExecPayload(orderId, JSON.stringify(payload));
        } catch {
          // cache gagal — PDF tetap dikembalikan untuk cetak kali ini.
        }
        return {
          ok: true,
          pdf: awb.pdf,
          tracking_number: tracking,
          resmi: true,
        };
      }
      // Antrekan cetak AWB lewat jembatan browser (engine di halaman Seller
      // Center yang login) — panggilan mtop dari server ditolak risk-control,
      // jadi jalur resmi otomatisnya lewat browser. Label resmi tersedia pada
      // Cetak Resi berikutnya setelah engine selesai; sementara itu resi
      // cadangan tetap dikembalikan supaya ada dokumen yang bisa dipakai.
      void awbEnqueue(
        orderId,
        items.data.map((i) => i.order_item_id),
      ).catch(() => {
        // antrean gagal — tidak fatal; resi cadangan tetap dikembalikan.
      });
      const pdf = await buatResiCadangan(orderId, tracking);
      return {
        ok: true,
        pdf,
        tracking_number: tracking,
        fallback: true,
      };
    }
    return { ok: false, detail: fulf.detail };
  }
  return { ok: true, pdf: fulf.pdf, tracking_number: fulf.trackingNumber };
}

/** Kirim label resmi pesanan tertentu ke WA admin (dipakai tombol manual
 *  "Kirim Resi" di halaman Pesanan). */
export async function sendResiForLazadaOrder(
  orderId: string,
): Promise<{ ok: boolean; result: string }> {
  const official = await getLazadaResiPdf(orderId);
  if (!official.ok) return { ok: false, result: official.detail };

  const result = await sendLazadaResiPdf(orderId, {
    pdf: official.pdf,
    label: `resi ${official.tracking_number}`,
  });
  if (result.startsWith("ok")) {
    const items = await getLazadaOrderItems(orderId);
    const ctx = await getLazadaCtx();
    if (items.ok && ctx.ok) {
      for (const it of items.data) {
        await markLazadaOrderSeen(
          it.order_item_id,
          orderId,
          ctx.sellerId,
          result,
        );
      }
    }
  }
  return { ok: result.startsWith("ok"), result };
}

/** Kunci serialisasi antar panggilan berbarengan dalam satu instans —
 *  pemicu (webhook tick, pinger, tab admin) bisa mendarat bersamaan, dan
 *  tanpa kunci dua ronde bisa sama-sama membaca tabel sebelum baris seen
 *  ditulis lalu mengirim notif ganda. */
let gRun: Promise<LazadaResiCheckResult> | null = null;

/** Jalankan satu ronde pengecekan pesanan Lazada baru toko KTD STORE.
 *  Idempoten — tabel lazada_order_seen mencegah kirim ganda. Satu pesanan
 *  diproses SATU kali (dipicu item pending pertama yang melewati masa
 *  tunggu); item anggota lain ikut ditandai hasil yang sama. */
export async function checkNewLazadaOrders(): Promise<LazadaResiCheckResult> {
  if (gRun) return gRun;
  gRun = runCheckNewLazadaOrders().finally(() => {
    gRun = null;
  });
  return gRun;
}

async function runCheckNewLazadaOrders(): Promise<LazadaResiCheckResult> {
  const owner = ownerNumber();
  if (!owner) {
    return { ok: false, detail: "OWNER_WA_NUMBER belum diatur" };
  }
  const ctx = await getLazadaCtx();
  if (!ctx.ok) {
    return { ok: false, detail: ctx.detail };
  }
  const storeCode = ctx.sellerId || ctx.shortCode;

  const baseline = (await countSeenLazadaOrders()) === 0;
  const seenRows = await listSeenLazadaOrders();
  const seen = new Map(
    seenRows.map((s) => [
      s.order_item_id,
      {
        order_id: s.order_id,
        notify: s.notify,
        attempts: Number(s.attempts ?? 0),
        last_attempt_at: s.last_attempt_at,
      },
    ]),
  );
  const markSeen = async (id: string, orderId: string, notify: string) => {
    await markLazadaOrderSeen(id, orderId, storeCode, notify);
    seen.set(id, { order_id: orderId, notify, attempts: 0, last_attempt_at: "" });
  };

  // Tarik pesanan 7 hari terakhir (semua status — pembatalan & pending
  // sama-sama perlu dipantau), terbaru dulu.
  const now = Date.now();
  const ord = await getLazadaOrders({
    created_after: new Date(now - 7 * 86400 * 1000).toISOString(),
    sort_by: "updated_at",
    sort_direction: "DESC",
    offset: 0,
    limit: 100,
  });
  if (!ord.ok) return { ok: false, detail: ord.detail };

  const orders = ord.data.orders;
  const orderRowMap = new Map(orders.map((o) => [o.order_id, o]));
  const orderItemsMap = new Map<string, LazadaOrderItemRow[]>();

  const sent: string[] = [];
  const errors: string[] = [];
  let newOrders = 0;

  // Baris eksekusi Aneka per pesanan diambil LAZY lewat getLazadaOrderExec —
  // memuat semua baris (termasuk payload+log) tiap ronde menghabiskan kuota
  // egress database, padahal map hanya dipakai untuk kasus batal/refund.
  /** Potongan pesan "minta refund ke CS Aneka" berdasar baris eksekusi
   *  (bila ada) — sebutkan ID pembayaran, kode pesanan, dan total modal
   *  supaya admin tinggal membacakan datanya ke CS Aneka. */
  function refundAnekaInfo(
    exec:
      | { aneka_payment_id: string; aneka_order_id: string; payload: string }
      | undefined,
  ): string {
    if (!exec) {
      return " Bila sudah dibayar ke Aneka, SEGERA minta refund ke CS Aneka.";
    }
    const parts: string[] = [];
    if (exec.aneka_payment_id) {
      parts.push(`ID pembayaran ${exec.aneka_payment_id}`);
    }
    if (exec.aneka_order_id) {
      parts.push(`pesanan ${exec.aneka_order_id}`);
    }
    try {
      const t = Number(JSON.parse(exec.payload).total_modal ?? 0);
      if (t > 0) parts.push(`total ${"Rp" + t.toLocaleString("id-ID")}`);
    } catch {
      /* payload rusak — lewati total */
    }
    return parts.length > 0
      ? ` SEGERA minta refund ke CS Aneka (${parts.join(", ")}).`
      : " SEGERA minta refund ke CS Aneka.";
  }

  const noticedOrders = new Set<string>(); // notif "pesanan baru" sekali per pesanan
  const handledOrders = new Set<string>(); // proses label/eksekusi sekali per pesanan

  for (const order of orders) {
    const orderId = order.order_id;
    const statuses = (order.statuses ?? []).map((s) => (s ?? "").toLowerCase());
    const hit = (list: string[]) => statuses.some((s) => list.includes(s));
    const hasActionable = hit(ACTIONABLE_STATUSES);
    const hasProblem = hit(PROBLEM_STATUSES);

    // Baris seen milik pesanan ini (semua status notifikasi).
    const orderSeen = seenRows.filter((r) => r.order_id === orderId);
    const anyMenungguGagal = orderSeen.some(
      (r) => r.notify.startsWith("menunggu") || r.notify.startsWith("gagal"),
    );
    const anyAktifDiproses = orderSeen.some(
      (r) => r.notify.startsWith("ok") || r.notify.startsWith("eksekusi"),
    );
    const anyBelumSelesai = orderSeen.some(
      (r) =>
        !r.notify.startsWith("batal") &&
        !r.notify.startsWith("refund") &&
        r.notify !== "skip",
    );

    // Hemat kuota /order/items/get: ambil item HANYA bila ada alasan
    // (pesanan baru/menunggu/gagal, atau masalah status untuk pesanan
    // yang pernah diproses — dengan jeda antar cek ulang).
    let needItems = false;
    let recheckMode = false;
    if (orderSeen.length === 0) {
      needItems = hasActionable;
    } else if (anyMenungguGagal) {
      needItems = hasActionable || hasProblem;
    } else if (hasProblem && anyBelumSelesai) {
      needItems = true;
    } else if (anyAktifDiproses) {
      const lastCheck = Math.max(
        ...orderSeen.map((r) =>
          r.last_attempt_at ? parseUtcMs(r.last_attempt_at) : 0,
        ),
        0,
      );
      recheckMode = true;
      needItems =
        (hasActionable || hasProblem) &&
        Date.now() - lastCheck >= RETURN_CHECK_INTERVAL_MS;
    }
    if (!needItems) continue;

    const itemsR = await getLazadaOrderItems(orderId);
    if (!itemsR.ok) {
      errors.push(`${LAZADA_STORE_NAME}: ${orderId}: ${itemsR.detail}`);
      // Item yang sedang menunggu/gagal ikut dicatat supaya percobaan
      // ulangnya diberi jeda dan tidak membakar kuota tiap menit.
      for (const r of orderSeen) {
        if (r.notify.startsWith("menunggu") || r.notify.startsWith("gagal")) {
          await recordLazadaOrderFailure(
            r.order_item_id,
            orderId,
            storeCode,
            `gagal: ${itemsR.detail}`,
          );
        }
      }
      continue;
    }
    const items = itemsR.data;
    orderItemsMap.set(orderId, items);

    /** true bila baris item ini pernah diproses (resi terkirim / eksekusi
     *  disiapkan) — membedakan jalur pembatalan vs pengembalian. */
    const diproses = (notify: string) =>
      notify.startsWith("ok") || notify.startsWith("eksekusi");

    /** Ditandai ketika ada aksi (kirim/tandai) untuk pesanan ini pada ronde
     *  ini — bila recheckMode dan tidak ada aksi, sentuh last_attempt_at
     *  supaya cek ulang berikutnya diberi jeda. */
    let orderAdaAksi = false;

    for (const it of items) {
      const itemId = it.order_item_id;
      const prev = seen.get(itemId);
      const st = (it.status ?? "").toLowerCase();
      const problem = PROBLEM_STATUSES.includes(st);
      const isNew = st === "pending";

      // Sudah pernah dikabari pembatalan/pengembaliannya — lewati.
      if (
        prev &&
        (prev.notify.startsWith("batal") || prev.notify.startsWith("refund"))
      )
        continue;

      // Item dibatalkan/dikembalikan SEBELUM diproses: kabari admin (sekali
      // per pesanan) — resi tidak dikirim untuk item batal.
      if (problem && !(prev && diproses(prev.notify))) {
        // Batalkan juga antrean eksekusi Aneka bila SELURUH item bermasalah.
        if (items.every((x) => PROBLEM_STATUSES.includes((x.status ?? "").toLowerCase()))) {
          await cancelLazadaExec(orderId);
        }
        // Percobaan ulang notifikasi pembatalan juga diberi jeda — tanpa
        // jeda, WA down beberapa menit menghabiskan kuota percobaan.
        if (
          prev &&
          prev.notify.startsWith("gagal") &&
          prev.last_attempt_at &&
          Date.now() - parseUtcMs(prev.last_attempt_at) < RETRY_COOLDOWN_MS
        ) {
          continue;
        }
        const silent =
          baseline ||
          prev?.notify === "skip" ||
          (prev && prev.attempts >= MAX_SEND_ATTEMPTS);
        if (silent) {
          await markSeen(itemId, orderId, "batal (tanpa kirim)");
          continue;
        }
        const itemsTxt = ` — ${it.name}`;
        const resiTerlanjur = prev && prev.notify.startsWith("ok");
        // Item yang SUDAH diproses lalu dibatalkan = uang mungkin sudah
        // keluar ke Aneka — ingatkan admin untuk minta refund ke CS Aneka.
        const exec = (await getLazadaOrderExec(orderId)) ?? undefined;
        const terlanjurBayar =
          resiTerlanjur ||
          prev?.notify.startsWith("eksekusi") ||
          (exec?.aneka_payment_id ?? "") !== "";
        const msg = terlanjurBayar
          ? `Pesanan Lazada dibatalkan SETELAH diproses: ${orderId}${itemsTxt}.${refundAnekaInfo(exec)} Label yang sempat terkirim mohon diabaikan.`
          : `Pesanan Lazada dibatalkan: ${orderId}${itemsTxt}. Tidak perlu disiapkan/dikirim.`;
        const res = await sendOwnerNotice(msg);
        if (res.startsWith("ok")) {
          const mark = `batal: ${res}${terlanjurBayar ? " (minta refund Aneka)" : ""}`;
          await markSeen(itemId, orderId, mark);
          orderAdaAksi = true;
          sent.push(`${LAZADA_STORE_NAME} ${orderId} → ${mark}`);
        } else {
          errors.push(`${LAZADA_STORE_NAME}: ${orderId}: ${res}`);
          await recordLazadaOrderFailure(
            itemId,
            orderId,
            storeCode,
            `gagal batal: ${res}`,
          );
        }
        continue;
      }

      // Deteksi pesanan dikembalikan/gagal antar untuk item yang SUDAH
      // diproses. Status item dari /order/items/get — tanpa panggilan
      // tambahan; recheckMode menjamin cek ini hanya berjalan dengan jeda.
      if (prev && diproses(prev.notify) && problem) {
        const exec = (await getLazadaOrderExec(orderId)) ?? undefined;
        const msg = `Pesanan Lazada dikembalikan/gagal antar: ${orderId} — ${it.name} (status: ${st}).${refundAnekaInfo(exec)}`;
        const res = await sendOwnerNotice(msg);
        if (res.startsWith("ok")) {
          await markSeen(itemId, orderId, `refund: ${res}`);
          orderAdaAksi = true;
          sent.push(`${LAZADA_STORE_NAME} ${orderId} → refund: ${res}`);
        } else {
          errors.push(`${LAZADA_STORE_NAME}: ${orderId}: ${res}`);
          await recordLazadaOrderFailure(
            itemId,
            orderId,
            storeCode,
            `gagal refund: ${res}`,
          );
        }
        continue;
      }

      // Gerbang status: hanya item pending (pesanan baru penjual) yang
      // diproses. PENGECUALIAN: item yang gagal/menunggu SETELAH pemenuhan
      // (notify "gagal"/"menunggu" dan status bukan problem) boleh diulang.
      const bisaUlangLabel =
        (prev?.notify.startsWith("gagal") ||
          prev?.notify.startsWith("menunggu")) &&
        !problem;
      if (!isNew && !bisaUlangLabel) continue;

      // Mode baseline: tandai saja item lama, jangan kirim resi.
      if (!prev && baseline) {
        await markSeen(itemId, orderId, "skip");
        continue;
      }

      // Item baru: tunda pemrosesan (baris "menunggu" menyimpan epoch saat
      // pertama kali terlihat) — beri kesempatan pembeli membatalkan.
      if (!prev) {
        await markSeen(itemId, orderId, `menunggu:${Date.now()}`);
        orderAdaAksi = true;
        newOrders++;
        // Kabari admin bahwa pesanan terdeteksi — informasi saja, tidak
        // memengaruhi alur (masa tunggu tetap berjalan). Sekali per pesanan.
        if (!noticedOrders.has(orderId)) {
          noticedOrders.add(orderId);
          const itemsTxt =
            items.length > 0
              ? ` — ${items[0].name}${items.length > 1 ? ` (+${items.length - 1} produk lain)` : ""}`
              : "";
          const notice = await sendOwnerNotice(
            `Pesanan Lazada baru: ${orderId}${itemsTxt}. Akan diproses otomatis ±15 menit (memberi kesempatan pembeli membatalkan).`,
          );
          if (!notice.startsWith("ok")) {
            errors.push(
              `${LAZADA_STORE_NAME}: ${orderId}: notif pesanan baru gagal: ${notice}`,
            );
          }
        }
        continue;
      }

      // Masih dalam masa tunggu sebelum item boleh diproses.
      if (prev.notify.startsWith("menunggu")) {
        const since = Number(prev.notify.split(":")[1] ?? 0);
        if (Date.now() - since < NEW_ORDER_WAIT_MS) continue;
      } else if (!prev.notify.startsWith("gagal")) {
        // Sudah pernah berhasil diproses — lewati.
        continue;
      }

      // Sudah gagal berkali-kali — berhenti mencoba (label tetap bisa
      // dibuka manual dari halaman Pesanan).
      if (prev.attempts >= MAX_SEND_ATTEMPTS) continue;

      // Percobaan ulang diberi jeda — bila pengecekan berjalan tiap menit
      // (tab admin terbuka), tanpa jeda ini kegagalan sementara langsung
      // menghabiskan kuota percobaan dalam hitungan menit.
      if (
        prev.notify.startsWith("gagal") &&
        prev.last_attempt_at &&
        Date.now() - parseUtcMs(prev.last_attempt_at) < RETRY_COOLDOWN_MS
      ) {
        continue;
      }

      // Pesanan ini mungkin sudah diproses lewat item lain di ronde ini.
      if (handledOrders.has(orderId)) continue;

      // Masa tunggu selesai, atau percobaan ulang untuk kiriman yang gagal.
      newOrders++;
      handledOrders.add(orderId);
      orderAdaAksi = true;

      // Item pesanan sudah diambil di atas (orderItemsMap) — sumber data
      // yang benar: satu baris per unit, status terbaru tiap item (item
      // bisa saja dibatalkan di tengah masa tunggu).
      const semuaBatal =
        items.length > 0 &&
        items.every((x) =>
          PROBLEM_STATUSES.includes((x.status ?? "").toLowerCase()),
        );
      const adaBatal = items.some((x) =>
        PROBLEM_STATUSES.includes((x.status ?? "").toLowerCase()),
      );
      if (semuaBatal) {
        await cancelLazadaExec(orderId);
        const itemsTxt = items.length > 0 ? ` — ${items[0].name}` : "";
        const res = await sendOwnerNotice(
          `Pesanan Lazada dibatalkan: ${orderId}${itemsTxt}. Tidak perlu disiapkan/dikirim.`,
        );
        for (const x of items) {
          await markSeen(
            x.order_item_id,
            orderId,
            res.startsWith("ok") ? `batal: ${res}` : "batal (tanpa kirim)",
          );
        }
        if (!res.startsWith("ok")) {
          errors.push(`${LAZADA_STORE_NAME}: ${orderId}: ${res}`);
        }
        continue;
      }

      const aktif = items.filter(
        (x) =>
          !PROBLEM_STATUSES.includes((x.status ?? "").toLowerCase()),
      );

      // Fase 2: bila SEMUA item pesanan sudah dipetakan ke Aneka, jangan
      // kirim resi — siapkan eksekusi semi-otomatis (tunggu tombol Setuju
      // di halaman Eksekusi; rantai checkout Aneka + pemenuhan Lazada baru
      // dijalankan saat disetujui supaya tidak menumpuk pembayaran
      // mangkrak). Pesanan dengan item dibatalkan sebagian TIDAK dieksekusi
      // otomatis — proses manual.
      const srcItems: LazadaExecSourceItem[] = aktif.map((d) => ({
        // Kunci pemetaan = SellerSku; API /order/items/get kadang
        // mengembalikannya sebagai kolom "sku" (seller_sku kosong) —
        // pakai fallback supaya pemetaan tetap cocok. shop_sku untuk
        // tampilan.
        lazada_sku: d.seller_sku || d.sku,
        seller_sku: d.shop_sku,
        item_name: d.name,
        variant_name: d.variation ?? "",
        // Satu order item = satu unit — baris kembar (SKU + varian sama)
        // digabung otomatis di checkLazadaExecutable.
        qty: 1,
      }));
      const execCheck = adaBatal
        ? {
            ok: false as const,
            detail: "Sebagian item pesanan dibatalkan pembeli — proses manual",
          }
        : await checkLazadaExecutable(srcItems);

      // Nama/alamat untuk resi PDF cadangan (label resmi Lazada tidak
      // selalu tersedia lewat API untuk pesanan own-logistics/terintegrasi).
      const { customerName, customerAddress } = pelangganDariAlamat(
        orderRowMap.get(orderId)?.address_shipping,
      );

      if (execCheck.ok) {
        // Persiapan antrean SENYAP dulu — notif "siap dieksekusi" dikirim
        // SETELAH autopack supaya nomor resi yang tercantum sudah resi asli.
        const resend = prev.notify.startsWith("gagal");
        const prep = await prepareLazadaExec(
          {
            order_id: orderId,
            order_item_ids: items.map((x) => x.order_item_id),
            store_name: LAZADA_STORE_NAME,
            customer_name: customerName,
            customer_address: customerAddress,
            items: srcItems,
          },
          // Percobaan ulang setelah kegagalan: antrean "menunggu" mungkin
          // sudah tersimpan tetapi notif WA-nya gagal — kirim ulang.
          { resendNotice: resend, silent: true },
        );
        if (!prep.ok) {
          errors.push(`${LAZADA_STORE_NAME}: ${orderId}: ${prep.detail}`);
          await recordLazadaOrderFailure(
            itemId,
            orderId,
            storeCode,
            `gagal: ${prep.detail}`,
          );
          continue;
        }
        for (const x of items) {
          await markSeen(x.order_item_id, orderId, "eksekusi:menunggu");
        }

        // Ronde lain sudah menyiapkan antrean (klaim kalah) — autopack dan
        // notif Setuju sudah dijalankan ronde pemenang; lewati supaya tidak
        // dobel. Jalur resend (notif WA gagal sebelumnya) tetap lanjut.
        if (!prep.created && !resend) {
          sent.push(
            `${LAZADA_STORE_NAME} ${orderId} → sudah menunggu persetujuan Aneka`,
          );
          continue;
        }

        // AUTOPACK: kemas + rts otomatis sekarang juga — status pesanan di
        // Seller Center berubah tanpa menunggu klik Setuju (sama seperti
        // Blibli). Kegagalan TIDAK membatalkan antrean: pemenuhan diulang
        // saat Setuju ditekan.
        let catatanPack = "";
        try {
          const auto = await autoPackLazadaOrder(orderId);
          if (auto.ok) {
            catatanPack = auto.tracking
              ? `Paket otomatis dikemas & siap kirim (resi ${auto.tracking}) — status Lazada sudah berubah, tinggal klik Setuju untuk checkout Aneka.`
              : "Paket otomatis dikemas & siap kirim — tinggal klik Setuju untuk checkout Aneka.";
            sent.push(
              `${LAZADA_STORE_NAME} ${orderId} → otomatis dikemas (${auto.detail})`,
            );
          } else {
            catatanPack =
              "Paket belum bisa dikemas otomatis — pemenuhan dijalankan saat tombol Setuju ditekan.";
            errors.push(
              `${LAZADA_STORE_NAME}: ${orderId}: autopack: ${auto.detail}`,
            );
          }
        } catch (e) {
          catatanPack =
            "Paket belum bisa dikemas otomatis — pemenuhan dijalankan saat tombol Setuju ditekan.";
          errors.push(
            `${LAZADA_STORE_NAME}: ${orderId}: autopack error: ${e instanceof Error ? e.message : "tidak dikenal"}`,
          );
        }

        // Payload TERBARU (resi/label hasil autopack) untuk teks notif.
        const rowExec = await getLazadaOrderExec(orderId);
        let payloadFinal: LazadaExecPayload | null = null;
        if (rowExec) {
          try {
            payloadFinal = JSON.parse(rowExec.payload) as LazadaExecPayload;
          } catch {
            payloadFinal = null;
          }
        }
        if (!payloadFinal) {
          payloadFinal = {
            order_id: orderId,
            order_item_ids: items.map((x) => x.order_item_id),
            store_name: LAZADA_STORE_NAME,
            customer_name: customerName,
            alamat_pembeli: customerAddress,
            tracking_number: lazadaTrackingNumber(orderId),
            label_pdf_base64: "",
            items: execCheck.items,
            total_modal: execCheck.items.reduce((s, it) => s + it.subtotal, 0),
          };
        }
        const notice = await sendExecNotice(
          notifSiapEksekusiLazada(payloadFinal, catatanPack),
        );
        if (!notice.startsWith("ok")) {
          errors.push(
            `${LAZADA_STORE_NAME}: ${orderId}: notif siap eksekusi gagal: ${notice}`,
          );
          await recordLazadaOrderFailure(
            itemId,
            orderId,
            storeCode,
            `gagal: notif WA gagal: ${notice}`,
          );
        } else {
          sent.push(
            `${LAZADA_STORE_NAME} ${orderId} → menunggu persetujuan Aneka`,
          );
        }
        continue;
      }

      // Item belum terpetakan ke Aneka — jalur lama: pemenuhan Lazada lalu
      // kirim label ke WA.
      const official = await fulfillLazadaOrderForItems(
        items.map((x) => x.order_item_id),
        orderId,
      );
      if (!official.ok) {
        errors.push(`${LAZADA_STORE_NAME}: ${orderId}: ${official.detail}`);
        await recordLazadaOrderFailure(
          itemId,
          orderId,
          storeCode,
          `gagal: ${official.detail}`,
        );
        continue;
      }

      const result = await sendLazadaResiPdf(orderId, {
        pdf: official.pdf,
        label: `resi ${official.trackingNumber}`,
      });
      if (result.startsWith("ok")) {
        for (const x of items) {
          await markSeen(x.order_item_id, orderId, result);
        }
        sent.push(`${LAZADA_STORE_NAME} ${orderId} → ${result}`);
        // Jelaskan KENAPA tidak dieksekusi otomatis — jangan biarkan
        // pemilik mengira pesanan berjalan otomatis padahal manual.
        await sendOwnerNotice(
          `Catatan pesanan ${orderId}: eksekusi otomatis TIDAK dijalankan — ${execCheck.detail}. Pesanan ini diproses manual.`,
        );
      } else {
        errors.push(`${LAZADA_STORE_NAME}: ${orderId}: ${result}`);
        await recordLazadaOrderFailure(itemId, orderId, storeCode, result);
      }
    }

    // Cek ulang status (recheckMode) tanpa temuan apa pun: sentuh
    // last_attempt_at baris yang sudah diproses supaya cek berikutnya
    // diberi jeda dan kuota /order/items/get tidak habis tiap menit.
    if (recheckMode && !orderAdaAksi) {
      const nowStr = new Date().toISOString().slice(0, 19).replace("T", " ");
      for (const r of orderSeen) {
        if (diproses(r.notify)) {
          await touchLazadaOrderSeen(r.order_item_id, nowStr);
        }
      }
    }
  }

  return {
    ok: true,
    baseline,
    newOrders,
    sent,
    errors,
  };
}
