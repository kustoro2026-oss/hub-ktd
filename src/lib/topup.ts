// Lapisan data & agregasi Top Up & Isi Saldo untuk dashboard KTD Hub.
//
// Sumber data order: tabel topup_orders di database bersama (ditulis toko,
// dibaca hub via src/lib/db.ts). Saldo Digiflazz & aksi aman TIDAK dihitung
// di sini — dipanggil lewat API toko (lihat src/app/api/topup/saldo dan
// src/app/api/topup/recheck).
//
// Semua agregasi dilakukan di JavaScript (bukan SQL GROUP BY per-hari) agar
// hasilnya identik di SQLite lokal dan Postgres produksi — bucketing tanggal
// berbeda sintaks di dua backend (strftime vs to_char).
import {
  listTopupOrders,
  type TopupOrderRow,
} from "@/lib/db";

// ---------- waktu (DB = UTC string "YYYY-MM-DD HH:MM:SS"; tampilan = WIB) ----------

const p = (n: number) => String(n).padStart(2, "0");

/** String UTC "YYYY-MM-DD HH:MM:SS" → epoch ms. Kembalikan 0 bila tidak valid. */
export function parseUtcMs(s: string): number {
  if (!s) return 0;
  const m = s.replace(" ", "T");
  const t = Date.parse(m.endsWith("Z") ? m : `${m}Z`);
  return Number.isFinite(t) ? t : 0;
}

/** Epoch ms → string UTC "YYYY-MM-DD HH:MM:SS" (format kolom DB). */
export function utcStrFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

/** Awal hari WIB (epoch ms UTC) dari epoch ms mana pun. */
export function startOfWibDayMs(ms: number): number {
  const w = new Date(ms + 7 * 3600 * 1000);
  return (
    Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate()) -
    7 * 3600 * 1000
  );
}

/** Kunci hari WIB "YYYY-MM-DD" dari epoch ms. */
export function wibDayKey(ms: number): string {
  const w = new Date(ms + 7 * 3600 * 1000);
  return `${w.getUTCFullYear()}-${p(w.getUTCMonth() + 1)}-${p(w.getUTCDate())}`;
}

/** Label hari WIB "DD/MM" dari epoch ms. */
export function wibDayLabel(ms: number): string {
  const w = new Date(ms + 7 * 3600 * 1000);
  return `${p(w.getUTCDate())}/${p(w.getUTCMonth() + 1)}`;
}

// ---------- label & warna status (dipakai semua halaman) ----------

export const LABEL_BAYAR: Record<string, string> = {
  pending: "Menunggu bayar",
  waiting_payment: "Menunggu bayar",
  paid: "Lunas",
  expired: "Kedaluwarsa",
  failed: "Gagal bayar",
};

export const CLS_BAYAR: Record<string, string> = {
  paid: "bg-emerald-100 text-emerald-800",
  expired: "bg-slate-100 text-slate-600",
  failed: "bg-rose-100 text-rose-800",
  pending: "bg-amber-100 text-amber-800",
  waiting_payment: "bg-amber-100 text-amber-800",
};

export const LABEL_TOPUP: Record<string, string> = {
  waiting_payment: "Menunggu bayar",
  pending: "Diproses",
  success: "Sukses",
  failed: "Gagal",
};

export const CLS_TOPUP: Record<string, string> = {
  success: "bg-emerald-100 text-emerald-800",
  pending: "bg-amber-100 text-amber-800",
  waiting_payment: "bg-slate-100 text-slate-600",
  failed: "bg-rose-100 text-rose-800",
};

// ---------- env & konfigurasi ----------

/** URL toko tempat API top-up dipanggil (default produksi). */
export function topupStoreUrl(): string {
  return (process.env.TOPUP_STORE_URL ?? "https://toko.kustoro2026.com").replace(
    /\/+$/,
    "",
  );
}

/** Ambang saldo rendah (Rp) — sama dengan TOPUP_LOW_BALANCE_THRESHOLD toko. */
export function topupThreshold(): number {
  const t = Number(process.env.TOPUP_LOW_BALANCE_THRESHOLD);
  return Number.isFinite(t) && t > 0 ? t : 100000;
}

/** Order dengan pembayaran lunas tapi eksekusi belum kelar lebih dari
 *  durasi ini (menit) dianggap "bermasalah butuh perhatian". */
export const PENDING_LAMA_MENIT = 30;

// ---------- jenis masalah ----------

export type JenisMasalah =
  | "gagal"
  | "saldo_kurang"
  | "nominal_tidak_cocok"
  | "pending_lama"
  | "bayar_gagal"
  | "expired";

export const INFO_MASALAH: Record<
  JenisMasalah,
  { label: string; cls: string }
> = {
  gagal: {
    label: "Eksekusi gagal",
    cls: "border-rose-200 bg-rose-50 text-rose-900",
  },
  saldo_kurang: {
    label: "Saldo Digiflazz kurang",
    cls: "border-amber-200 bg-amber-50 text-amber-900",
  },
  nominal_tidak_cocok: {
    label: "Nominal callback tidak cocok",
    cls: "border-rose-200 bg-rose-50 text-rose-900",
  },
  pending_lama: {
    label: `Menunggu eksekusi > ${PENDING_LAMA_MENIT} menit`,
    cls: "border-amber-200 bg-amber-50 text-amber-900",
  },
  bayar_gagal: {
    label: "Pembayaran gagal/dibatalkan",
    cls: "border-slate-200 bg-slate-50 text-slate-700",
  },
  expired: {
    label: "Kedaluwarsa belum dibayar",
    cls: "border-slate-200 bg-slate-50 text-slate-700",
  },
};

/** Klasifikasi satu order ke satu jenis masalah (prioritas tertinggi dulu).
 *  Kembalikan null bila order sehat. */
export function klasifikasiMasalah(
  o: TopupOrderRow,
  nowMs: number,
): JenisMasalah | null {
  if (o.topup_status === "failed") {
    const e = o.error_message.toLowerCase();
    if (/saldo|kurang|deposit|balance/.test(e)) return "saldo_kurang";
    if (/tidak sama|mismatch|nominal/.test(e)) return "nominal_tidak_cocok";
    return "gagal";
  }
  if (
    o.payment_status === "paid" &&
    (o.topup_status === "pending" || o.topup_status === "waiting_payment")
  ) {
    const paidMs = parseUtcMs(o.paid_at);
    if (paidMs && nowMs - paidMs > PENDING_LAMA_MENIT * 60 * 1000) {
      return "pending_lama";
    }
  }
  if (o.payment_status === "failed") return "bayar_gagal";
  if (o.payment_status === "expired") return "expired";
  return null;
}

// ---------- agregasi ----------

const HARI_MS = 86400000;

/** Ringkasan 7 hari WIB terakhir + hari ini: kartu utama halaman Ringkasan. */
export async function ambilTopupRingkasan() {
  const nowMs = Date.now();
  const awalHariIni = startOfWibDayMs(nowMs);
  const dari = utcStrFromMs(awalHariIni - 6 * HARI_MS);
  const rows = await listTopupOrders({ dari, limit: 5000 });

  let jumlah = 0;
  let paid = 0;
  let success = 0;
  let failed = 0;
  let omset = 0;
  let modal = 0;
  let orderHariIni = 0;
  const pendingBermasalah: TopupOrderRow[] = [];
  const gagalList: TopupOrderRow[] = [];
  const harianMap = new Map<string, { jumlah: number; omset: number }>();

  for (const o of rows) {
    jumlah += 1;
    const createdMs = parseUtcMs(o.created_at);
    if (createdMs >= awalHariIni) orderHariIni += 1;
    const key = wibDayKey(createdMs);
    const h = harianMap.get(key) ?? { jumlah: 0, omset: 0 };
    h.jumlah += 1;
    harianMap.set(key, h);
    if (o.payment_status === "paid") {
      paid += 1;
      omset += o.amount;
      modal += o.cost;
      h.omset += o.amount;
    }
    if (o.topup_status === "success") success += 1;
    if (o.topup_status === "failed") {
      failed += 1;
      gagalList.push(o);
    }
    const jenis = klasifikasiMasalah(o, nowMs);
    if (jenis === "pending_lama") pendingBermasalah.push(o);
  }

  // Deret 7 hari berurutan (WIB), hari ini paling kanan.
  const harian: { label: string; jumlah: number; omset: number }[] = [];
  let maxOmset = 0;
  for (let i = 6; i >= 0; i--) {
    const ms = awalHariIni - i * HARI_MS;
    const key = wibDayKey(ms);
    const h = harianMap.get(key) ?? { jumlah: 0, omset: 0 };
    maxOmset = Math.max(maxOmset, h.omset);
    harian.push({ label: wibDayLabel(ms), jumlah: h.jumlah, omset: h.omset });
  }

  return {
    jumlah,
    orderHariIni,
    paid,
    success,
    failed,
    omset,
    modal,
    laba: omset - modal,
    suksesRate: paid > 0 ? Math.round((success / paid) * 100) : null,
    pendingBermasalah,
    gagalList,
    harian,
    maxOmset,
    awalHariIni,
  };
}

/** Agregat per SKU: volume, omset, modal, laba, margin — halaman Katalog. */
export async function ambilTopupKatalog() {
  const rows = await listTopupOrders({ limit: 5000 });
  const map = new Map<
    string,
    {
      sku: string;
      produk: string;
      jumlah: number;
      terjual: number;
      omset: number;
      modal: number;
      marginAneh: boolean;
    }
  >();

  for (const o of rows) {
    const key = o.sku || "(tanpa SKU)";
    const g =
      map.get(key) ?? {
        sku: key,
        produk: o.product_name || key,
        jumlah: 0,
        terjual: 0,
        omset: 0,
        modal: 0,
        marginAneh: false,
      };
    g.jumlah += 1;
    if (o.product_name && g.produk === key) g.produk = o.product_name;
    if (o.payment_status === "paid") {
      g.omset += o.amount;
      g.modal += o.cost;
      if (o.amount < o.cost) g.marginAneh = true;
    }
    if (o.topup_status === "success") g.terjual += 1;
    map.set(key, g);
  }

  const list = [...map.values()]
    .map((g) => {
      const laba = g.omset - g.modal;
      const marginPct = g.omset > 0 ? Math.round((laba / g.omset) * 1000) / 10 : null;
      return { ...g, laba, marginPct };
    })
    .sort((a, b) => b.laba - a.laba || b.omset - a.omset);

  return { list };
}

/** Daftar order bermasalah dikelompokkan per jenis — halaman Log Masalah. */
export async function ambilTopupMasalah(dariMs?: number) {
  const nowMs = Date.now();
  const dari = utcStrFromMs(dariMs ?? nowMs - 7 * HARI_MS);
  const rows = await listTopupOrders({ dari, limit: 3000 });

  const groups = new Map<JenisMasalah, TopupOrderRow[]>();
  for (const o of rows) {
    const jenis = klasifikasiMasalah(o, nowMs);
    if (!jenis) continue;
    const g = groups.get(jenis) ?? [];
    g.push(o);
    groups.set(jenis, g);
  }

  return {
    groups: [...groups.entries()]
      .map(([jenis, items]) => ({ jenis, ...INFO_MASALAH[jenis], items }))
      .sort(
        (a, b) =>
          (a.jenis === "gagal" || a.jenis === "nominal_tidak_cocok" ? 0 : 1) -
          (b.jenis === "gagal" || b.jenis === "nominal_tidak_cocok" ? 0 : 1),
      ),
    total: rows.length,
  };
}

/** Data halaman Saldo: riwayat transaksi + pengeluaran modal. */
export async function ambilTopupSaldoInfo() {
  const nowMs = Date.now();
  const awalHariIni = startOfWibDayMs(nowMs);
  const rows = await listTopupOrders({ limit: 5000 });

  const paidRows = rows.filter((o) => o.payment_status === "paid");
  const suksesRows = paidRows.filter((o) => o.topup_status === "success");

  const modalHariIni = paidRows
    .filter((o) => parseUtcMs(o.created_at) >= awalHariIni)
    .reduce((a, o) => a + o.cost, 0);
  const modal7Hari = paidRows
    .filter((o) => nowMs - parseUtcMs(o.created_at) <= 7 * HARI_MS)
    .reduce((a, o) => a + o.cost, 0);
  const modalSemua = paidRows.reduce((a, o) => a + o.cost, 0);

  // Rata-rata modal harian dari 7 hari terakhir (minimum 1 hari agar
  // tidak membagi nol).
  const rataHarian = Math.round(modal7Hari / 7);

  const riwayat = suksesRows
    .slice(0, 25)
    .map((o) => ({
      id: o.id,
      produk: o.product_name || o.sku,
      tujuan: o.customer_no,
      cost: o.cost,
      amount: o.amount,
      atMs: parseUtcMs(o.created_at),
      sn: o.digiflazz_sn,
    }));

  return { modalHariIni, modal7Hari, modalSemua, rataHarian, riwayat };
}
