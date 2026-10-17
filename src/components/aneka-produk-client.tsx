"use client";

// Menu Aneka — daftar master seluruh produk anekadropship.id (snapshot
// hasil sweep listing + detail). Kolom: nama, id, harga beli, rekomendasi
// jual, profit, stok, varian, lokasi, pengiriman. Baris bisa dibuka untuk
// melihat rincian varian (warna/ukuran/stok) + alamat seller + ekspedisi.
import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import type { AnekaMasterProduct } from "@/lib/aneka-master";

function fmtRp(n: number): string {
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}

function fmtGram(g: number): string {
  return g > 0 ? `${g.toLocaleString("id-ID")} g` : "—";
}

type SortKey = "nama" | "profit" | "stok" | "modal" | "id";
type StokFilter = "semua" | "ada" | "habis";

export default function AnekaProdukClient({
  rows,
  meta,
}: {
  rows: AnekaMasterProduct[];
  meta: {
    generatedAt: string;
    scanned: number;
    withVariants: number;
    totalVariants: number;
    status404: number;
    stokHabis: number;
  };
}) {
  const [q, setQ] = useState("");
  const [kategori, setKategori] = useState("semua");
  const [stokFilter, setStokFilter] = useState<StokFilter>("semua");
  const [sortKey, setSortKey] = useState<SortKey>("profit");
  const [buka, setBuka] = useState<Record<string, boolean>>({});

  const kategoriList = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.kategori) set.add(r.kategori);
    return [...set].sort();
  }, [rows]);

  const tersaring = useMemo(() => {
    const kueri = q.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (stokFilter === "ada" && r.stok <= 0) return false;
      if (stokFilter === "habis" && (r.status === "404" || r.stok > 0)) return false;
      if (kategori !== "semua" && r.kategori !== kategori) return false;
      if (!kueri) return true;
      return (
        r.name.toLowerCase().includes(kueri) ||
        r.id.includes(kueri) ||
        r.lokasi.toLowerCase().includes(kueri) ||
        r.alamatSeller.toLowerCase().includes(kueri)
      );
    });
    const profit = (r: AnekaMasterProduct) =>
      r.hargaModal > 0 ? r.rekomendasiJual - r.hargaModal : -1;
    out = [...out].sort((a, b) => {
      switch (sortKey) {
        case "nama":
          return a.name.localeCompare(b.name, "id");
        case "stok":
          return b.stok - a.stok;
        case "modal":
          return a.hargaModal - b.hargaModal;
        case "id":
          return Number(a.id) - Number(b.id);
        default:
          return profit(b) - profit(a);
      }
    });
    return out;
  }, [rows, q, kategori, stokFilter, sortKey]);

  const adaStok = rows.filter((r) => r.status !== "404" && r.stok > 0).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 font-medium text-emerald-800">
          {meta.scanned} produk
        </span>
        <span className="rounded-full bg-sky-100 px-2.5 py-0.5 font-medium text-sky-800">
          {adaStok} ada stok
        </span>
        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 font-medium text-amber-800">
          {meta.stokHabis} stok habis
        </span>
        <span className="rounded-full bg-violet-100 px-2.5 py-0.5 font-medium text-violet-800">
          {meta.withVariants} bervarian ({meta.totalVariants} varian)
        </span>
        {meta.status404 > 0 ? (
          <span className="rounded-full bg-red-100 px-2.5 py-0.5 font-medium text-red-700">
            {meta.status404} tidak ada di Aneka (404)
          </span>
        ) : null}
        {meta.generatedAt ? (
          <span className="text-slate-400">sweep {meta.generatedAt}</span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari nama / id / lokasi / alamat seller…"
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-800 outline-none focus:border-emerald-500"
          />
        </div>
        <select
          value={kategori}
          onChange={(e) => setKategori(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-500"
        >
          <option value="semua">Semua kategori</option>
          {kategoriList.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <select
          value={stokFilter}
          onChange={(e) => setStokFilter(e.target.value as StokFilter)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-500"
        >
          <option value="semua">Semua stok</option>
          <option value="ada">Ada stok</option>
          <option value="habis">Stok habis / 404</option>
        </select>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="ml-auto rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-500"
        >
          <option value="profit">Urut: profit tertinggi</option>
          <option value="nama">Urut: nama A-Z</option>
          <option value="stok">Urut: stok terbanyak</option>
          <option value="modal">Urut: modal termurah</option>
          <option value="id">Urut: id</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2 font-medium">Produk</th>
              <th className="px-3 py-2 font-medium">Harga Beli</th>
              <th className="px-3 py-2 font-medium">Rek. Jual</th>
              <th className="px-3 py-2 font-medium">Profit</th>
              <th className="px-3 py-2 font-medium">Stok</th>
              <th className="px-3 py-2 font-medium">Varian</th>
              <th className="px-3 py-2 font-medium">Lokasi</th>
              <th className="px-3 py-2 font-medium">Pengiriman</th>
              <th className="px-3 py-2 font-medium">Terjual</th>
            </tr>
          </thead>
          <tbody>
            {tersaring.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-slate-500">
                  Tidak ada produk yang cocok dengan saringan.
                </td>
              </tr>
            ) : (
              tersaring.map((r) => {
                const terbuka = !!buka[r.id];
                const profit = r.hargaModal > 0 ? r.rekomendasiJual - r.hargaModal : 0;
                return (
                  <Fragment key={r.id}>
                    <tr
                      onClick={() => setBuka((s) => ({ ...s, [r.id]: !terbuka }))}
                      className="cursor-pointer border-b border-slate-100 last:border-b-0 hover:bg-slate-50"
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-start gap-1.5">
                          <button
                            type="button"
                            className="mt-0.5 text-slate-400 hover:text-slate-600"
                            aria-label={terbuka ? "Tutup rincian" : "Buka rincian"}
                          >
                            {terbuka ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </button>
                          <div>
                            <div className="line-clamp-2 font-medium text-slate-800">
                              {r.name}
                            </div>
                            <div className="text-xs text-slate-500">
                              Aneka #{r.id}
                              {r.sumber !== "listing" ? (
                                <span className="ml-1 rounded bg-slate-100 px-1 py-0.5 text-[10px] font-medium text-slate-500">
                                  {r.sumber}
                                </span>
                              ) : null}
                              {r.status === "404" ? (
                                <span className="ml-1 rounded bg-red-100 px-1 py-0.5 text-[10px] font-medium text-red-700">
                                  404
                                </span>
                              ) : null}
                              {r.status === "tanpa-detail" ? (
                                <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-700">
                                  tanpa detail
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                        {r.hargaModal > 0 ? fmtRp(r.hargaModal) : "—"}
                        {r.hargaModalCut > 0 ? (
                          <div className="text-xs text-slate-400">
                            coret {fmtRp(r.hargaModalCut)}
                          </div>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-semibold text-emerald-700">
                        {r.rekomendasiJual > 0 ? fmtRp(r.rekomendasiJual) : "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                        {r.hargaModal > 0 && r.rekomendasiJual > 0 ? (
                          <>
                            <div>{fmtRp(profit)}</div>
                            <div className="text-xs text-slate-400">
                              {r.profitPct ? r.profitPct.replace("Profit ", "") : ""}
                            </div>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <span
                          className={
                            r.status === "404" || r.stok <= 0
                              ? "font-semibold text-red-600"
                              : r.stok < 10
                                ? "font-semibold text-amber-600"
                                : "font-semibold text-slate-700"
                          }
                        >
                          {r.status === "404" ? "—" : r.stok.toLocaleString("id-ID")}
                        </span>
                        {r.hasVarian ? (
                          <div className="text-[11px] text-slate-400">
                            stok varian minimum
                          </div>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                        {r.hasVarian ? (
                          <span className="rounded bg-violet-100 px-1.5 py-0.5 text-xs font-medium text-violet-800">
                            {r.varian.length} varian
                          </span>
                        ) : (
                          <span className="text-slate-400">tunggal</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                        {r.lokasi || "—"}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {r.ekspedisi ? (
                          <div className="max-w-[220px] truncate text-xs" title={r.ekspedisi}>
                            {r.ekspedisi}
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                        {r.sistem ? (
                          <div className="text-[11px] text-slate-400">
                            sistem {r.sistem} · {fmtGram(r.beratGram)}
                          </div>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                        {r.terjual && r.terjual !== "0" ? r.terjual : "0"}
                      </td>
                    </tr>
                    {terbuka ? (
                      <tr key={`${r.id}-detail`} className="border-b border-slate-100 bg-slate-50/60">
                        <td colSpan={9} className="px-4 py-3">
                          <RincianProduk r={r} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RincianProduk({ r }: { r: AnekaMasterProduct }) {
  return (
    <div className="space-y-3 text-sm">
      {r.hasVarian ? (
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Varian ({r.varian.length})
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[620px] text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="px-2 py-1.5 font-medium">Nama Varian</th>
                  <th className="px-2 py-1.5 font-medium">Warna</th>
                  <th className="px-2 py-1.5 font-medium">Ukuran</th>
                  <th className="px-2 py-1.5 font-medium">Harga</th>
                  <th className="px-2 py-1.5 font-medium">Stok</th>
                  <th className="px-2 py-1.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {r.varian.map((v) => (
                  <tr key={v.id} className="border-b border-slate-50 last:border-b-0">
                    <td className="px-2 py-1.5 font-medium text-slate-700">{v.label || v.nama}</td>
                    <td className="px-2 py-1.5 text-slate-600">{v.warna ?? "—"}</td>
                    <td className="px-2 py-1.5 text-slate-600">{v.ukuran ?? "—"}</td>
                    <td className="px-2 py-1.5 text-slate-600">
                      {v.harga > 0 ? fmtRp(v.harga) : "—"}
                    </td>
                    <td className="px-2 py-1.5 font-semibold text-slate-700">
                      {v.stok.toLocaleString("id-ID")}
                    </td>
                    <td className="px-2 py-1.5">
                      {v.aktif ? (
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                          aktif
                        </span>
                      ) : (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                          nonaktif
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1 text-xs text-slate-600">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Alamat Seller
          </div>
          <div>{r.alamatSeller || "—"}</div>
          <div className="pt-1 text-slate-400">Lokasi: {r.lokasi || "—"}</div>
        </div>
        <div className="space-y-1 text-xs text-slate-600">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Pengiriman
          </div>
          <div>Ekspedisi: {r.ekspedisi || "—"}</div>
          <div>Berat: {fmtGram(r.beratGram)}</div>
          <div>Volume: {r.volume || "—"}</div>
          <div>Sistem: {r.sistem || "—"}</div>
          {r.sku ? <div>SKU: {r.sku}</div> : null}
          {r.namaAneka !== r.name ? (
            <div className="pt-1 text-slate-400">
              Nama di Aneka: <span className="italic">{r.namaAneka}</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
