"use client";

// Daftar produk KTD Store (katalog Aneka) — pencarian + tabel harga jual
// toko, modal, dan profit per produk. Data disiapkan server-side; komponen
// ini hanya menyaring & merender.
import Link from "next/link";
import { useMemo, useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";

export type BarisProdukToko = {
  id: string;
  nama: string;
  modal: number;
  /** Harga jual efektif toko (override ?? rekomendasi jual Aneka). */
  harga: number;
  rekomendasi: number;
  profit: number;
  lokasi: string;
  /** true bila harga toko memakai override (bukan rekomendasi Aneka). */
  override: boolean;
};

function fmtRp(n: number): string {
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}

export default function KtdStoreProdukClient({
  rows,
  generatedAt,
}: {
  rows: BarisProdukToko[];
  generatedAt: string;
}) {
  const [q, setQ] = useState("");
  const tersaring = useMemo(() => {
    const kueri = q.trim().toLowerCase();
    if (!kueri) return rows;
    return rows.filter(
      (r) =>
        r.nama.toLowerCase().includes(kueri) ||
        r.id.includes(kueri) ||
        r.lokasi.toLowerCase().includes(kueri),
    );
  }, [rows, q]);

  const jumlahOverride = rows.filter((r) => r.override).length;
  const totalProfit = rows.reduce((s, r) => s + r.profit, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 font-medium text-emerald-800">
          {rows.length} produk
        </span>
        <span className="rounded-full bg-sky-100 px-2.5 py-0.5 font-medium text-sky-800">
          {jumlahOverride} override harga
        </span>
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 font-medium text-slate-700">
          total profit {fmtRp(totalProfit)}
        </span>
        {generatedAt ? (
          <span className="text-slate-400">katalog {generatedAt}</span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari nama / id / lokasi…"
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-800 outline-none focus:border-emerald-500"
          />
        </div>
        <Link
          href="/marketplace/ktd-store/produk/massal"
          className="ml-auto inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <SlidersHorizontal className="h-4 w-4" />
          Atur Massal
        </Link>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2 font-medium">Produk</th>
              <th className="px-3 py-2 font-medium">Modal</th>
              <th className="px-3 py-2 font-medium">Harga Toko</th>
              <th className="px-3 py-2 font-medium">Profit</th>
              <th className="px-3 py-2 font-medium">Lokasi</th>
            </tr>
          </thead>
          <tbody>
            {tersaring.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-8 text-center text-slate-500"
                >
                  Tidak ada produk yang cocok dengan pencarian.
                </td>
              </tr>
            ) : (
              tersaring.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50"
                >
                  <td className="px-3 py-2">
                    <div className="line-clamp-2 font-medium text-slate-800">
                      {r.nama}
                    </div>
                    <div className="text-xs text-slate-500">
                      Aneka #{r.id}
                      {r.override ? (
                        <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-800">
                          override
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                    <div>{r.modal > 0 ? fmtRp(r.modal) : "—"}</div>
                    {r.rekomendasi > 0 ? (
                      <div className="text-xs text-slate-400">
                        saran {fmtRp(r.rekomendasi)}
                      </div>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-semibold text-emerald-700">
                    {r.harga > 0 ? fmtRp(r.harga) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                    {r.modal > 0 ? fmtRp(r.profit) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                    {r.lokasi || "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
