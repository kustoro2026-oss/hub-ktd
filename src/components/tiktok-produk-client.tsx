"use client";

// Daftar produk TikTok Shop + panel "Atur" per produk: ubah harga (delta
// atau persis) dan stok (delta atau persis) untuk SEMUA SKU sekaligus,
// lewat panggilan sinkron ke API produk TikTok. Hasil langsung berlaku —
// segarkan daftar untuk melihat nilai baru.
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Search, SlidersHorizontal, X } from "lucide-react";

type SkuRow = {
  id: string;
  sellerSku: string;
  price: {
    currency: string;
    display: number;
    salePrice: number;
    taxExclusivePrice: number;
  };
  inventory: {
    warehouseId: string;
    quantity: number;
    backorderQuantity: number;
    handlingTime: number;
  }[];
  statusInfo: { status: string; deactivationSource: string };
};

type ProductRow = {
  id: string;
  title: string;
  status: string;
  productStatus: string;
  createTime: number;
  updateTime: number;
  hasDraft: boolean;
  isNotForSale: boolean;
  salesRegions: string[];
  auditStatus: string;
  skus: SkuRow[];
};

type SkuDetail = SkuRow & {
  name: string;
  salesAttributes: { name: string; valueName: string }[];
};

type ProductDetail = {
  id: string;
  title: string;
  status: string;
  productStatus: string;
  description: string;
  mainImages: string[];
  categoryChains: string[];
  isNotForSale: boolean;
  auditFailedReasons: string[];
  skus: SkuDetail[];
};

type UpdateResult = {
  ok: boolean;
  detail?: string;
  skuCount?: number;
  errors?: string[];
};

const TABS = [
  { key: "ACTIVATE", label: "Aktif" },
  { key: "SELLER_DEACTIVATED", label: "Nonaktif" },
  { key: "ALL", label: "Semua" },
] as const;

function fmtRp(n: number): string {
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}

/** Harga min–max antar SKU; bila sama tampilkan satu nilai. */
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

/** Status efektif produk — status gabungan, fallback productStatus (untuk
 *  toko Indonesia kadang salah satunya kosong). */
function effStatus(p: { status: string; productStatus: string }): string {
  return p.status || p.productStatus || "—";
}

/** Total stok satu SKU (jumlah semua gudang) + jumlah gudang. */
function totalStok(s: SkuRow): { qty: number; gudang: number } {
  const qty = s.inventory.reduce((a, w) => a + w.quantity, 0);
  return { qty, gudang: s.inventory.length };
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVATE: "Aktif",
  SELLER_DEACTIVATED: "Nonaktif",
  PLATFORM_DEACTIVATED: "Dinonaktifkan platform",
  DRAFT: "Draf",
  PENDING: "Menunggu",
  FAILED: "Gagal",
  FREEZE: "Dibekukan",
  DELETED: "Dihapus",
};

export default function TiktokProdukClient() {
  const [tab, setTab] = useState<string>("ACTIVATE");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  // Paginasi kursor: token halaman aktif + tumpukan token halaman sebelumnya.
  const [cursor, setCursor] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [nextToken, setNextToken] = useState("");
  const [items, setItems] = useState<ProductRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchMode, setSearchMode] = useState(false);
  const [scanned, setScanned] = useState(0);
  const [shopName, setShopName] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (state: string, query: string, token: string) => {
      setLoading(true);
      setError("");
      try {
        const sp = new URLSearchParams({ state });
        if (query) sp.set("q", query);
        if (token) sp.set("pageToken", token);
        const r = await fetch(`/api/tiktok/products?${sp.toString()}`, {
          cache: "no-store",
        });
        const data = (await r.json()) as {
          ok?: boolean;
          detail?: string;
          items?: ProductRow[];
          totalCount?: number;
          nextPageToken?: string;
          searchMode?: boolean;
          scanned?: number;
          shopName?: string;
        };
        if (!data.ok) {
          setError(data.detail ?? "Gagal mengambil daftar produk.");
          setItems([]);
          setTotal(0);
          setNextToken("");
          setSearchMode(false);
        } else {
          setItems(data.items ?? []);
          setTotal(data.totalCount ?? 0);
          setNextToken(data.nextPageToken ?? "");
          setSearchMode(Boolean(data.searchMode));
          setScanned(data.scanned ?? 0);
          setShopName(data.shopName ?? "");
        }
      } catch {
        setError("Gagal mengambil daftar produk (jaringan).");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(tab, q, cursor);
  }, [tab, q, cursor, load]);

  // Pencarian dengan jeda 400 ms supaya tidak menembak API tiap ketukan.
  // Cari judul dipindai halaman demi halaman di sisi server (API produk
  // TikTok tidak punya filter judul) — mulai dari halaman pertama.
  const onSearchChange = (value: string) => {
    setQInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setQ(value.trim());
      setCursor("");
      setHistory([]);
    }, 400);
  };

  const goNext = () => {
    if (!nextToken || loading) return;
    setHistory((h) => [...h, cursor]);
    setCursor(nextToken);
  };

  const goPrev = () => {
    if (history.length === 0 || loading) return;
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setCursor(prev);
  };

  // ---------- Panel Atur ----------
  const [selected, setSelected] = useState<ProductRow | null>(null);
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [varError, setVarError] = useState("");
  const [result, setResult] = useState<UpdateResult | null>(null);
  const [saving, setSaving] = useState(false);

  // Formulir harga persis & stok persis.
  const [regInput, setRegInput] = useState("");
  const [stockInput, setStockInput] = useState("");

  const openDetail = useCallback(async (productId: string) => {
    setDetail(null);
    setVarError("");
    try {
      const r = await fetch(
        `/api/tiktok/products/detail?productId=${encodeURIComponent(productId)}`,
        { cache: "no-store" },
      );
      const data = (await r.json()) as {
        ok?: boolean;
        detail?: string;
        product?: ProductDetail;
      };
      if (!data.ok) {
        setVarError(data.detail ?? "Gagal mengambil detail produk.");
      } else {
        setDetail(data.product ?? null);
      }
    } catch {
      setVarError("Gagal mengambil detail produk (jaringan).");
    }
  }, []);

  const openProduct = (row: ProductRow) => {
    setSelected(row);
    setResult(null);
    setRegInput("");
    setStockInput("");
    void openDetail(row.id);
  };

  const closeProduct = () => {
    setSelected(null);
    setDetail(null);
    setVarError("");
    setResult(null);
    setSaving(false);
  };

  const statusSelected = selected ? effStatus(selected) : "";
  // TikTok hanya mengizinkan ubah harga pada produk Aktif.
  const priceLocked =
    statusSelected !== "" && statusSelected !== "ACTIVATE";
  // Stok boleh diubah pada hampir semua status kecuali dibekukan/dihapus.
  const stockLocked =
    statusSelected === "FREEZE" || statusSelected === "DELETED";

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
      const r = await fetch("/api/tiktok/products/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId: selected.id, action, ...payload }),
      });
      const data = (await r.json()) as UpdateResult;
      setResult(data);
      if (data.ok) {
        await load(tab, q, cursor);
        await openDetail(selected.id);
      }
    } catch {
      setResult({ ok: false, detail: "Gagal menghubungi server (jaringan)." });
    } finally {
      setSaving(false);
    }
  };

  const submitExactPrice = () => {
    const regular = Number(regInput);
    if (!Number.isFinite(regular) || regular < 1) {
      setResult({ ok: false, detail: "Isi harga dengan angka ≥ 1." });
      return;
    }
    void submit(
      "price",
      { regular: Math.round(regular) },
      `Terapkan harga ${fmtRp(regular)} ke SEMUA SKU produk "${selected?.title}"?`,
    );
  };

  const submitExactStock = () => {
    const stock = Number(stockInput);
    if (!Number.isInteger(stock) || stock < 1 || stock > 99999) {
      setResult({
        ok: false,
        detail: "Stok persis harus bilangan bulat 1 – 99.999 (batas TikTok).",
      });
      return;
    }
    void submit(
      "stockExact",
      { stock },
      `Set stok ${stock} untuk SEMUA SKU produk "${selected?.title}"?`,
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
                setCursor("");
                setHistory([]);
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
            placeholder="Cari judul produk…"
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
        <span className="text-xs text-slate-500">
          {shopName ? `${shopName} · ` : ""}
          {total} produk
        </span>
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
                {items.map((row) => {
                  const prices = row.skus.map((s) => s.price.display).filter((p) => p > 0);
                  const stok = row.skus.reduce((a, s) => a + totalStok(s).qty, 0);
                  const st = effStatus(row);
                  return (
                    <tr
                      key={row.id}
                      className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50"
                    >
                      <td className="px-4 py-3">
                        <div className="line-clamp-2 font-medium text-slate-800">
                          {row.title || "(tanpa judul)"}
                        </div>
                        <div className="text-xs text-slate-500">
                          {row.id} · {row.skus.length} SKU · Diubah{" "}
                          {wibDariEpoch(row.updateTime)}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {prices.length > 0 ? (
                          <div className="font-medium text-slate-800">
                            {fmtRentang(Math.min(...prices), Math.max(...prices))}
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            stok > 0
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-rose-100 text-rose-800"
                          }`}
                        >
                          {stok}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {st !== "ACTIVATE" ? (
                            <span
                              className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                                st === "SELLER_DEACTIVATED"
                                  ? "bg-slate-200 text-slate-700"
                                  : "bg-rose-100 text-rose-800"
                              }`}
                            >
                              {STATUS_LABEL[st] ?? st}
                            </span>
                          ) : null}
                          {row.isNotForSale ? (
                            <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-medium text-slate-700">
                              Tidak dijual
                            </span>
                          ) : null}
                          {row.hasDraft ? (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                              Ada draf
                            </span>
                          ) : null}
                          {row.auditStatus === "FAILED" ? (
                            <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-medium text-rose-800">
                              Ditolak
                            </span>
                          ) : row.auditStatus === "AUDITING" ? (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                              Review
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
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Paginasi (nonaktif saat mode cari) */}
          {searchMode ? (
            <p className="text-xs text-slate-400">
              Pencarian judul memindai {scanned} halaman produk (API TikTok
              tidak punya filter judul).
            </p>
          ) : (
            <div className="flex items-center justify-between text-sm text-slate-600">
              <button
                type="button"
                disabled={history.length === 0 || loading}
                onClick={goPrev}
                className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium transition hover:bg-slate-50 disabled:opacity-40"
              >
                ‹ Sebelumnya
              </button>
              <span>Halaman {history.length + 1}</span>
              <button
                type="button"
                disabled={!nextToken || loading}
                onClick={goNext}
                className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium transition hover:bg-slate-50 disabled:opacity-40"
              >
                Berikutnya ›
              </button>
            </div>
          )}
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
                  Atur Produk · {selected.id}
                </p>
                <h2 className="line-clamp-2 text-lg font-bold text-slate-900">
                  {selected.title}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Perubahan harga &amp; stok langsung dikirim ke API TikTok —
                  segarkan daftar untuk melihat nilai baru.
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

              {detail === null && !varError ? (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Mengambil detail…
                </div>
              ) : detail && detail.skus.length > 0 ? (
                <>
                  {priceLocked ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
                      Produk berstatus {STATUS_LABEL[statusSelected] ?? statusSelected} —
                      TikTok hanya mengizinkan ubah harga pada produk Aktif.
                      Tombol ubah harga dinonaktifkan.
                    </div>
                  ) : null}
                  {detail.isNotForSale ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
                      Produk ditandai &quot;Tidak dijual&quot; — pembaruan bisa
                      ditolak TikTok.
                    </div>
                  ) : null}
                  {detail.auditFailedReasons.length > 0 ? (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-900">
                      Produk pernah ditolak audit:{" "}
                      {detail.auditFailedReasons.join("; ")}
                    </div>
                  ) : null}
                  {detail.skus.some(
                    (v) => v.statusInfo.status === "DEACTIVATED",
                  ) ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
                      Sebagian SKU dinonaktifkan — pembaruan SKU itu bisa
                      ditolak TikTok.
                    </div>
                  ) : null}

                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full min-w-[560px] text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                          <th className="px-3 py-2 font-medium">SKU</th>
                          <th className="px-3 py-2 font-medium">Harga</th>
                          <th className="px-3 py-2 font-medium">Stok</th>
                          <th className="px-3 py-2 font-medium">Gudang</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.skus.map((v) => {
                          const t = totalStok(v);
                          return (
                            <tr
                              key={v.id}
                              className="border-b border-slate-100 last:border-b-0"
                            >
                              <td className="max-w-60 px-3 py-2">
                                <div className="line-clamp-2 text-slate-800">
                                  {v.name || v.sellerSku || "(tanpa nama)"}
                                </div>
                                <div className="text-[11px] text-slate-400">
                                  {v.sellerSku ? `${v.sellerSku} · ` : ""}
                                  {v.id}
                                </div>
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap">
                                <div className="font-medium text-slate-800">
                                  {v.price.display > 0
                                    ? fmtRp(v.price.display)
                                    : "—"}
                                </div>
                                {v.price.taxExclusivePrice > 0 &&
                                v.price.taxExclusivePrice !==
                                  v.price.display ? (
                                  <div className="text-xs text-slate-500">
                                    Pajak {fmtRp(v.price.taxExclusivePrice)}
                                  </div>
                                ) : null}
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap">
                                <span className="font-medium text-slate-800">
                                  {t.qty}
                                </span>
                                {v.inventory.some(
                                  (w) => w.backorderQuantity > 0,
                                ) ? (
                                  <span className="text-xs text-slate-400">
                                    {" "}
                                    (+backorder)
                                  </span>
                                ) : null}
                              </td>
                              <td className="px-3 py-2 text-xs text-slate-500">
                                {t.gudang} gudang
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Ubah harga */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-sm font-semibold text-slate-900">
                      Ubah harga semua SKU
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={priceLocked || saving}
                        onClick={() =>
                          submit(
                            "priceDelta",
                            { deltaRegular: -2000 },
                            `Turunkan harga SEMUA SKU "${selected.title}" sebesar Rp 2.000?`,
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
                            { deltaRegular: 2000 },
                            `Naikkan harga SEMUA SKU "${selected.title}" sebesar Rp 2.000?`,
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
                          Harga (IDR)
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
                      Ubah stok semua SKU (relatif stok masing-masing)
                    </p>
                    {stockLocked ? (
                      <p className="mt-1 text-xs text-rose-700">
                        Stok tidak bisa diubah untuk produk berstatus{" "}
                        {STATUS_LABEL[statusSelected] ?? statusSelected}.
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {[-5, -1, 1, 5, 10].map((d) => (
                        <button
                          key={d}
                          type="button"
                          disabled={stockLocked || saving}
                          onClick={() =>
                            submit(
                              "stockDelta",
                              { delta: d },
                              `Ubah stok SEMUA SKU "${selected.title}" sebesar ${d > 0 ? "+" : ""}${d}?`,
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
                          Stok persis (per SKU)
                        </label>
                        <input
                          id="stok"
                          type="number"
                          min={1}
                          max={99999}
                          step={1}
                          value={stockInput}
                          onChange={(e) => setStockInput(e.target.value)}
                          placeholder="mis. 10"
                          className="mt-1 w-36 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-emerald-500"
                        />
                      </div>
                      <button
                        type="button"
                        disabled={stockLocked || saving}
                        onClick={submitExactStock}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-emerald-500 hover:text-emerald-700 disabled:opacity-40"
                      >
                        Terapkan stok persis
                      </button>
                    </div>
                    <p className="mt-2 text-[11px] text-slate-400">
                      Batas TikTok: stok 1 – 99.999 per gudang. Nilai 0 tidak
                      diterima — gunakan &quot;Nonaktifkan produk&quot; di
                      Seller Center bila ingin stok habis.
                    </p>
                  </div>

                  {saving ? (
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                      <Loader2 className="h-4 w-4 animate-spin" /> Mengirim ke
                      API TikTok…
                    </div>
                  ) : null}

                  {result ? (
                    result.ok ? (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                        <p className="font-semibold">
                          Perubahan terkirim ke TikTok ({result.skuCount} SKU).
                        </p>
                        <p className="mt-1 text-xs">
                          Perubahan langsung berlaku. Segarkan daftar produk
                          untuk melihat hasilnya.
                        </p>
                        {result.errors && result.errors.length > 0 ? (
                          <ul className="mt-2 list-inside list-disc text-xs text-amber-800">
                            {result.errors.map((w, i) => (
                              <li key={i}>{w}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
                        {result.detail ?? "Gagal memperbarui produk."}
                        {result.errors && result.errors.length > 0 ? (
                          <ul className="mt-2 list-inside list-disc text-xs">
                            {result.errors.map((w, i) => (
                              <li key={i}>{w}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    )
                  ) : null}
                </>
              ) : !varError ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  Produk ini tidak punya SKU.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
