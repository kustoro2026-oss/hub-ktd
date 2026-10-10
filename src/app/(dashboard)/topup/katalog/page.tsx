// Katalog & Margin — agregat per SKU dari seluruh order top-up: volume,
// terjual sukses, omset, modal, laba, margin %, diurut dari laba terbesar.
// Bendera "Margin aneh" menandai SKU yang tagihannya < modal (harga jual
// di bawah harga beli Digiflazz — perlu koreksi katalog toko).
import Link from "next/link";
import { fmtRp } from "@/lib/keuangan";
import { ambilTopupKatalog } from "@/lib/topup";

export const dynamic = "force-dynamic";
export const metadata = { title: "Top Up · Katalog & Margin" };

export default async function TopupKatalogPage() {
  const { list } = await ambilTopupKatalog();
  const totalOmset = list.reduce((a, g) => a + g.omset, 0);
  const totalLaba = list.reduce((a, g) => a + g.laba, 0);
  const jumlahAneh = list.filter((g) => g.marginAneh).length;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
          Top Up · Katalog & Margin
        </p>
        <h1 className="text-xl font-bold text-slate-900">Katalog &amp; Margin</h1>
        <p className="text-sm text-slate-500">
          Agregat per SKU dari {list.length} SKU yang pernah dipesan — diurut
          dari laba terbesar.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            SKU pernah dipesan
          </p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{list.length}</p>
          <p className="mt-1 text-xs text-slate-500">
            dari 10.069 SKU aktif di toko
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Omset lunas
          </p>
          <p className="mt-1 text-2xl font-bold text-emerald-700">
            {fmtRp(totalOmset)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Laba total
          </p>
          <p
            className={`mt-1 text-2xl font-bold ${
              totalLaba >= 0 ? "text-emerald-700" : "text-rose-700"
            }`}
          >
            {fmtRp(totalLaba)}
          </p>
          {jumlahAneh > 0 ? (
            <p className="mt-1 text-xs text-rose-600">
              {jumlahAneh} SKU margin aneh (tagihan &lt; modal)
            </p>
          ) : null}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[920px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5">SKU</th>
              <th className="px-4 py-2.5">Produk</th>
              <th className="px-4 py-2.5 text-right">Order</th>
              <th className="px-4 py-2.5 text-right">Terjual</th>
              <th className="px-4 py-2.5 text-right">Omset</th>
              <th className="px-4 py-2.5 text-right">Modal</th>
              <th className="px-4 py-2.5 text-right">Laba</th>
              <th className="px-4 py-2.5 text-right">Margin</th>
              <th className="px-4 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                  Belum ada order top-up — katalog akan terisi setelah ada
                  pesanan masuk.
                </td>
              </tr>
            ) : (
              list.map((g) => (
                <tr key={g.sku} className="hover:bg-slate-50/60">
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-500">
                    {g.sku}
                  </td>
                  <td className="px-4 py-2.5 text-slate-900">{g.produk}</td>
                  <td className="px-4 py-2.5 text-right text-slate-600">
                    {g.jumlah}
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-600">
                    {g.terjual}
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-700">
                    {fmtRp(g.omset)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-700">
                    {fmtRp(g.modal)}
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right font-medium ${
                      g.laba >= 0 ? "text-emerald-700" : "text-rose-700"
                    }`}
                  >
                    {fmtRp(g.laba)}
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right font-medium ${
                      (g.marginPct ?? 0) < 0 ? "text-rose-700" : "text-slate-900"
                    }`}
                  >
                    {g.marginPct === null ? "–" : `${g.marginPct}%`}
                  </td>
                  <td className="px-4 py-2.5">
                    {g.marginAneh ? (
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800">
                        Margin aneh
                      </span>
                    ) : (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                        Normal
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-500">
        <p>
          Tabel ini hanya berisi SKU yang pernah muncul di order masuk. Daftar
          lengkap katalog aktif (10.069 SKU) dikelola di halaman admin toko —{" "}
          <a
            href="https://toko.kustoro2026.com/topup/admin"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-emerald-700 hover:underline"
          >
            toko.kustoro2026.com/topup/admin
          </a>
          . Margin dihitung dari order lunas (omset − modal), bukan dari harga
          katalog.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href="/topup"
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          ← Ringkasan
        </Link>
      </div>
    </div>
  );
}
