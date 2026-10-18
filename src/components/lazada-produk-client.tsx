"use client";

// Daftar produk Lazada + panel "Atur" per SKU: ubah harga (delta atau
// persis) dan stok (delta atau persis) lewat UpdatePriceQuantity
// (sinkron). Hasil akhir terlihat beberapa menit setelah request sukses
// (API mengembalikan hanya kode sukses).
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Search, SlidersHorizontal, X } from "lucide-react";
import TableScrollArrows from "@/components/table-scroll-arrows";

type ProductRow = {
  item_id: string;
  status: string;
  images: string[];
  attributes?: { name?: string };
  skus: SkuRow[];
};

type SkuRow = {
  SellerSku: string;
  SkuId: string;
  price: string;
  special_price: string;
  quantity: number;
  Status: string;
};

type UpdateResult = {
  ok: boolean;
  detail?: string;
  total?: number;
  sellerSku?: string;
  hargaBaru?: number;
  stokBaru?: number;
};

const TABS = [
  { key: "all", label: "Semua" },
  { key: "live", label: "Live" },
  { key: "inactive", label: "Nonaktif" },
  { key: "sold-out", label: "Stok Habis" },
] as const;

const PAGE_SIZE = 50;

function fmtRp(n: number): string {
  return "Rp" + Math.round(n).toLocaleString("id-ID");
}

/** Harga SKU: special_price bila < price (sedang sale), selain itu price. */
function skuPrice(s: SkuRow): number {
  const p = Number(s.price ?? 0) || 0;
  const sp = Number(s.special_price ?? 0) || 0;
  return sp > 0 && sp < p ? sp : p;
}

export default function LazadaProdukClient() {
  const [tab, setTab] = useState<string>("all");
  const [qInput, setQInput] = useState("");
  // Wadah tabel utama — digulirkan ke kiri/kanan lewat TableScrollArrows.
  const tableRef = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (filter: string, query: string, p: number) => {
    setLoading(true);
    setError("");
    try {
      const sp = new URLSearchParams({ filter, page: String(p) });
      if (query) sp.set("q", query);
      const r = await fetch(`/api/lazada/products?${sp.toString()}`, {
        cache: "no-store",
      });
      const data = (await r.json()) as {
        ok?: boolean;
        detail?: string;
        items?: ProductRow[];
        totalRecord?: number;
      };
      if (!data.ok) {
        setError(data.detail ?? "Gagal mengambil daftar produk.");
        setProducts([]);
        setTotal(0);
      } else {
        setProducts(data.items ?? []);
        setTotal(data.totalRecord ?? 0);
      }
    } catch {
      setError("Gagal mengambil daftar produk (jaringan).");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(tab, q, page);
  }, [tab, q, page, load]);

  // Pencarian dengan jeda 400 ms supaya tidak menembak API tiap ketukan.
  const onSearchChange = (value: string) => {
    setQInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setQ(value.trim());
      setPage(0);
    }, 400);
  };

  const totalPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // ---------- Panel Atur ----------
  const [selected, setSelected] = useState<{
    product: ProductRow;
    sku: SkuRow;
  } | null>(null);
  const [result, setResult] = useState<UpdateResult | null>(null);
  const [saving, setSaving] = useState(false);

  // Formulir harga persis & stok persis.
  const [priceInput, setPriceInput] = useState("");
  const [stockInput, setStockInput] = useState("");

  const openSku = (product: ProductRow, sku: SkuRow) => {
    setSelected({ product, sku });
    setResult(null);
    setPriceInput("");
    setStockInput("");
  };

  const closeSku = () => {
    setSelected(null);
    setResult(null);
    setSaving(false);
  };

  const submit = async (
    action: string,
    payload: Record<string, unknown>,
    confirmText: string,
  ) => {
    if (!selected) return;
    if (!window.confirm(confirmText)) return;
    setSaving(true);
    setResult(null);
    try {
      const r = await fetch("/api/lazada/products/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sellerSku: selected.sku.SellerSku,
          action,
          ...payload,
        }),
      });
      const data = (await r.json()) as UpdateResult;
      setResult(data);
      if (data.ok) {
        await load(tab, q, page);
      }
    } catch {
      setResult({ ok: false, detail: "Gagal menghubungi server (jaringan)." });
    } finally {
      setSaving(false);
    }
  };

  const submitExactPrice = () => {
    const price = Number(priceInput);
    if (!Number.isFinite(price) || price < 1) {
      setResult({ ok: false, detail: "Isi harga dengan angka ≥ 1." });
      return;
    }
    void submit(
      "price",
      { price },
      `Terapkan harga ${fmtRp(price)} ke SKU "${selected?.sku.SellerSku}"?`,
    );
  };

  const submitExactStock = () => {
    const stock = Number(stockInput);
    if (!Number.isInteger(stock) || stock < 0) {
      setResult({ ok: false, detail: "Stok persis harus bilangan bulat ≥ 0." });
      return;
    }
    void submit(
      "stockExact",
      { stock },
      `Set stok ${stock} untuk SKU "${selected?.sku.SellerSku}"?`,
    );
  };

  return (
    <div className="space-y-4">
      {/* Tab status + pencarian */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex overflow-hidden rounded-lg border border-slate-300 bg-white">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setTab(t.key);
                setPage(0);
              }}
              className={`px-4 py-2 text-sm font-medium transition ${
                tab === t.key
                  ? "bg-emerald-700 text-white"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={qInput}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Cari nama produk / SellerSku…"
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-8 pr-8 text-sm text-slate-800 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
          />
          {qInput ? (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute right-2 top-2 text-slate-400 hover:text-slate-600"
              aria-label="Bersihkan pencarian"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        <span className="text-xs text-slate-500">{total} produk</span>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900">
          {error}
        </div>
      ) : loading ? (
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Mengambil daftar produk…
        </div>
      ) : products.length === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          Tidak ada produk untuk filter ini.
        </div>
      ) : (
        <>
          <div
            ref={tableRef}
            className="overflow-x-auto rounded-xl border border-slate-200 bg-white"
          >
            <TableScrollArrows targetRef={tableRef} />
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3 font-medium">Produk</th>
                  <th className="px-4 py-3 font-medium">Harga</th>
                  <th className="px-4 py-3 font-medium">Stok</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) =>
                  (p.skus ?? []).map((s) => (
                    <tr
                      key={`${p.item_id}-${s.SellerSku}`}
                      className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {p.images && p.images.length > 0 ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={p.images[0]}
                              alt=""
                              className="h-10 w-10 shrink-0 rounded-lg border border-slate-200 object-cover"
                            />
                          ) : (
                            <div className="h-10 w-10 shrink-0 rounded-lg bg-slate-100" />
                          )}
                          <div className="min-w-0">
                            <div className="line-clamp-2 font-medium text-slate-800">
                              {String(p.attributes?.name ?? "")}
                            </div>
                            <div className="text-xs text-slate-500">
                              <span className="font-mono">{s.SellerSku}</span>{" "}
                              · ID {p.item_id}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="font-medium text-slate-800">
                          {fmtRp(skuPrice(s))}
                        </div>
                        <div className="text-xs text-slate-500">
                          asli {fmtRp(Number(s.price ?? 0) || 0)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            s.quantity > 0
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-rose-100 text-rose-800"
                          }`}
                        >
                          {s.quantity}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700">
                            {s.Status || p.status || "—"}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => openSku(p, s)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-emerald-500 hover:text-emerald-700"
                        >
                          <SlidersHorizontal className="h-3.5 w-3.5" /> Atur
                        </button>
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>

          {/* Paginasi */}
          <div className="flex items-center justify-between text-sm text-slate-600">
            <button
              type="button"
              disabled={page === 0 || loading}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium transition hover:bg-slate-50 disabled:opacity-40"
            >
              ‹ Sebelumnya
            </button>
            <span>
              Halaman {page + 1} / {totalPage}
            </span>
            <button
              type="button"
              disabled={page + 1 >= totalPage || loading}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium transition hover:bg-slate-50 disabled:opacity-40"
            >
              Berikutnya ›
            </button>
          </div>
        </>
      )}

      {/* Panel Atur SKU (drawer) */}
      {selected ? (
        <div className="fixed inset-0 z-50 bg-black/40" onClick={closeSku}>
          <div
            className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-slate-200 p-5">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
                  Atur Produk · {selected.sku.SellerSku}
                </p>
                <h2 className="line-clamp-2 text-lg font-bold text-slate-900">
                  {String(selected.product.attributes?.name ?? "")}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Harga saat ini {fmtRp(skuPrice(selected.sku))} · Stok{" "}
                  {selected.sku.quantity} — perubahan dikirim langsung lewat
                  UpdatePriceQuantity, hasil terlihat beberapa menit kemudian.
                </p>
              </div>
              <button
                type="button"
                onClick={closeSku}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Tutup"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-5">
              {/* Ubah harga */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-900">
                  Ubah harga SKU ini
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() =>
                      submit(
                        "priceDelta",
                        { delta: -2000 },
                        `Turunkan harga SKU "${selected.sku.SellerSku}" sebesar Rp 2.000?`,
                      )
                    }
                    className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-800 disabled:opacity-40"
                  >
                    Turun Rp 2.000
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() =>
                      submit(
                        "priceDelta",
                        { delta: 2000 },
                        `Naikkan harga SKU "${selected.sku.SellerSku}" sebesar Rp 2.000?`,
                      )
                    }
                    className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-800 disabled:opacity-40"
                  >
                    Naik Rp 2.000
                  </button>
                  <span className="text-xs text-slate-400">
                    atau set harga persis:
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <div>
                    <label
                      htmlFor="lzd-price"
                      className="block text-xs font-medium text-slate-500"
                    >
                      Harga
                    </label>
                    <input
                      id="lzd-price"
                      type="number"
                      min={1}
                      step={100}
                      value={priceInput}
                      onChange={(e) => setPriceInput(e.target.value)}
                      placeholder="mis. 45000"
                      className="mt-1 w-36 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-emerald-500"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={submitExactPrice}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-emerald-500 hover:text-emerald-700 disabled:opacity-40"
                  >
                    Terapkan harga persis
                  </button>
                </div>
              </div>

              {/* Ubah stok */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-900">
                  Ubah stok SKU ini (relatif stok saat ini)
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {[-5, -1, 1, 5, 10].map((d) => (
                    <button
                      key={d}
                      type="button"
                      disabled={saving}
                      onClick={() =>
                        submit(
                          "stockDelta",
                          { delta: d },
                          `Ubah stok SKU "${selected.sku.SellerSku}" sebesar ${d > 0 ? "+" : ""}${d}?`,
                        )
                      }
                      className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-800 disabled:opacity-40"
                    >
                      {d > 0 ? `+${d}` : d}
                    </button>
                  ))}
                  <span className="text-xs text-slate-400">
                    atau set stok persis:
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <div>
                    <label
                      htmlFor="lzd-stock"
                      className="block text-xs font-medium text-slate-500"
                    >
                      Stok persis
                    </label>
                    <input
                      id="lzd-stock"
                      type="number"
                      min={0}
                      step={1}
                      value={stockInput}
                      onChange={(e) => setStockInput(e.target.value)}
                      placeholder="mis. 10"
                      className="mt-1 w-36 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-emerald-500"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={submitExactStock}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-emerald-500 hover:text-emerald-700 disabled:opacity-40"
                  >
                    Terapkan stok persis
                  </button>
                </div>
              </div>

              {saving ? (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Mengirim update…
                </div>
              ) : null}

              {result ? (
                result.ok ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                    <p className="font-semibold">Update berhasil dikirim.</p>
                    <p className="mt-1 text-xs">
                      SKU {result.sellerSku} → harga{" "}
                      {result.hargaBaru !== undefined
                        ? fmtRp(result.hargaBaru)
                        : "—"}{" "}
                      · stok {result.stokBaru ?? "—"}. Perubahan diproses
                      beberapa menit kemudian — segarkan daftar produk untuk
                      melihat hasilnya.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
                    {result.detail ?? "Gagal memperbarui produk."}
                  </div>
                )
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
