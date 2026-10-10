// Daftar pesanan top-up — filter rentang tanggal (default 7 hari WIB),
// status pembayaran, status top-up, pencarian lintas kolom, pagination
// 50 baris. Data dibaca langsung dari tabel bersama topup_orders.
import Link from "next/link";
import { countTopupOrders, listTopupOrders } from "@/lib/db";
import { fmtRp } from "@/lib/keuangan";
import {
  CLS_BAYAR,
  CLS_TOPUP,
  LABEL_BAYAR,
  LABEL_TOPUP,
  parseUtcMs,
  startOfWibDayMs,
  utcStrFromMs,
} from "@/lib/topup";

export const dynamic = "force-dynamic";
export const metadata = { title: "Top Up · Pesanan" };

const HARI_MS = 86400000;
const PER_HALAMAN = 50;
const p = (n: number) => String(n).padStart(2, "0");

function tanggalWib(ms: number): string {
  if (!ms) return "–";
  const w = new Date(ms + 7 * 3600 * 1000);
  return `${p(w.getUTCDate())}/${p(w.getUTCMonth() + 1)} ${p(w.getUTCHours())}:${p(
    w.getUTCMinutes(),
  )}`;
}

function tanggalHariIniWib(): string {
  const w = new Date(Date.now() + 7 * 3600 * 1000);
  return `${w.getUTCFullYear()}-${p(w.getUTCMonth() + 1)}-${p(w.getUTCDate())}`;
}

function tanggalLabel(ms: number): string {
  const w = new Date(ms + 7 * 3600 * 1000);
  return `${p(w.getUTCDate())}/${p(w.getUTCMonth() + 1)}`;
}

/** Rentang default: 7 hari terakhir WIB (sampai = hari ini). */
function rentangDefault7HariWib(): { geMs: number; ltMs: number } {
  const awal = startOfWibDayMs(Date.now());
  return { geMs: awal - 6 * HARI_MS, ltMs: awal + HARI_MS };
}

const OPSI_BAYAR = [
  { v: "", label: "Semua status bayar" },
  { v: "paid", label: "Lunas" },
  { v: "pending", label: "Menunggu bayar" },
  { v: "expired", label: "Kedaluwarsa" },
  { v: "failed", label: "Gagal bayar" },
];

const OPSI_TOPUP = [
  { v: "", label: "Semua status top-up" },
  { v: "waiting_payment", label: "Menunggu bayar" },
  { v: "pending", label: "Diproses" },
  { v: "success", label: "Sukses" },
  { v: "failed", label: "Gagal" },
];

export default async function TopupPesananPage({
  searchParams,
}: {
  searchParams: Promise<{
    dari?: string;
    sampai?: string;
    statusBayar?: string;
    statusTopup?: string;
    q?: string;
    hal?: string;
  }>;
}) {
  const sp = await searchParams;
  const hariIni = tanggalHariIniWib();
  const d0 = /^\d{4}-\d{2}-\d{2}$/.test(sp.dari ?? "") ? sp.dari! : hariIni;
  const s0 = /^\d{4}-\d{2}-\d{2}$/.test(sp.sampai ?? "") ? sp.sampai! : hariIni;

  // Rentang default: 7 hari terakhir WIB (sampai = hari ini).
  const { geMs: geDefault, ltMs: ltDefault } = rentangDefault7HariWib();
  let geMs = geDefault;
  let ltMs = ltDefault;
  let pakaiDefault = false;
  if (!sp.dari && !sp.sampai) {
    pakaiDefault = true;
  } else {
    const parseHari = (s: string) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)!;
      return (
        Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - 7 * 3600 * 1000
      );
    };
    geMs = parseHari(d0);
    ltMs = parseHari(s0) + HARI_MS;
    if (ltMs <= geMs) {
      ltMs = geMs + HARI_MS;
    }
  }

  const dari = utcStrFromMs(geMs);
  const sampai = utcStrFromMs(ltMs);
  const statusBayar = OPSI_BAYAR.some((o) => o.v === sp.statusBayar)
    ? sp.statusBayar!
    : "";
  const statusTopup = OPSI_TOPUP.some((o) => o.v === sp.statusTopup)
    ? sp.statusTopup!
    : "";
  const q = (sp.q ?? "").trim().slice(0, 80);

  const filter = {
    dari,
    sampai,
    statusBayar: statusBayar || undefined,
    statusTopup: statusTopup || undefined,
    q: q || undefined,
  };

  const hal = Math.max(1, Number(sp.hal) || 1);
  const total = await countTopupOrders(filter);
  const rows = await listTopupOrders({
    ...filter,
    limit: PER_HALAMAN,
    offset: (hal - 1) * PER_HALAMAN,
  });
  const totalHalaman = Math.max(1, Math.ceil(total / PER_HALAMAN));

  const baseParams = new URLSearchParams();
  if (sp.dari) baseParams.set("dari", sp.dari);
  if (sp.sampai) baseParams.set("sampai", sp.sampai);
  if (statusBayar) baseParams.set("statusBayar", statusBayar);
  if (statusTopup) baseParams.set("statusTopup", statusTopup);
  if (q) baseParams.set("q", q);

  function hrefHal(h: number): string {
    const u = new URLSearchParams(baseParams);
    if (h > 1) u.set("hal", String(h));
    const s = u.toString();
    return `/topup/pesanan${s ? `?${s}` : ""}`;
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
          Top Up · Pesanan
        </p>
        <h1 className="text-xl font-bold text-slate-900">Pesanan Top Up</h1>
        <p className="text-sm text-slate-500">
          {tanggalLabel(geMs)} – {tanggalLabel(ltMs - 1)} · {total} pesanan
          ditemukan
        </p>
      </div>

      <form
        method="GET"
        action="/topup/pesanan"
        className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4"
      >
        <div>
          <label htmlFor="dari" className="block text-xs font-medium text-slate-500">
            Dari tanggal
          </label>
          <input
            id="dari"
            type="date"
            name="dari"
            defaultValue={pakaiDefault ? "" : d0}
            placeholder={hariIni}
            className="mt-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
          />
        </div>
        <div>
          <label htmlFor="sampai" className="block text-xs font-medium text-slate-500">
            Sampai tanggal
          </label>
          <input
            id="sampai"
            type="date"
            name="sampai"
            defaultValue={pakaiDefault ? "" : s0}
            placeholder={hariIni}
            className="mt-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
          />
        </div>
        <div>
          <label htmlFor="statusBayar" className="block text-xs font-medium text-slate-500">
            Pembayaran
          </label>
          <select
            id="statusBayar"
            name="statusBayar"
            defaultValue={statusBayar}
            className="mt-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
          >
            {OPSI_BAYAR.map((o) => (
              <option key={o.v} value={o.v}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="statusTopup" className="block text-xs font-medium text-slate-500">
            Status top-up
          </label>
          <select
            id="statusTopup"
            name="statusTopup"
            defaultValue={statusTopup}
            className="mt-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
          >
            {OPSI_TOPUP.map((o) => (
              <option key={o.v} value={o.v}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-52 flex-1">
          <label htmlFor="q" className="block text-xs font-medium text-slate-500">
            Cari (ID / ref / SKU / produk / tujuan / pembeli)
          </label>
          <input
            id="q"
            type="text"
            name="q"
            defaultValue={q}
            placeholder="mis. KTD-M2XQ9K atau 0812…"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-800"
        >
          Terapkan
        </button>
        <Link
          href="/topup/pesanan"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
        >
          Reset
        </Link>
      </form>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5">Waktu</th>
              <th className="px-4 py-2.5">Pesanan</th>
              <th className="px-4 py-2.5">Produk</th>
              <th className="px-4 py-2.5">Tujuan</th>
              <th className="px-4 py-2.5 text-right">Nominal</th>
              <th className="px-4 py-2.5">Pembayaran</th>
              <th className="px-4 py-2.5">Top-up</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  Tidak ada pesanan yang cocok dengan filter ini.
                </td>
              </tr>
            ) : (
              rows.map((o) => (
                <tr key={o.id} className="hover:bg-slate-50/60">
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">
                    {tanggalWib(parseUtcMs(o.created_at))}
                  </td>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/topup/pesanan/${o.id}`}
                      className="font-medium text-emerald-700 hover:underline"
                    >
                      {o.id}
                    </Link>
                    <p className="text-xs text-slate-500">{o.ref_id}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    <p className="text-slate-900">{o.product_name || "—"}</p>
                    <p className="text-xs text-slate-500">{o.sku}</p>
                  </td>
                  <td className="px-4 py-2.5 text-slate-700">{o.customer_no || "—"}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-slate-900">
                    {fmtRp(o.amount)}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        CLS_BAYAR[o.payment_status] ?? "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {LABEL_BAYAR[o.payment_status] ?? o.payment_status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        CLS_TOPUP[o.topup_status] ?? "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {LABEL_TOPUP[o.topup_status] ?? o.topup_status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalHalaman > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <p className="text-slate-500">
            Halaman {hal} dari {totalHalaman}
          </p>
          <div className="flex gap-2">
            {hal > 1 ? (
              <Link
                href={hrefHal(hal - 1)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
              >
                ← Sebelumnya
              </Link>
            ) : null}
            {hal < totalHalaman ? (
              <Link
                href={hrefHal(hal + 1)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
              >
                Berikutnya →
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
