"use client";

// Pemetaan produk Lazada → Aneka: tabel produk Lazada dari katalog toko +
// pemetaan manual, dengan pencarian produk Aneka per baris.
// Kunci pemetaan = SellerSku Lazada — tingkat produk seperti product_id
// TikTok, satu baris menaungi semua varian (warna/ukuran); varian dipilih
// saat eksekusi dari varian yang dipesan pembeli.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link2, Search, X } from "lucide-react";

type MapRow = {
  lazada_sku: string;
  seller_sku: string;
  product_name: string;
  aneka_product_id: string;
  aneka_variant_id: string;
  aneka_product_name: string;
  enabled: number;
  updated_at: string;
};

type SeenProduct = {
  lazada_sku: string;
  seller_sku: string;
  product_name: string;
  price: number;
  quantity: number;
  status: string;
};

type CatalogHit = {
  id: string;
  name: string;
  hargaModal: string;
  rekomendasiJual: string;
  location: string;
};

type TableProduct = {
  lazada_sku: string;
  seller_sku: string;
  product_name: string;
  price: number;
  quantity: number;
  status: string;
  manual: boolean;
};

function fmtRp(n: number): string {
  return "Rp" + Math.round(n).toLocaleString("id-ID");
}

/** Kotak cari produk Aneka dengan dropdown hasil (snapshot katalog). */
function AnekaSearch({
  onSelect,
  placeholder = "Cari produk Aneka…",
}: {
  onSelect: (hit: CatalogHit) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CatalogHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setHits([]);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/aneka-search?q=${encodeURIComponent(q)}`);
        const data = (await r.json()) as { results?: CatalogHit[] };
        setHits(data.results ?? []);
        setOpen(true);
      } catch {
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  return (
    <div ref={box} className="relative min-w-56 flex-1">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-8 pr-8 text-sm text-slate-800 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
        />
        {q ? (
          <button
            type="button"
            onClick={() => setQ("")}
            className="absolute right-2 top-2 text-slate-400 hover:text-slate-600"
            aria-label="Bersihkan"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {loading ? (
            <div className="px-3 py-2 text-xs text-slate-400">Mencari…</div>
          ) : hits.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-400">
              Tidak ada yang cocok. Coba kata kunci lain.
            </div>
          ) : (
            hits.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => {
                  onSelect(h);
                  setQ("");
                  setHits([]);
                  setOpen(false);
                }}
                className="block w-full border-b border-slate-100 px-3 py-2 text-left last:border-b-0 hover:bg-emerald-50"
              >
                <span className="line-clamp-2 text-xs font-medium text-slate-800">
                  {h.name}
                </span>
                <span className="text-[11px] text-slate-500">
                  ID {h.id} · Modal {h.hargaModal || "—"} · Jual{" "}
                  {h.rekomendasiJual || "—"} · {h.location}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function LazadaMapClient({
  initialMaps,
  initialSeen,
  seenDetail,
  catalogAt,
  catalogCount,
  seedIds,
}: {
  initialMaps: MapRow[];
  initialSeen: SeenProduct[];
  seenDetail: string;
  catalogAt: string;
  catalogCount: number;
  seedIds: string[];
}) {
  const [mapsById, setMapsById] = useState<Record<string, MapRow>>(() => {
    const acc: Record<string, MapRow> = {};
    for (const m of initialMaps) acc[m.lazada_sku] = m;
    return acc;
  });
  const [seen, setSeen] = useState<SeenProduct[]>(initialSeen);
  const [saving, setSaving] = useState<string>("");
  const [error, setError] = useState("");
  // Formulir pemetaan manual (produk Lazada yang belum ada di katalog).
  const [manualId, setManualId] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualAneka, setManualAneka] = useState<CatalogHit | null>(null);

  const sync = useCallback(async () => {
    const r = await fetch("/api/lazada/map", { cache: "no-store" });
    const data = (await r.json()) as {
      maps?: MapRow[];
      seen?: SeenProduct[];
      seenDetail?: string;
    };
    if (data.maps) {
      const acc: Record<string, MapRow> = {};
      for (const m of data.maps) acc[m.lazada_sku] = m;
      setMapsById(acc);
    }
    if (data.seen) setSeen(data.seen);
    if (data.seenDetail) setError(data.seenDetail);
  }, []);

  const saveMap = useCallback(
    async (lazadaSku: string, productName: string, hit: CatalogHit) => {
      setSaving(lazadaSku);
      setError("");
      try {
        const r = await fetch("/api/lazada/map", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            lazada_sku: lazadaSku,
            product_name: productName,
            aneka_product_id: hit.id,
          }),
        });
        const data = (await r.json()) as { ok?: boolean; detail?: string };
        if (!data.ok) setError(data.detail ?? "Gagal menyimpan pemetaan.");
        else await sync();
      } catch {
        setError("Gagal menyimpan pemetaan (jaringan).");
      } finally {
        setSaving("");
      }
    },
    [sync],
  );

  const deleteMap = useCallback(
    async (lazadaSku: string) => {
      setSaving(lazadaSku);
      setError("");
      try {
        const r = await fetch(
          `/api/lazada/map?lazada_sku=${encodeURIComponent(lazadaSku)}`,
          { method: "DELETE" },
        );
        const data = (await r.json()) as { ok?: boolean };
        if (!data.ok) setError("Gagal menghapus pemetaan.");
        else await sync();
      } catch {
        setError("Gagal menghapus pemetaan (jaringan).");
      } finally {
        setSaving("");
      }
    },
    [sync],
  );

  // Impor massal pemetaan awal dari seed (SellerSku Lazada). Tidak
  // menimpa pemetaan yang sudah ada.
  const seedPending = seedIds.filter((id) => !(id in mapsById)).length;
  const importSeeds = async () => {
    setSaving("__seed__");
    setError("");
    try {
      const r = await fetch("/api/lazada/map/seed", { method: "POST" });
      const data = (await r.json()) as {
        ok?: boolean;
        detail?: string;
        inserted?: number;
      };
      if (!data.ok) setError(data.detail ?? "Gagal mengimpor pemetaan awal.");
      else await sync();
    } catch {
      setError("Gagal mengimpor pemetaan awal (jaringan).");
    } finally {
      setSaving("");
    }
  };

  // Baris tabel = gabungan produk katalog + pemetaan tersimpan.
  const rows: TableProduct[] = [];
  const seenIds = new Set<string>();
  for (const s of seen) {
    seenIds.add(s.lazada_sku);
    rows.push({
      lazada_sku: s.lazada_sku,
      seller_sku: s.seller_sku,
      product_name: s.product_name,
      price: s.price,
      quantity: s.quantity,
      status: s.status,
      manual: false,
    });
  }
  for (const m of Object.values(mapsById)) {
    if (!seenIds.has(m.lazada_sku)) {
      rows.push({
        lazada_sku: m.lazada_sku,
        seller_sku: m.seller_sku,
        product_name: m.product_name || "(tanpa nama)",
        price: 0,
        quantity: 0,
        status: "",
        manual: true,
      });
    }
  }

  const mappedCount = Object.values(mapsById).filter((m) => m.enabled === 1).length;
  const unmappedCount = rows.filter((r) => !mapsById[r.lazada_sku]).length;

  const saveManual = async () => {
    if (!manualId.trim() || !manualAneka) return;
    setSaving("__manual__");
    setError("");
    try {
      const r = await fetch("/api/lazada/map", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lazada_sku: manualId.trim(),
          product_name: manualName.trim(),
          aneka_product_id: manualAneka.id,
        }),
      });
      const data = (await r.json()) as { ok?: boolean; detail?: string };
      if (!data.ok) setError(data.detail ?? "Gagal menyimpan pemetaan.");
      else {
        setManualId("");
        setManualName("");
        setManualAneka(null);
        await sync();
      }
    } catch {
      setError("Gagal menyimpan pemetaan (jaringan).");
    } finally {
      setSaving("");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Pemetaan Produk</h1>
        <p className="text-sm text-slate-500">
          Pasangkan produk Lazada dengan produk Aneka untuk eksekusi pesanan
          otomatis (mode semi-otomatis)
        </p>
      </div>

      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <p className="font-semibold">Cara kerja</p>
        <ul className="mt-1 list-inside list-disc space-y-1 text-emerald-800">
          <li>
            Saat pesanan Lazada masuk, bot mencari produknya di tabel ini.
            Tanpa pasangan, pesanan tidak dieksekusi — Anda diberi tahu lewat
            WhatsApp.
          </li>
          <li>
            Pemetaan memakai <span className="font-mono">SellerSku</span>{" "}
            Lazada — satu baris menaungi semua varian (warna, ukuran, dll.).
            Varian yang dipesan pembeli dicocokkan otomatis saat eksekusi.
          </li>
          <li>
            Produk di bawah muncul otomatis dari katalog toko (GetProducts);
            produk lainnya bisa diimpor massal lewat tombol biru di atas atau
            ditambahkan manual.
          </li>
        </ul>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      {seedPending > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm">
          <p className="text-sky-900">
            <span className="font-semibold">{seedPending} pemetaan awal</span>{" "}
            dari {seedIds.length} produk Lazada belum diimpor. Pemetaan yang
            sudah ada tidak akan ditimpa.
          </p>
          <button
            onClick={importSeeds}
            disabled={saving === "__seed__"}
            className="ml-auto rounded-lg bg-sky-600 px-3 py-1.5 font-medium text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {saving === "__seed__"
              ? "Mengimpor..."
              : `Impor ${seedPending} pemetaan`}
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-4 text-sm">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <span className="font-semibold text-slate-900">{mappedCount}</span>{" "}
          <span className="text-slate-500">produk terpasang</span>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <span className="font-semibold text-slate-900">{unmappedCount}</span>{" "}
          <span className="text-slate-500">belum dipasangkan</span>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-500">
          Snapshot katalog Aneka: {catalogAt.slice(0, 10) || "—"} ({catalogCount} produk)
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-900">
          Produk dari katalog Lazada
        </h2>
        {seenDetail ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            {seenDetail}
          </div>
        ) : null}
        {rows.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
            Belum ada produk yang terlihat dari katalog Lazada. Impor
            pemetaan awal lewat tombol biru, tambahkan manual di bawah, atau
            tunggu produk tersambung.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3 font-semibold">Produk Lazada</th>
                  <th className="px-4 py-3 font-semibold">Harga · Stok</th>
                  <th className="px-4 py-3 font-semibold">Produk Aneka</th>
                  <th className="px-4 py-3 font-semibold">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const map = mapsById[r.lazada_sku];
                  return (
                    <tr key={r.lazada_sku} className="align-top hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">
                          {r.product_name}
                        </div>
                        <div className="mt-0.5 font-mono text-xs text-slate-400">
                          SKU {r.lazada_sku}
                          {r.manual ? (
                            <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                              MANUAL
                            </span>
                          ) : null}
                        </div>
                        <a
                          href={`https://sellercenter.lazada.co.id/apps/products`}
                          target="_blank"
                          rel="noreferrer"
                          title="Buka halaman produk di Seller Center untuk memastikan produknya"
                          className="mt-0.5 inline-block text-[11px] text-slate-400 underline decoration-dotted hover:text-emerald-700"
                        >
                          Buka produk ↗
                        </a>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                        {r.manual ? (
                          "—"
                        ) : (
                          <>
                            {fmtRp(r.price)}
                            <div className="text-xs text-slate-400">
                              stok {r.quantity}
                              {r.status ? ` · ${r.status}` : ""}
                            </div>
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {map ? (
                          <div>
                            <div className="flex items-center gap-1.5 font-medium text-emerald-700">
                              <Link2 className="h-3.5 w-3.5 shrink-0" />
                              <span className="line-clamp-2">
                                {map.aneka_product_name || "(tanpa nama)"}
                              </span>
                            </div>
                            <div className="mt-0.5 font-mono text-xs text-slate-400">
                              Aneka #{map.aneka_product_id}
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start gap-2">
                            <AnekaSearch
                              placeholder="Pilih produk Aneka…"
                              onSelect={(h) =>
                                saveMap(r.lazada_sku, r.product_name, h)
                              }
                            />
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {map ? (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => deleteMap(r.lazada_sku)}
                              disabled={saving === r.lazada_sku}
                              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:border-rose-300 hover:text-rose-600 disabled:opacity-50"
                            >
                              {saving === r.lazada_sku ? "…" : "Lepas"}
                            </button>
                          </div>
                        ) : saving === r.lazada_sku ? (
                          <span className="text-xs text-slate-400">
                            Menyimpan…
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">
          Tambah pemetaan manual
        </h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Untuk produk Lazada yang belum muncul di katalog.{" "}
          <span className="font-mono">SellerSku</span> terlihat di Seller
          Center → Produk, atau dari detail pesanan nanti.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <input
            type="text"
            value={manualId}
            onChange={(e) => setManualId(e.target.value)}
            placeholder="SellerSku Lazada"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
          />
          <input
            type="text"
            value={manualName}
            onChange={(e) => setManualName(e.target.value)}
            placeholder="Nama produk Lazada (opsional)"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
          />
        </div>
        <div className="mt-3 flex items-start gap-2">
          <AnekaSearch
            placeholder="Cari produk Aneka…"
            onSelect={(h) => setManualAneka(h)}
          />
          <button
            type="button"
            onClick={saveManual}
            disabled={!manualId.trim() || !manualAneka || saving === "__manual__"}
            className="whitespace-nowrap rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving === "__manual__" ? "Menyimpan…" : "Simpan"}
          </button>
        </div>
        {manualAneka ? (
          <div className="mt-2 text-xs text-emerald-700">
            Aneka #{manualAneka.id} — {manualAneka.name}
          </div>
        ) : null}
      </div>
    </div>
  );
}
