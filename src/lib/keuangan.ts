// Dashboard Keuangan KTD Hub — merangkum uang masuk (omset TikTok Shop,
// Blibli & Lazada) dan uang keluar (pembayaran Aneka) untuk rentang
// tanggal, plus saldo wallet Aneka hasil scrape read-only yang di-cache
// di database.
//
// Sumber data:
// - Omset: API resmi TikTok (detail pesanan — harga jual per baris item),
//   API Seller Blibli (paket pesanan — finalPrice per item), dan Open
//   Platform Lazada (price tingkat pesanan).
// - Pengeluaran + saldo: situs anekadropship.id (halaman /payment-history:
//   baris pembayaran berisi kode ORDER, total, status, nomor resi — saldo
//   wallet tampil di header halaman yang sama). Aneka tidak punya API
//   resmi, jadi snapshot di-cache 15 menit; cron harian + tombol Muat
//   Ulang di halaman memperbarui cache.
// - Laba kotor = omset − total pembayaran Aneka (total Aneka sudah
//   termasuk ongkos pengemasan Rp3.000). Komisi TikTok BELUM ikut
//   dihitung (laba bersih menyusul).
import {
  getAnekaFinanceCache,
  setAnekaFinanceCache,
  listTiktokOrderExecs,
  listTiktokShopTokens,
  listBlibliOrderExecs,
  listLazadaOrderExecs,
  type AnekaFinanceCacheRow,
  type BlibliOrderExec,
  type LazadaOrderExec,
  type TiktokOrderExec,
  type TiktokShopToken,
} from "@/lib/db";
import { anekaLogin, fetchRetry } from "@/lib/aneka-checkout";
import { prepareShop, pullTiktokShopOrders } from "@/lib/tiktok-orders";
import { pullBlibliOrders } from "@/lib/blibli-orders";
import { type BlibliOrderPackage } from "@/lib/blibli";
import { pullLazadaOrders } from "@/lib/lazada-orders";
import { getLazadaOrderItems, type LazadaOrderRow } from "@/lib/lazada";
import { type LazadaExecPayload } from "@/lib/lazada-exec";
import {
  getTiktokOrderDetail,
  resolveLineQty,
  type TiktokOrderDetail,
  type TiktokOrderSummary,
} from "@/lib/tiktok";
import {
  checkAnekaExecutable,
  type AnekaExecPayload,
} from "@/lib/aneka-exec";
import { type BlibliExecPayload } from "@/lib/blibli-exec";

const BASE = "https://anekadropship.id";
const CACHE_KEY = "aneka-keuangan-v1";
/** Usia maksimal snapshot riwayat Aneka sebelum di-scrape ulang. */
const CACHE_TTL_MS = 15 * 60 * 1000;
/** Maksimal halaman riwayat yang discan per refresh. */
const MAKS_HALAMAN = 6;
/** Ongkos pengemasan Aneka per resi (dibebankan di luar harga modal). */
const ONGKOS_PACKING = 3000;

// ---------- tipe ----------

export type AnekaPaymentRow = {
  paymentId: string;
  orderCode: string;
  total: number;
  status: string;
  resi: string;
  /** Epoch ms — diturunkan dari stempel kode ORDER-{id}-{ts} (UTC). */
  tanggalMs: number;
};

export type AnekaSnapshot = {
  saldo: number;
  /** ISO UTC — kapan snapshot ini di-scrape. */
  fetchedAt: string;
  rows: AnekaPaymentRow[];
  /** Jejak saldo per fetch (48 jam) — dasar perkiraan top-up. */
  riwayatSaldo: { t: number; saldo: number }[];
};

export type BarisKeuangan = {
  orderId: string;
  /** Sumber pesanan — TikTok Shop, Blibli, atau Lazada. */
  pasar: "TikTok" | "Blibli" | "Lazada";
  waktuMs: number;
  produk: string;
  qty: number;
  omset: number;
  statusOrder: string;
  statusExec: string;
  resi: string;
  bayarIds: string[];
  bayarAneka: number;
  /** Bagian dari bayarAneka yang dibayar manual (di luar KTD Hub). */
  bayarManualAneka: number;
  estimasiModal: number;
  estimasiPacking: number;
  laba: number;
  labaRealisasi: boolean;
};

export type DataKeuangan = {
  dariMs: number;
  sampaiMs: number;
  omset: number;
  bayarAneka: number;
  labaKotor: number;
  saldo: number;
  saldoWaktuMs: number;
  /** true = data Aneka hasil scrape segar; false = memakai cache basi. */
  segar: boolean;
  anekaError: string;
  jumlahOrder: number;
  jumlahBayar: number;
  baris: BarisKeuangan[];
  /** Baris riwayat Aneka dalam rentang tanggal (semua status). */
  pembayaran: AnekaPaymentRow[];
  /** Pembayaran Success VIA HUB dalam rentang yang resinya tidak cocok
   *  dengan order TikTok rentang ini (mis. pembayaran order hari
   *  sebelumnya) — pembayaran manual tampil terpisah di bayarManual. */
  bayarTanpaOrder: AnekaPaymentRow[];
  /** Pembayaran manual (bukan via KTD Hub) dalam rentang — Success saja,
   *  beserta pasangan order TikTok-nya (kosong = tidak ada pasangan). */
  bayarManual: { row: AnekaPaymentRow; orderId: string }[];
  /** Semua id pembayaran manual dalam rentang (semua status) — untuk
   *  penanda "Manual" pada tabel pembayaran. */
  pembayaranManualIds: string[];
  /** Resi yang muncul di 2+ pembayaran Success (indikasi bayar dobel). */
  resiDobel: { resi: string; jumlah: number }[];
  orderBatalTerbayar: BarisKeuangan[];
  /** Perkiraan top-up = (saldo akhir + bayar) − saldo awal rentang. */
  perkiraanTopup: number | null;
};

// ---------- util ----------

/** "Rp 19.200" / "Rp. 19.200" / "19200" → 19200. */
function parseRpNomor(s: string): number {
  const n = Number(String(s).replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** "Rp19.200" / 19200 → "Rp19.200". */
export function fmtRp(n: number): string {
  return "Rp" + Math.round(n).toLocaleString("id-ID");
}

/** "YYYY-MM-DD HH:MM:SS" (UTC, format API Lazada) → epoch ms. */
function lazadaTimeMs(s: string): number {
  const iso = s.includes("T") ? s : s.replace(" ", "T") + "Z";
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/** Epoch ms → "DD/MM HH:MM" WIB. */
export function wibDariMs(ms: number): string {
  if (!ms) return "–";
  const w = new Date(ms + 7 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(w.getUTCDate())}/${p(w.getUTCMonth() + 1)} ${p(w.getUTCHours())}:${p(w.getUTCMinutes())}`;
}

// ---------- parse halaman riwayat Aneka ----------

/** Parse satu halaman /payment-history: saldo (dari header) + baris
 *  pembayaran (kode ORDER, payment_id, total, status, resi, waktu).
 *  Fungsi murni — bisa diuji dengan dump HTML tersimpan. */
export function parseAnekaHistoryHtml(html: string): {
  saldo: number;
  rows: AnekaPaymentRow[];
} {
  const mSaldo =
    />Saldo<\/span>\s*<span style="[^"]*white-space:nowrap[^"]*">\s*Rp[.\s]*([\d.]+)\s*<\/span>/.exec(
      html,
    );
  const saldo = mSaldo ? parseRpNomor(mSaldo[1]) : 0;

  const rows: AnekaPaymentRow[] = [];
  const blok = html.split('<div class="px-4 py-4 hover:bg-gray-50">').slice(1);
  for (const b of blok) {
    const pid = /payment_id=(\d+)/.exec(b)?.[1] ?? "";
    if (!pid) continue;
    const kode = /ORDER-([A-Z0-9-]+)/.exec(b)?.[1] ?? "";
    const total = parseRpNomor(/Rp[.\s]*([\d.]+)/.exec(b)?.[1] ?? "0");
    const status =
      /(Success|Pending|Failed|Refund[a-zA-Z]*|Cancel[a-zA-Z]*)/i.exec(b)?.[1] ??
      "?";
    // Resi tampil dua kali (tampilan desktop & seluler) — ambil versi
    // desktop dulu, fallback versi seluler.
    let resi =
      /<span class="block font-medium text-gray-800">([^<]+)<\/span>/.exec(
        b,
      )?.[1]?.trim() ?? "";
    if (!resi) {
      resi =
        /Nomor Resi:<\/span>[\s\S]{0,220}?<span class="block">([^<]+)<\/span>/.exec(
          b,
        )?.[1]?.trim() ?? "";
    }
    const tsDetik = /ORDER-\d+-(\d{6,})/.exec(b)?.[1] ?? "";
    rows.push({
      paymentId: pid,
      orderCode: kode ? `ORDER-${kode}` : "",
      total,
      status,
      resi,
      tanggalMs: tsDetik ? Number(tsDetik) * 1000 : 0,
    });
  }
  return { saldo, rows };
}

// ---------- snapshot Aneka (cache + scrape) ----------

/** Lanjutkan jejak saldo: ambil dari cache, saring 48 jam, tambah sampel
 *  baru. Jejak ini dasar perkiraan top-up (saldo naik tanpa ada pembayaran
 *  keluar = kemungkinan isi ulang). */
function lanjutRiwayatSaldo(
  cached: AnekaFinanceCacheRow | null,
  saldo: number,
): { t: number; saldo: number }[] {
  let lama: { t: number; saldo: number }[] = [];
  if (cached) {
    try {
      const s = JSON.parse(cached.data) as AnekaSnapshot;
      if (Array.isArray(s.riwayatSaldo)) lama = s.riwayatSaldo;
    } catch {
      /* cache korup → mulai baru */
    }
  }
  const now = Date.now();
  const saring = lama.filter(
    (x) =>
      typeof x.t === "number" &&
      typeof x.saldo === "number" &&
      now - x.t < 48 * 3600 * 1000,
  );
  saring.push({ t: now, saldo });
  return saring;
}

/** Snapshot riwayat + saldo Aneka. Bila cache masih segar (<15 menit)
 *  dipakai langsung; bila basi (atau force) di-scrape ulang: login →
 *  halaman-halaman riwayat → parse. Galat apa pun → fallback cache basi
 *  dengan keterangan; tanpa cache → ok:false. */
export async function ambilSnapshotAneka(
  force: boolean,
): Promise<{
  ok: boolean;
  snapshot: AnekaSnapshot | null;
  segar: boolean;
  detail: string;
}> {
  const cached = await getAnekaFinanceCache(CACHE_KEY);
  const cacheValid =
    !!cached &&
    !!cached.fetched_at &&
    Date.now() - Date.parse(cached.fetched_at) < CACHE_TTL_MS;
  if (cacheValid && !force) {
    try {
      return {
        ok: true,
        snapshot: JSON.parse(cached.data) as AnekaSnapshot,
        segar: true,
        detail: "",
      };
    } catch {
      /* cache korup → lanjut scrape */
    }
  }

  const login = await anekaLogin();
  if (!login.ok) {
    if (cached) {
      try {
        return {
          ok: true,
          snapshot: JSON.parse(cached.data) as AnekaSnapshot,
          segar: false,
          detail: `Data Aneka basi: ${login.detail}`,
        };
      } catch {
        /* abaikan */
      }
    }
    return { ok: false, snapshot: null, segar: false, detail: login.detail };
  }

  const s = login.session;
  const semua = new Map<string, AnekaPaymentRow>();
  let saldo = 0;
  try {
    for (let page = 1; page <= MAKS_HALAMAN; page++) {
      const res = await fetchRetry(
        s.cookie,
        `${BASE}/payment-history?page=${page}`,
        { redirect: "manual" },
      );
      const html = await res.text();
      const p = parseAnekaHistoryHtml(html);
      if (page === 1) saldo = p.saldo;
      for (const r of p.rows) if (!semua.has(r.paymentId)) semua.set(r.paymentId, r);
      if (res.status === 404 || p.rows.length === 0) break;
    }
  } catch (e) {
    if (cached) {
      try {
        return {
          ok: true,
          snapshot: JSON.parse(cached.data) as AnekaSnapshot,
          segar: false,
          detail: `Data Aneka basi: ${e instanceof Error ? e.message : "galat jaringan"}`,
        };
      } catch {
        /* abaikan */
      }
    }
    return {
      ok: false,
      snapshot: null,
      segar: false,
      detail: e instanceof Error ? e.message : "galat jaringan Aneka",
    };
  }

  const snapshot: AnekaSnapshot = {
    saldo,
    fetchedAt: new Date().toISOString(),
    rows: [...semua.values()].sort((a, b) => b.tanggalMs - a.tanggalMs),
    riwayatSaldo: lanjutRiwayatSaldo(cached, saldo),
  };
  await setAnekaFinanceCache(CACHE_KEY, JSON.stringify(snapshot), snapshot.fetchedAt);
  return { ok: true, snapshot, segar: true, detail: "" };
}

// ---------- sisi TikTok ----------

/** Omset satu pesanan: jumlah (harga jual × qty) semua baris item.
 *  Ongkir tidak ikut (uang kurir, bukan pendapatan). */
function omsetDetail(d: TiktokOrderDetail): number {
  let total = 0;
  for (const it of d.line_items) {
    // Omset = harga yang dibayar pembeli + potongan yang ditanggung PLATFORM.
    // Voucher platform (mis. dari live/big sale) disubsidi TikTok dan
    // dikembalikan ke penjual saat settlement — hanya seller_discount yang
    // benar-benar memotong pendapatan. Tanpa ini, order bervoucher tampak rugi
    // padahal tidak (kasus Alfa Tox: sale 34.500 + platform 15.500 = 50.000).
    const harga =
      parseRpNomor(it.sale_price) + parseRpNomor(it.platform_discount) ||
      parseRpNomor(it.original_price);
    total += harga * resolveLineQty(it);
  }
  return total;
}

/** Ringkasan ala TiktokOrderSummary dari detail (qty asli — ringkasan
 *  pencarian toko ini selalu mengembalikan sku_count 0). */
function summaryDariDetail(d: TiktokOrderDetail): TiktokOrderSummary {
  return {
    order_id: d.id,
    order_status: d.status,
    create_time: d.create_time,
    update_time: d.update_time,
    items: d.line_items.map((l) => ({
      product_id: l.product_id,
      sku_id: l.sku_id,
      product_name: l.product_name,
      sku_count: resolveLineQty(l),
      sku_name: l.sku_name,
      seller_sku: l.seller_sku,
    })),
  };
}

/** Perkiraan modal Aneka satu pesanan dari katalog (untuk order yang belum
 *  punya baris eksekusi). −1 = tidak bisa diperkirakan (belum dipetakan). */
async function estimasiModalAneka(d: TiktokOrderDetail): Promise<number> {
  const cek = await checkAnekaExecutable(summaryDariDetail(d));
  if (!cek.ok) return -1;
  return cek.items.reduce((a, it) => a + it.subtotal, 0);
}

// ---------- perakitan data keuangan ----------

/** Data lengkap dashboard keuangan untuk rentang [dariMs, sampaiMs)
 *  (epoch ms UTC). Order TikTok difilter waktu pembuatan; pembayaran Aneka
 *  difilter stempel kode pembayarannya. */
export async function ambilDataKeuangan(
  dariMs: number,
  sampaiMs: number,
  opts: { refreshAneka?: boolean } = {},
): Promise<DataKeuangan> {
  // 1) Snapshot Aneka (riwayat + saldo).
  const aneka = await ambilSnapshotAneka(opts.refreshAneka ?? false);
  const snapRows = aneka.snapshot?.rows ?? [];

  // 2) Order TikTok rentang (semua toko terotorisasi).
  const shopOrders = await pullTiktokShopOrders({
    createTimeGe: Math.floor(dariMs / 1000),
    createTimeLt: Math.floor(sampaiMs / 1000),
    pageSize: 50,
  });

  // 2b) Paket Blibli — filter statusFPDateRange TIDAK dipatuhi API (teruji
  //     langsung: rentang apa pun mengembalikan semua paket), jadi semua
  //     halaman ditarik lalu disaring per createdDate item di sini. Maks
  //     10 halaman (500 paket) — cukup untuk skala toko saat ini.
  const blibliPackages: BlibliOrderPackage[] = [];
  for (let page = 0; page < 10; page++) {
    const st = (await pullBlibliOrders({ paging: { page, size: 50 } }))[0];
    if (!st?.ok) break;
    const pkg = (st.packages ?? []).filter((p) =>
      p.orderItems.some((i) => {
        const t = i.createdDate || i.order.date || 0;
        return t >= dariMs && t < sampaiMs;
      }),
    );
    blibliPackages.push(...pkg);
    if ((st.packages ?? []).length < 50) break;
  }

  // 2c) Pesanan Lazada — pola yang sama: tarik semua halaman (maks 10 ×
  //     100) dengan created_after sebagai patokan lalu saring per
  //     created_at di sini.
  const lazadaOrders: LazadaOrderRow[] = [];
  for (let off = 0; off < 1000; off += 100) {
    const so = (
      await pullLazadaOrders({
        created_after: new Date(dariMs).toISOString(),
        sort_by: "created_at",
        sort_direction: "ASC",
        offset: off,
        limit: 100,
      })
    )[0];
    if (!so?.ok) break;
    lazadaOrders.push(
      ...(so.orders ?? []).filter((o) => {
        const t = lazadaTimeMs(o.created_at);
        return t >= dariMs && t < sampaiMs;
      }),
    );
    if ((so.orders ?? []).length < 100) break;
  }

  // 3) Detail tiap order (harga jual + qty asli + resi). ID dikumpulkan
  //    per toko supaya satu panggilan detail melayani banyak order.
  const detailByOrder = new Map<string, TiktokOrderDetail>();
  const toko = new Map<string, TiktokShopToken>();
  for (const t of await listTiktokShopTokens()) toko.set(t.shop_id, t);
  for (const so of shopOrders) {
    if (!so.ok || !so.orders?.length) continue;
    const tok = toko.get(so.shop_id);
    if (!tok) continue;
    const prep = await prepareShop(tok);
    if (!prep.ok) continue;
    for (let i = 0; i < so.orders.length; i += 50) {
      const chunk = so.orders.slice(i, i + 50).map((o) => o.order_id);
      const d = await getTiktokOrderDetail(
        { cipher: prep.cipher, access_token: prep.access_token },
        chunk,
      );
      if (d.ok) for (const o of d.orders) detailByOrder.set(o.id, o);
    }
  }

  // 4) Baris eksekusi dari DB (status + payload berisi resi & modal).
  const execs = await listTiktokOrderExecs();
  const execByOrder = new Map<string, TiktokOrderExec>(
    execs.map((e) => [e.order_id, e]),
  );
  const blibliExecs = await listBlibliOrderExecs();
  const execByPkg = new Map<string, BlibliOrderExec>(
    blibliExecs.map((e) => [e.package_id, e]),
  );
  const lazadaExecs = await listLazadaOrderExecs();
  const execByLazada = new Map<string, LazadaOrderExec>(
    lazadaExecs.map((e) => [e.order_id, e]),
  );

  // 4b) Himpunan id pembayaran yang dibuat KTD Hub: kolom aneka_payment_id
  //     tiap baris eksekusi (TikTok + Blibli + Lazada) plus jejak id di log
  //     (percobaan lama yang id-nya tertimpa di kolom tetap terdeteksi dari
  //     baris log). Pembayaran di luar himpunan ini = orderan manual (dibuat
  //     langsung di Aneka).
  const hubPaymentIds = new Set<string>();
  const serapPaymentIds = (rows: { aneka_payment_id: string; log: string }[]) => {
    for (const e of rows) {
      if (e.aneka_payment_id) hubPaymentIds.add(e.aneka_payment_id);
      const log = e.log ?? "";
      for (const m of log.matchAll(/payment(?:_id| lama)\s+(\d+)/g)) {
        hubPaymentIds.add(m[1]);
      }
      for (const m of log.matchAll(/ID pembayaran Aneka[^\d]*(\d+)/g)) {
        hubPaymentIds.add(m[1]);
      }
    }
  };
  serapPaymentIds(execs);
  serapPaymentIds(blibliExecs);
  serapPaymentIds(lazadaExecs);

  /** Pembayaran Aneka Success yang resinya cocok dengan satu resi pasar. */
  const biayaAnekaUntuk = (resi: string) => {
    const bayar = snapRows.filter(
      (r) => r.resi && resi && r.resi.trim() === resi.trim(),
    );
    const bayarSukses = bayar.filter((r) => r.status === "Success");
    return {
      bayarAneka: bayarSukses.reduce((a, r) => a + r.total, 0),
      bayarIds: bayarSukses.map((r) => r.paymentId),
      bayarManualAneka: bayarSukses
        .filter((r) => !hubPaymentIds.has(r.paymentId))
        .reduce((a, r) => a + r.total, 0),
    };
  };

  /** Laba satu baris: biaya nyata (bayar) bila ada, selain itu perkiraan
   *  modal + packing, selain itu omset penuh (proyeksi). */
  const labaUntuk = (
    omsetBaris: number,
    bayarAnekaBaris: number,
    estimasiModalBaris: number,
    estimasiPackingBaris: number,
  ) => {
    if (bayarAnekaBaris > 0) {
      return { laba: omsetBaris - bayarAnekaBaris, labaRealisasi: true };
    }
    if (estimasiModalBaris > 0) {
      return {
        laba: omsetBaris - estimasiModalBaris - estimasiPackingBaris,
        labaRealisasi: false,
      };
    }
    return { laba: omsetBaris, labaRealisasi: false };
  };

  // 5) Susun baris per order.
  const baris: BarisKeuangan[] = [];
  for (const so of shopOrders) {
    if (!so.ok || !so.orders) continue;
    for (const o of so.orders) {
      const d = detailByOrder.get(o.order_id);
      const exec = execByOrder.get(o.order_id);
      let payload: AnekaExecPayload | null = null;
      try {
        payload = exec?.payload ? (JSON.parse(exec.payload) as AnekaExecPayload) : null;
      } catch {
        payload = null;
      }
      const resi = payload?.tracking_number || d?.tracking_number || "";
      const produk = d
        ? d.line_items
            .map((l) => `${l.product_name}${l.sku_name ? ` (${l.sku_name})` : ""}`)
            .join(", ")
        : o.items.map((i) => i.product_name).join(", ");
      const qty = d
        ? d.line_items.reduce((a, l) => a + resolveLineQty(l), 0)
        : o.items.reduce((a, i) => a + i.sku_count, 0);
      const omset = d ? omsetDetail(d) : 0;

      // Pembayaran Aneka yang resinya cocok dengan resi order ini.
      const { bayarAneka, bayarIds, bayarManualAneka } = biayaAnekaUntuk(resi);

      let estimasiModal = 0;
      let estimasiPacking = 0;
      if (payload) {
        estimasiModal = payload.total_modal ?? 0;
      } else if (d) {
        estimasiModal = await estimasiModalAneka(d);
      }
      const akanDieksekusi =
        exec && ["menunggu", "berjalan", "gagal", "selesai"].includes(exec.status);
      estimasiPacking = akanDieksekusi ? ONGKOS_PACKING : 0;

      const { laba, labaRealisasi } = labaUntuk(
        omset,
        bayarAneka,
        estimasiModal,
        estimasiPacking,
      );

      baris.push({
        orderId: o.order_id,
        pasar: "TikTok",
        waktuMs: o.create_time * 1000,
        produk,
        qty,
        omset,
        statusOrder: o.order_status,
        statusExec: exec?.status ?? "",
        resi,
        bayarIds,
        bayarAneka,
        bayarManualAneka,
        estimasiModal,
        estimasiPacking,
        laba,
        labaRealisasi,
      });
    }
  }

  // 5b) Baris per paket Blibli (kunci package_id — satu paket = satu label
  //     = satu slot resi Aneka). Omset = finalPrice × qty per item.
  for (const p of blibliPackages) {
    const exec = execByPkg.get(p.packageId);
    let payload: BlibliExecPayload | null = null;
    try {
      payload = exec?.payload
        ? (JSON.parse(exec.payload) as BlibliExecPayload)
        : null;
    } catch {
      payload = null;
    }
    const resi =
      payload?.awb_number ||
      p.orderItems.map((i) => i.logistic?.awbNumber ?? "").find(Boolean) ||
      "";
    const produk = p.orderItems.map((i) => i.product.itemName).join(", ");
    const qty = p.orderItems.reduce(
      (a, i) => a + (i.order.quantity || 0),
      0,
    );
    const omset = p.orderItems.reduce(
      (a, i) =>
        a +
        (i.product.finalPrice || i.product.price || 0) *
          (i.order.quantity || 0),
      0,
    );
    const statusOrder = Array.from(
      new Set(p.orderItems.map((i) => i.order.itemStatus)),
    ).join(", ");
    const waktuMs = p.orderItems.reduce(
      (a, i) => Math.min(a, i.createdDate || i.order.date || a),
      Number.MAX_SAFE_INTEGER,
    );

    const { bayarAneka, bayarIds, bayarManualAneka } = biayaAnekaUntuk(resi);

    const estimasiModal = payload?.total_modal ?? 0;
    const akanDieksekusi =
      exec && ["menunggu", "berjalan", "gagal", "selesai"].includes(exec.status);
    const estimasiPacking = akanDieksekusi ? ONGKOS_PACKING : 0;

    const { laba, labaRealisasi } = labaUntuk(
      omset,
      bayarAneka,
      estimasiModal,
      estimasiPacking,
    );

    baris.push({
      orderId: p.packageId,
      pasar: "Blibli",
      waktuMs: waktuMs === Number.MAX_SAFE_INTEGER ? 0 : waktuMs,
      produk,
      qty,
      omset,
      statusOrder,
      statusExec: exec?.status ?? "",
      resi,
      bayarIds,
      bayarAneka,
      bayarManualAneka,
      estimasiModal,
      estimasiPacking,
      laba,
      labaRealisasi,
    });
  }

  // 5c) Baris per pesanan Lazada (kunci order_id — satu pesanan = satu
  //     label = satu slot resi Aneka). Omset = price tingkat pesanan
  //     (nilai barang — ongkir tidak ikut). Nama produk dari payload
  //     eksekusi; pesanan tanpa baris eksekusi diambil dari
  //     /order/items/get dengan pembatas panggilan (kuota harian Lazada).
  let itemCalls = 0;
  const ITEM_CALLS_MAX = 20;
  for (const o of lazadaOrders) {
    const exec = execByLazada.get(o.order_id);
    let payload: LazadaExecPayload | null = null;
    try {
      payload = exec?.payload
        ? (JSON.parse(exec.payload) as LazadaExecPayload)
        : null;
    } catch {
      payload = null;
    }
    let produk = (payload?.items ?? [])
      .map((it) =>
        it.variant_name ? `${it.item_name} (${it.variant_name})` : it.item_name,
      )
      .join(", ");
    if (!produk && itemCalls < ITEM_CALLS_MAX) {
      itemCalls++;
      const it = await getLazadaOrderItems(o.order_id);
      if (it.ok) {
        const nama = new Map<string, number>();
        for (const row of it.data) {
          const k = row.variation ? `${row.name} (${row.variation})` : row.name;
          nama.set(k, (nama.get(k) ?? 0) + 1);
        }
        produk = [...nama.entries()]
          .map(([k, n]) => (n > 1 ? `${k} ×${n}` : k))
          .join(", ");
      }
    }
    const resi = payload?.tracking_number ?? "";
    const statusOrder = (o.statuses ?? []).join(", ");
    const waktuMs = lazadaTimeMs(o.created_at);

    const { bayarAneka, bayarIds, bayarManualAneka } = biayaAnekaUntuk(resi);

    const estimasiModal = payload?.total_modal ?? 0;
    const akanDieksekusi =
      exec && ["menunggu", "berjalan", "gagal", "selesai"].includes(exec.status);
    const estimasiPacking = akanDieksekusi ? ONGKOS_PACKING : 0;

    const { laba, labaRealisasi } = labaUntuk(
      Number(o.price ?? 0) || 0,
      bayarAneka,
      estimasiModal,
      estimasiPacking,
    );

    baris.push({
      orderId: o.order_id,
      pasar: "Lazada",
      waktuMs,
      produk,
      qty: o.items_count || 0,
      omset: Number(o.price ?? 0) || 0,
      statusOrder,
      statusExec: exec?.status ?? "",
      resi,
      bayarIds,
      bayarAneka,
      bayarManualAneka,
      estimasiModal,
      estimasiPacking,
      laba,
      labaRealisasi,
    });
  }

  // 6) Ringkasan.
  const dibatalkanStatus = new Set(["UNPAID", "CANCELLED"]);
  /** Batal = status batal TikTok, itemStatus X (Blibli — bisa campur
   *  "X, D"), atau status masalah Lazada (canceled/returned/failed/lost). */
  const isBatal = (b: BarisKeuangan) =>
    b.pasar === "Blibli"
      ? b.statusOrder.split(",").some((s) => s.trim() === "X")
      : b.pasar === "Lazada"
        ? b.statusOrder
            .split(",")
            .some((s) =>
              ["canceled", "returned", "failed", "lost"].includes(s.trim()),
            )
        : dibatalkanStatus.has(b.statusOrder);
  const barisBeromset = baris.filter((b) => !isBatal(b));
  const omset = barisBeromset.reduce((a, b) => a + b.omset, 0);

  const dalamRentang = (r: AnekaPaymentRow) =>
    r.tanggalMs === 0 ||
    (r.tanggalMs >= dariMs && r.tanggalMs < sampaiMs);
  const pembayaran = snapRows.filter(dalamRentang);
  const bayarSukses = pembayaran.filter((r) => r.status === "Success");
  const bayarAneka = bayarSukses.reduce((a, r) => a + r.total, 0);

  const resiOrderRentang = new Set(baris.map((b) => b.resi.trim()).filter(Boolean));
  // Pembayaran via Hub yang resinya tidak cocok dengan order marketplace
  // pada rentang ini (mis. order dibuat hari sebelumnya) — pembayaran manual
  // ditampilkan terpisah sebagai "Orderan Manual".
  const bayarTanpaOrder = bayarSukses.filter(
    (r) =>
      hubPaymentIds.has(r.paymentId) &&
      (!r.resi || !resiOrderRentang.has(r.resi.trim())),
  );

  // Orderan manual: pembayaran Success di luar Hub, dipasangkan dengan
  // order marketplace (TikTok/Blibli) bila resinya cocok — biasanya order
  // dari marketplace lain atau pesanan WhatsApp.
  const orderIdByResi = new Map<string, string>();
  for (const b of baris) {
    if (b.resi && !orderIdByResi.has(b.resi.trim()))
      orderIdByResi.set(b.resi.trim(), b.orderId);
  }
  const bayarManual = bayarSukses
    .filter((r) => !hubPaymentIds.has(r.paymentId))
    .map((r) => ({
      row: r,
      orderId: r.resi ? (orderIdByResi.get(r.resi.trim()) ?? "") : "",
    }));
  const pembayaranManualIds = pembayaran
    .filter((r) => !hubPaymentIds.has(r.paymentId))
    .map((r) => r.paymentId);

  const hitungResi = new Map<string, number>();
  for (const r of bayarSukses) {
    if (!r.resi) continue;
    hitungResi.set(r.resi.trim(), (hitungResi.get(r.resi.trim()) ?? 0) + 1);
  }
  const resiDobel = [...hitungResi.entries()]
    .filter(([, n]) => n >= 2)
    .map(([resi, jumlah]) => ({ resi, jumlah }));

  const orderBatalTerbayar = baris.filter(
    (b) => isBatal(b) && b.bayarAneka > 0,
  );

  // 7) Perkiraan top-up: saldo di awal rentang vs (saldo akhir + bayar).
  const riwayat = aneka.snapshot?.riwayatSaldo ?? [];
  const sampelAwal = riwayat
    .filter((x) => x.t >= dariMs - 6 * 3600 * 1000 && x.t < sampaiMs)
    .sort((a, b) => a.t - b.t)[0];
  const sampelAkhir = riwayat.sort((a, b) => b.t - a.t)[0];
  let perkiraanTopup: number | null = null;
  if (sampelAwal && sampelAkhir && sampelAwal.t < sampelAkhir.t) {
    perkiraanTopup = sampelAkhir.saldo + bayarAneka - sampelAwal.saldo;
    if (perkiraanTopup < 0) perkiraanTopup = null;
  }

  return {
    dariMs,
    sampaiMs,
    omset,
    bayarAneka,
    labaKotor: omset - bayarAneka,
    saldo: aneka.snapshot?.saldo ?? 0,
    saldoWaktuMs: aneka.snapshot ? Date.parse(aneka.snapshot.fetchedAt) : 0,
    segar: aneka.segar,
    anekaError: aneka.detail,
    jumlahOrder: baris.length,
    jumlahBayar: bayarSukses.length,
    baris: baris.sort((a, b) => b.waktuMs - a.waktuMs),
    pembayaran,
    bayarTanpaOrder,
    bayarManual,
    pembayaranManualIds,
    resiDobel,
    orderBatalTerbayar,
    perkiraanTopup,
  };
}
