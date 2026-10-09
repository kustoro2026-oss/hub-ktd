// Dashboard Keuangan KTD Hub — merangkum uang masuk (omset TikTok Shop)
// dan uang keluar (pembayaran Aneka) untuk rentang tanggal, plus saldo
// wallet Aneka hasil scrape read-only yang di-cache di database.
//
// Sumber data:
// - Omset: API resmi TikTok (detail pesanan — harga jual per baris item).
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
  type AnekaFinanceCacheRow,
  type TiktokOrderExec,
  type TiktokShopToken,
} from "@/lib/db";
import { anekaLogin, fetchRetry } from "@/lib/aneka-checkout";
import { prepareShop, pullTiktokShopOrders } from "@/lib/tiktok-orders";
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
    const harga = parseRpNomor(it.sale_price) || parseRpNomor(it.original_price);
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

  // 4b) Himpunan id pembayaran yang dibuat KTD Hub: kolom aneka_payment_id
  //     tiap baris eksekusi plus jejak id di log (percobaan lama yang id-nya
  //     tertimpa di kolom tetap terdeteksi dari baris log). Pembayaran di
  //     luar himpunan ini = orderan manual (dibuat langsung di Aneka).
  const hubPaymentIds = new Set<string>();
  for (const e of execs) {
    if (e.aneka_payment_id) hubPaymentIds.add(e.aneka_payment_id);
    const log = e.log ?? "";
    for (const m of log.matchAll(/payment(?:_id| lama)\s+(\d+)/g)) {
      hubPaymentIds.add(m[1]);
    }
    for (const m of log.matchAll(/ID pembayaran Aneka[^\d]*(\d+)/g)) {
      hubPaymentIds.add(m[1]);
    }
  }

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
      const bayar = snapRows.filter(
        (r) => r.resi && resi && r.resi.trim() === resi.trim(),
      );
      const bayarSukses = bayar.filter((r) => r.status === "Success");
      const bayarAneka = bayarSukses.reduce((a, r) => a + r.total, 0);
      const bayarIds = bayarSukses.map((r) => r.paymentId);
      const bayarManualAneka = bayarSukses
        .filter((r) => !hubPaymentIds.has(r.paymentId))
        .reduce((a, r) => a + r.total, 0);

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

      let laba: number;
      let labaRealisasi = false;
      if (bayarAneka > 0) {
        laba = omset - bayarAneka;
        labaRealisasi = true;
      } else if (estimasiModal > 0) {
        laba = omset - estimasiModal - estimasiPacking;
      } else {
        laba = omset;
      }

      baris.push({
        orderId: o.order_id,
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

  // 6) Ringkasan.
  const dibatalkanStatus = new Set(["UNPAID", "CANCELLED"]);
  const barisBeromset = baris.filter(
    (b) => !dibatalkanStatus.has(b.statusOrder),
  );
  const omset = barisBeromset.reduce((a, b) => a + b.omset, 0);

  const dalamRentang = (r: AnekaPaymentRow) =>
    r.tanggalMs === 0 ||
    (r.tanggalMs >= dariMs && r.tanggalMs < sampaiMs);
  const pembayaran = snapRows.filter(dalamRentang);
  const bayarSukses = pembayaran.filter((r) => r.status === "Success");
  const bayarAneka = bayarSukses.reduce((a, r) => a + r.total, 0);

  const resiOrderRentang = new Set(baris.map((b) => b.resi.trim()).filter(Boolean));
  // Pembayaran via Hub yang resinya tidak cocok dengan order TikTok pada
  // rentang ini (mis. order dibuat hari sebelumnya) — pembayaran manual
  // ditampilkan terpisah sebagai "Orderan Manual".
  const bayarTanpaOrder = bayarSukses.filter(
    (r) =>
      hubPaymentIds.has(r.paymentId) &&
      (!r.resi || !resiOrderRentang.has(r.resi.trim())),
  );

  // Orderan manual: pembayaran Success di luar Hub, dipasangkan dengan
  // order TikTok bila resinya cocok — biasanya order marketplace lain
  // atau pesanan WhatsApp.
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
    (b) => b.statusOrder === "CANCELLED" && b.bayarAneka > 0,
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
