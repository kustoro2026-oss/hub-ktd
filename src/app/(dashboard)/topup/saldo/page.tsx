// Saldo & Deposit — saldo Digiflazz live, modal keluar hari ini & 7 hari,
// rata-rata harian sebagai dasar estimasi ketahanan saldo, dan tabel
// transaksi sukses terakhir yang memangkas saldo. Saldo dibaca lewat proxy
// aman /api/topup/saldo; angka modal dihitung dari tabel bersama.
import Link from "next/link";
import { fmtRp, wibDariMs } from "@/lib/keuangan";
import { ambilTopupSaldoInfo, topupThreshold } from "@/lib/topup";
import TopupSaldoCard from "@/components/topup-saldo-card";

export const dynamic = "force-dynamic";
export const metadata = { title: "Top Up · Saldo & Deposit" };

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

export default async function TopupSaldoPage() {
  const info = await ambilTopupSaldoInfo();
  const threshold = topupThreshold();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
          Top Up · Saldo & Deposit
        </p>
        <h1 className="text-xl font-bold text-slate-900">Saldo &amp; Deposit</h1>
        <p className="text-sm text-slate-500">
          Saldo Digiflazz terkini, pengeluaran modal, dan perkiraan ketahanan
          saldo sebelum deposit berikutnya.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TopupSaldoCard threshold={threshold} rataHarian={info.rataHarian} />
        <Kartu
          judul="Modal Hari Ini"
          nilai={fmtRp(info.modalHariIni)}
          sub="modal order lunas hari ini (WIB)"
        />
        <Kartu
          judul="Modal 7 Hari"
          nilai={fmtRp(info.modal7Hari)}
          sub="modal order lunas 7 hari terakhir"
        />
        <Kartu
          judul="Rata-rata Harian"
          nilai={fmtRp(info.rataHarian)}
          sub="modal 7 hari ÷ 7 · dasar estimasi ketahanan"
          cls="text-emerald-700"
        />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
        <p>
          Ambang saldo rendah:{" "}
          <span className="font-medium text-slate-900">{fmtRp(threshold)}</span>{" "}
          (env <code className="text-xs">TOPUP_LOW_BALANCE_THRESHOLD</code>).
          Bila saldo Digiflazz turun di bawah ambang, kartu saldo memerah dan
          pembelian baru sebaiknya ditunda sampai deposit.
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Estimasi ketahanan = saldo terkini ÷ rata-rata modal harian —
          perkiraan kasar berbasis 7 hari terakhir, bukan jaminan.
        </p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Transaksi sukses terakhir (25)
          </h2>
          <p className="text-xs text-slate-500">
            Order lunas &amp; sukses — baris yang memangkas saldo Digiflazz.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Waktu</th>
                <th className="px-4 py-2.5">Pesanan</th>
                <th className="px-4 py-2.5">Produk</th>
                <th className="px-4 py-2.5">Tujuan</th>
                <th className="px-4 py-2.5 text-right">Modal</th>
                <th className="px-4 py-2.5 text-right">Tagihan</th>
                <th className="px-4 py-2.5">SN Digiflazz</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {info.riwayat.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    Belum ada transaksi sukses.
                  </td>
                </tr>
              ) : (
                info.riwayat.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/60">
                    <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">
                      {wibDariMs(r.atMs)}
                    </td>
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/topup/pesanan/${r.id}`}
                        className="font-medium text-emerald-700 hover:underline"
                      >
                        {r.id}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">{r.produk}</td>
                    <td className="px-4 py-2.5 text-slate-700">
                      {r.tujuan || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-slate-900">
                      {fmtRp(r.cost)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-600">
                      {fmtRp(r.amount)}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-500">
                      {r.sn || "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <Link
          href="/topup"
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          ← Ringkasan
        </Link>
        <Link
          href="/topup/pesanan"
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Lihat pesanan
        </Link>
      </div>
    </div>
  );
}
