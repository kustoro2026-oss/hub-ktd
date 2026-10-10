// Ringkasan Top Up & Isi Saldo — kartu saldo Digiflazz live, angka kunci 7
// hari WIB, panel masalah butuh perhatian, dan grafik batang omset 7 hari
// (CSS murni). Data order dari tabel bersama topup_orders; saldo lewat
// proxy aman /api/topup/saldo.
import Link from "next/link";
import { fmtRp } from "@/lib/keuangan";
import {
  ambilTopupRingkasan,
  parseUtcMs,
  topupThreshold,
} from "@/lib/topup";
import TopupSaldoCard from "@/components/topup-saldo-card";

export const dynamic = "force-dynamic";
export const metadata = { title: "Top Up · Ringkasan" };

const p = (n: number) => String(n).padStart(2, "0");

function jamWib(ms: number): string {
  if (!ms) return "–";
  const w = new Date(ms + 7 * 3600 * 1000);
  return `${p(w.getUTCDate())}/${p(w.getUTCMonth() + 1)} ${p(w.getUTCHours())}:${p(
    w.getUTCMinutes(),
  )}`;
}

function Kartu({
  judul,
  nilai,
  sub,
  cls,
}: {
  judul: string;
  nilai: string;
  sub?: string;
  cls?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {judul}
      </p>
      <p className={`mt-1 text-2xl font-bold ${cls ?? "text-slate-900"}`}>
        {nilai}
      </p>
      {sub ? <p className="mt-1 text-xs text-slate-500">{sub}</p> : null}
    </div>
  );
}

const QUICK_LINKS = [
  { href: "/topup/pesanan", label: "Pesanan" },
  { href: "/topup/saldo", label: "Saldo & Deposit" },
  { href: "/topup/katalog", label: "Katalog & Margin" },
  { href: "/topup/masalah", label: "Log Masalah" },
  { href: "/topup/pengaturan", label: "Pengaturan" },
];

export default async function TopupRingkasanPage() {
  const data = await ambilTopupRingkasan();
  const threshold = topupThreshold();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
          Top Up · Ringkasan
        </p>
        <h1 className="text-xl font-bold text-slate-900">
          Dashboard Top Up &amp; Isi Saldo
        </h1>
        <p className="text-sm text-slate-500">
          Pantau saldo Digiflazz, pesanan masuk, dan eksekusi transaksi — 7
          hari terakhir (WIB).
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <TopupSaldoCard threshold={threshold} />
        <Kartu
          judul="Order Hari Ini"
          nilai={String(data.orderHariIni)}
          sub={`${data.jumlah} order 7 hari`}
        />
        <Kartu
          judul="Sukses Rate"
          nilai={
            data.suksesRate === null ? "–" : `${data.suksesRate}%`
          }
          sub={`${data.success} sukses dari ${data.paid} lunas`}
          cls={
            data.suksesRate !== null && data.suksesRate < 90
              ? "text-rose-700"
              : "text-slate-900"
          }
        />
        <Kartu
          judul="Omset 7 Hari"
          nilai={fmtRp(data.omset)}
          sub={`${data.paid} order lunas`}
          cls="text-emerald-700"
        />
        <Kartu
          judul="Laba 7 Hari"
          nilai={fmtRp(data.laba)}
          sub="omset − modal"
          cls={data.laba >= 0 ? "text-emerald-700" : "text-rose-700"}
        />
        <Kartu
          judul="Butuh Perhatian"
          nilai={String(
            data.pendingBermasalah.length + data.gagalList.length,
          )}
          sub={`${data.pendingBermasalah.length} macet · ${data.gagalList.length} gagal`}
          cls={
            data.pendingBermasalah.length + data.gagalList.length > 0
              ? "text-rose-700"
              : "text-slate-900"
          }
        />
      </div>

      {data.pendingBermasalah.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">
            PERHATIAN — lunas tapi eksekusi belum kelar lebih dari 30 menit:
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {data.pendingBermasalah.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/topup/pesanan/${o.id}`}
                  className="font-medium underline hover:text-amber-950"
                >
                  {o.id}
                </Link>{" "}
                — {o.product_name || o.sku} ke {o.customer_no} · dibayar{" "}
                {jamWib(parseUtcMs(o.paid_at))}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {data.gagalList.length > 0 ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <p className="font-semibold">Eksekusi gagal pada 7 hari terakhir:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {data.gagalList.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/topup/pesanan/${o.id}`}
                  className="font-medium underline hover:text-rose-950"
                >
                  {o.id}
                </Link>{" "}
                — {o.product_name || o.sku} ke {o.customer_no}
                {o.error_message ? ` · ${o.error_message}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">
            Omset 7 hari terakhir (order lunas)
          </h2>
          <p className="text-xs text-slate-500">
            {data.jumlah} order total · klik batang untuk nilai
          </p>
        </div>
        <div className="mt-4 flex h-36 items-end gap-2">
          {data.harian.map((h) => {
            const tinggi =
              data.maxOmset > 0 ? Math.max(4, Math.round((h.omset / data.maxOmset) * 100)) : 4;
            return (
              <div
                key={h.label}
                className="flex flex-1 flex-col items-center gap-1"
                title={`${h.label}: ${h.jumlah} order · ${fmtRp(h.omset)}`}
              >
                <span className="text-[10px] font-medium text-slate-500">
                  {h.omset > 0 ? fmtRp(h.omset) : ""}
                </span>
                <div
                  className={`w-full max-w-16 rounded-t ${
                    h.omset > 0 ? "bg-emerald-600" : "bg-slate-200"
                  }`}
                  style={{ height: `${tinggi}%` }}
                />
                <span className="text-[10px] text-slate-500">{h.label}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">
          Order terakhir (7 hari)
        </h2>
        {data.pendingBermasalah.length === 0 && data.gagalList.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">
            Lihat seluruh pesanan, filter, dan detailnya di halaman Pesanan.
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {QUICK_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              {l.label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
