"use client";

// Daftar produk Blibli + panel "Atur" per produk: ubah harga (delta atau
// persis) dan stok (delta atau persis) untuk SEMUA varian sekaligus, lewat
// update massal antrian Blibli. Karena antrian bersifat asinkron, hasil
// akhir bisa dilihat beberapa menit setelah request sukses.
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Search, SlidersHorizontal, X } from "lucide-react";

type ProductRow = {
  product: {
    code: string;
    name: string;
    sku: string;
    state: string;
    url?: { blibli?: string };
  };
  pickupPointCodes: string[];
  counter: { stock: number; variant: number };
  price: { normal: { min: number; max: number }; sale: { min: number; max: number } };
  category: { code: string; name: string };
  flags: {
    archived?: boolean;
    review?: boolean;
    suspended?: boolean;
    includedInPromoBlibli?: boolean;
  };
  images: { path: string; main?: boolean }[];
  updatedDate: number;
  rejection?: { reason?: string };
  revision?: { notes?: string };
  suspension?: { reason?: string };
};

type VariantRow = {
  variant: {
    blibliSku: string;
    code: string;
    name: string;
    sellerSku?: string;
    url?: { blibli?: string };
  };
  pickupPoint: { code: string; name: string };
  price: { regular: number; sale: number; notUpdatableReason?: string };
  stock: { seller: { available: number; reserved: number; minimum: number } };
  flags: { buyable?: boolean; updatable?: boolean; priceUpdatable?: boolean };
  product: { code: string; sku: string; type?: number };
  promo?: { blibli?: { price?: { current?: number; min?: number; max?: number } } };
  discount?: { amount?: number; name?: string; percentage?: number };
};

type UpdateResult = {
  ok: boolean;
  detail?: string;
  queueFeedId?: string;
  total?: number;
  variantCount?: number;
  warnings?: string[];
};

const TABS = [
  { key: "ACTIVE", label: "Aktif" },
  { key: "OOS", label: "Stok Habis" },
  { key: "NEED_CORRECTION", label: "Perlu Koreksi" },
] as const;

const PAGE_SIZE = 50;

function fmtRp(n: number): string {
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}

/** Harga min–max; bila sama tampilkan satu nilai. */
function fmtRentang(min: number, max: number): string {
  if (min === max) return fmtRp(min);
  return `${fmtRp(min)} – ${fmtRp(max)}`;
}

function wibDariEpoch(ts: number): string {
  if (!ts) return "—";
  const w = new Date((ts + 7 * 3600) * 1000);
  if (Number.isNaN(w.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(w.getUTCDate())}/${p(w.getUTCMonth() + 1)}/${w.getUTCFullYear()}`;
}

/** Gambar utama produk (fallback: gambar pertama). */
function mainImage(row: ProductRow): string {
  const img = row.images.find((i) => i.main) ?? row.images[0];
  return img?.path ?? "";
}

export default function BlibliProdukClient() {
  const [tab, setTab] = useState<string>("ACTIVE");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<ProductRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (state: string, query: string, p: number) => {
    setLoading(true);
    setError("");
    try {
      const sp = new URLSearchParams({ state, page: String(p) });
      if (query) sp.set("q", query);
      const r = await fetch(`/api/blibli/products?${sp.toString()}`, {
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
        setItems([]);
        setTotal(0);
      } else {
        setItems(data.items ?? []);
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
  const [selected, setSelected] = useState<ProductRow | null>(null);
  const [variants, setVariants] = useState<VariantRow[] | null>(null);
  const [varError, setVarError] = useState("");
  const [result, setResult] = useState<UpdateResult | null>(null);
  const [saving, setSaving] = useState(false);

  // Formulir harga persis & stok persis.
  const [regInput, setRegInput] = useState("");
  const [saleInput, setSaleInput] = useState("");
  const [stockInput, setStockInput] = useState("");

  const openVariants = useCallback(async (productSku: string) => {
    setVariants(null);
    setVarError("");
    try {
      const r = await fetch(
        `/api/blibli/products/variants?productSku=${encodeURIComponent(productSku)}`,
        { cache: "no-store" },
      );
      const data = (await r.json()) as { ok?: boolean; detail?: string; items?: VariantRow[] };
      if (!data.ok) {
        setVarError(data.detail ?? "Gagal mengambil varian produk.");
        setVariants([]);
      } else {
        setVariants(data.items ?? []);
      }
    } catch {
      setVarError("Gagal mengambil varian produk (jaringan).");
      setVariants([]);
    }
  }, []);

  const openProduct = (row: ProductRow) => {
    setSelected(row);
    setResult(null);
    setRegInput("");
    setSaleInput("");
    setStockInput("");
    void openVariants(row.product.sku);
  };

  const closeProduct = () => {
    setSelected(null);
    setVariants(null);
    setVarError("");
    setResult(null);
    setSaving(false);
  };

  const priceLocked =
    variants !== null &&
    variants.some((v) => v.flags.priceUpdatable === false);

  const submit = async (action: string, payload: Record<string, unknown>, confirmText: string) => {
    if (!selected) return;
    if (!window.confirm(confirmText)) return;
    setSaving(true);
    setResult(null);
    try {
      const r = await fetch("/api/blibli/products/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productSku: selected.product.sku, action, ...payload }),
      });
      const data = (await r.json()) as UpdateResult;
      setResult(data);
      if (data.ok) {
        await load(tab, q, page);
        await openVariants(selected.product.sku);
      }
    } catch {
      setResult({ ok: false, detail: "Gagal menghubungi server (jaringan)." });
    } finally {
      setSaving(false);
    }
  };

  const submitExactPrice = () => {
    const regular = Number(regInput);
    const sale = Number(saleInput);
    if (!Number.isFinite(regular) || !Number.isFinite(sale) || regular < 1 || sale < 1) {
      setResult({ ok: false, detail: "Isi harga regular & sale dengan angka ≥ 1." });
      return;
    }
    if (sale > regular) {
      setResult({ ok: false, detail: "Harga sale tidak boleh melebihi harga regular." });
      return;
    }
    void submit(
      "price",
      { regular, sale },
      `Terapkan harga ${fmtRp(regular)} (sale ${fmtRp(sale)}) ke SEMUA varian produk "${selected?.product.name}"?`,
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
      `Set stok ${stock} untuk SEMUA varian produk "${selected?.product.name}"?`,
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
            placeholder="Cari nama produk…"
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
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          Tidak ada produk untuk filter ini.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
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
                {items.map((row) => (
                  <tr key={row.product.sku} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {mainImage(row) ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={mainImage(row)}
                            alt=""
                            className="h-10 w-10 shrink-0 rounded-lg border border-slate-200 object-cover"
                          />
                        ) : (
                          <div className="h-10 w-10 shrink-0 rounded-lg bg-slate-100" />
                        )}
                        <div className="min-w-0">
                          <div className="line-clamp-2 font-medium text-slate-800">
                            {row.product.name}
                          </div>
                          <div className="text-xs text-slate-500">
                            {row.product.sku} · {row.category.name} ·{" "}
                            {row.counter.variant} varian · Diubah{" "}
                            {wibDariEpoch(row.updatedDate)}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-medium text-slate-800">
                        {fmtRentang(row.price.normal.min, row.price.normal.max)}
                      </div>
                      <div className="text-xs text-slate-500">
                        Sale {fmtRentang(row.price.sale.min, row.price.sale.max)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          row.counter.stock > 0
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-rose-100 text-rose-800"
                        }`}
                      >
                        {row.counter.stock}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {row.flags.suspended ? (
                          <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-medium text-rose-800">
                            Disuspensi
                          </span>
                        ) : null}
                        {row.flags.review ? (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                            Review
                          </span>
                        ) : null}
                        {row.flags.includedInPromoBlibli ? (
                          <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium text-sky-800">
                            Promo Blibli
                          </span>
                        ) : null}
                        {row.rejection?.reason ? (
                          <span
                            className="rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-medium text-rose-800"
                            title={row.rejection.reason}
                          >
                            Ditolak
                          </span>
                        ) : null}
                        {row.revision?.notes ? (
                          <span
                            className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800"
                            title={row.revision.notes}
                          >
                            Koreksi
                          </span>
                        ) : null}
                        {row.flags.archived ? (
                          <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-medium text-slate-700">
                            Arsip
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => openProduct(row)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-emerald-500 hover:text-emerald-700"
                      >
                        <SlidersHorizontal className="h-3.5 w-3.5" /> Atur
                      </button>
                    </td>
                  </tr>
                ))}
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

      {/* Panel Atur produk (drawer) */}
      {selected ? (
        <div className="fixed inset-0 z-50 bg-black/40" onClick={closeProduct}>
          <div
            className="absolute right-0 top-0 flex h-full w-full max-w-3xl flex-col bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-slate-200 p-5">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
                  Atur Produk · {selected.product.sku}
                </p>
                <h2 className="line-clamp-2 text-lg font-bold text-slate-900">
                  {selected.product.name}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Perubahan harga &amp; stok dikirim ke ANTRIAN Blibli — hasil
                  akhir terlihat beberapa menit kemudian.
                </p>
              </div>
              <button
                type="button"
                onClick={closeProduct}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Tutup"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-5">
              {varError ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
                  {varError}
                </div>
              ) : null}

              {variants === null && !varError ? (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Mengambil varian…
                </div>
              ) : variants && variants.length > 0 ? (
                <>
                  {variants.some((v) => v.promo?.blibli?.price?.current) ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
                      Ada varian yang sedang ikut promo/Flash Sale Blibli —
                      perubahan harga bisa ditolak sistem bila keluar dari
                      rentang harga promo.
                    </div>
                  ) : null}
                  {priceLocked ? (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-900">
                      Harga sebagian varian sedang dikunci Blibli (promo/kampanye)
                      — tombol ubah harga dinonaktifkan.
                      {variants.find((v) => v.flags.priceUpdatable === false)
                        ?.price.notUpdatableReason
                        ? ` Alasan: ${
                            variants.find((v) => v.flags.priceUpdatable === false)
                              ?.price.notUpdatableReason
                          }`
                        : ""}
                    </div>
                  ) : null}

                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full min-w-[560px] text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                          <th className="px-3 py-2 font-medium">Varian</th>
                          <th className="px-3 py-2 font-medium">Harga</th>
                          <th className="px-3 py-2 font-medium">Stok</th>
                          <th className="px-3 py-2 font-medium">Lokasi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {variants.map((v) => (
                          <tr
                            key={v.variant.blibliSku}
                            className="border-b border-slate-100 last:border-b-0"
                          >
                            <td className="max-w-60 px-3 py-2">
                              <div className="line-clamp-2 text-slate-800">
                                {v.variant.name}
                              </div>
                              <div className="text-[11px] text-slate-400">
                                {v.variant.blibliSku}
                              </div>
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              <div className="font-medium text-slate-800">
                                {fmtRp(v.price.regular)}
                              </div>
                              {v.price.sale < v.price.regular ? (
                                <div className="text-xs text-slate-500">
                                  Sale {fmtRp(v.price.sale)}
                                </div>
                              ) : null}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              <span className="font-medium text-slate-800">
                                {v.stock.seller.available}
                              </span>
                              {v.stock.seller.reserved > 0 ? (
                                <span className="text-xs text-slate-400">
                                  {" "}
                                  (+{v.stock.seller.reserved} dipesan)
                                </span>
                              ) : null}
                            </td>
                            <td className="px-3 py-2 text-xs text-slate-500">
                              {v.pickupPoint.name || v.pickupPoint.code}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Ubah harga */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-sm font-semibold text-slate-900">
                      Ubah harga semua varian
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={priceLocked || saving}
                        onClick={() =>
                          submit(
                            "priceDelta",
                            { deltaRegular: -2000, deltaSale: -2000 },
                            `Turunkan harga SEMUA varian "${selected.product.name}" sebesar Rp 2.000?`,
                          )
                        }
                        className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-800 disabled:opacity-40"
                      >
                        Turun Rp 2.000
                      </button>
                      <button
                        type="button"
                        disabled={priceLocked || saving}
                        onClick={() =>
                          submit(
                            "priceDelta",
                            { deltaRegular: 2000, deltaSale: 2000 },
                            `Naikkan harga SEMUA varian "${selected.product.name}" sebesar Rp 2.000?`,
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
                          htmlFor="reg"
                          className="block text-xs font-medium text-slate-500"
                        >
                          Harga regular
                        </label>
                        <input
                          id="reg"
                          type="number"
                          min={1}
                          step={100}
                          value={regInput}
                          onChange={(e) => setRegInput(e.target.value)}
                          placeholder="mis. 45000"
                          className="mt-1 w-36 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-emerald-500"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="sale"
                          className="block text-xs font-medium text-slate-500"
                        >
                          Harga sale
                        </label>
                        <input
                          id="sale"
                          type="number"
                          min={1}
                          step={100}
                          value={saleInput}
                          onChange={(e) => setSaleInput(e.target.value)}
                          placeholder="mis. 43000"
                          className="mt-1 w-36 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-emerald-500"
                        />
                      </div>
                      <button
                        type="button"
                        disabled={priceLocked || saving}
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
                      Ubah stok semua varian (relatif stok masing-masing)
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
                              `Ubah stok SEMUA varian "${selected.product.name}" sebesar ${d > 0 ? "+" : ""}${d}?`,
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
                          htmlFor="stok"
                          className="block text-xs font-medium text-slate-500"
                        >
                          Stok persis (per varian)
                        </label>
                        <input
                          id="stok"
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
                      <Loader2 className="h-4 w-4 animate-spin" /> Mengirim ke
                      antrian Blibli…
                    </div>
                  ) : null}

                  {result ? (
                    result.ok ? (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                        <p className="font-semibold">
                          Permintaan masuk antrian Blibli ({result.variantCount}{" "}
                          varian).
                        </p>
                        <p className="mt-1 text-xs">
                          ID antrian: {result.queueFeedId} — perubahan diproses
                          beberapa menit kemudian. Segarkan daftar produk untuk
                          melihat hasilnya.
                        </p>
                        {result.warnings && result.warnings.length > 0 ? (
                          <ul className="mt-2 list-inside list-disc text-xs text-amber-800">
                            {result.warnings.map((w, i) => (
                              <li key={i}>{w}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
                        {result.detail ?? "Gagal memperbarui produk."}
                      </div>
                    )
                  ) : null}
                </>
              ) : !varError ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  Produk ini tidak punya varian.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
