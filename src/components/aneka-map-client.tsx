"use client";

// Pemetaan produk TikTok → Aneka (Fase 1): tabel produk TikTok yang pernah
// muncul di pesanan, dengan pencarian produk Aneka per baris + formulir
// pemetaan manual untuk produk yang belum pernah ada pesanan.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link2, Search, X } from "lucide-react";

type MapRow = {
  tiktok_product_id: string;
  tiktok_product_name: string;
  tiktok_sku: string;
  aneka_product_id: string;
  aneka_variant_id: string;
  aneka_product_name: string;
  enabled: number;
  updated_at: string;
};

type SeenProduct = {
  product_id: string;
  sku_id: string;
  product_name: string;
  order_count: number;
  total_qty: number;
  last_order_at: number;
};

type CatalogHit = {
  id: string;
  name: string;
  hargaModal: string;
  rekomendasiJual: string;
  location: string;
};

type TableProduct = {
  tiktok_product_id: string;
  tiktok_product_name: string;
  order_count: number;
  total_qty: number;
  manual: boolean;
};

function wibDariEpoch(ts: number): string {
  if (!ts) return "—";
  const w = new Date((ts + 7 * 3600) * 1000);
  if (Number.isNaN(w.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(w.getUTCDate())}/${p(w.getUTCMonth() + 1)}/${w.getUTCFullYear()}`;
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

export default function AnekaMapClient({
  initialMaps,
  initialSeen,
  seenDetail,
  catalogAt,
  catalogCount,
}: {
  initialMaps: MapRow[];
  initialSeen: SeenProduct[];
  seenDetail: string;
  catalogAt: string;
  catalogCount: number;
}) {
  const [mapsById, setMapsById] = useState<Record<string, MapRow>>(() => {
    const acc: Record<string, MapRow> = {};
    for (const m of initialMaps) acc[m.tiktok_product_id] = m;
    return acc;
  });
  const [seen, setSeen] = useState<SeenProduct[]>(initialSeen);
  const [saving, setSaving] = useState<string>("");
  const [error, setError] = useState("");
  // Formulir pemetaan manual (produk TikTok yang belum ada pesanan).
  const [manualId, setManualId] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualAneka, setManualAneka] = useState<CatalogHit | null>(null);

  const sync = useCallback(async () => {
    const r = await fetch("/api/aneka-map", { cache: "no-store" });
    const data = (await r.json()) as {
      maps?: MapRow[];
      seen?: SeenProduct[];
      seenDetail?: string;
    };
    if (data.maps) {
      const acc: Record<string, MapRow> = {};
      for (const m of data.maps) acc[m.tiktok_product_id] = m;
      setMapsById(acc);
    }
    if (data.seen) setSeen(data.seen);
    if (data.seenDetail) setError(data.seenDetail);
  }, []);

  const saveMap = useCallback(
    async (tiktokProductId: string, tiktokProductName: string, hit: CatalogHit) => {
      setSaving(tiktokProductId);
      setError("");
      try {
        const r = await fetch("/api/aneka-map", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            tiktok_product_id: tiktokProductId,
            tiktok_product_name: tiktokProductName,
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
    async (tiktokProductId: string) => {
      setSaving(tiktokProductId);
      setError("");
      try {
        const r = await fetch(
          `/api/aneka-map?tiktok_product_id=${encodeURIComponent(tiktokProductId)}`,
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

  // Baris tabel = gabungan produk dari pesanan + pemetaan manual.
  const rows: TableProduct[] = [];
  const seenIds = new Set<string>();
  for (const s of seen) {
    seenIds.add(s.product_id);
    rows.push({
      tiktok_product_id: s.product_id,
      tiktok_product_name: s.product_name,
      order_count: s.order_count,
      total_qty: s.total_qty,
      manual: false,
    });
  }
  for (const m of Object.values(mapsById)) {
    if (!seenIds.has(m.tiktok_product_id)) {
      rows.push({
        tiktok_product_id: m.tiktok_product_id,
        tiktok_product_name: m.tiktok_product_name || "(tanpa nama)",
        order_count: 0,
        total_qty: 0,
        manual: true,
      });
    }
  }

  const mappedCount = Object.values(mapsById).filter((m) => m.enabled === 1).length;
  const unmappedCount = rows.filter((r) => !mapsById[r.tiktok_product_id]).length;

  const saveManual = async () => {
    if (!manualId.trim() || !manualAneka) return;
    setSaving("__manual__");
    setError("");
    try {
      const r = await fetch("/api/aneka-map", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tiktok_product_id: manualId.trim(),
          tiktok_product_name: manualName.trim(),
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
          Pasangkan produk TikTok Shop dengan produk Aneka untuk eksekusi
          pesanan otomatis (mode semi-otomatis)
        </p>
      </div>

      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <p className="font-semibold">Cara kerja</p>
        <ul className="mt-1 list-inside list-disc space-y-1 text-emerald-800">
          <li>
            Saat pesanan TikTok masuk, bot mencari produknya di tabel ini.
            Tanpa pasangan, pesanan tidak dieksekusi — Anda diberi tahu lewat
            WhatsApp.
          </li>
          <li>
            Pemetaan memakai <span className="font-mono">product_id</span>{" "}
            TikTok (terlihat di pesanan) ke ID produk Aneka.
          </li>
          <li>
            Produk di bawah muncul otomatis dari pesanan 30 hari terakhir;
            produk yang belum pernah dipesan bisa ditambahkan manual.
          </li>
        </ul>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {error}
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
          Produk dari pesanan TikTok
        </h2>
        {seenDetail ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            {seenDetail}
          </div>
        ) : null}
        {rows.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
            Belum ada produk yang terlihat dari pesanan TikTok. Pemetaan bisa
            ditambahkan manual di bawah, atau tunggu pesanan masuk.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3 font-semibold">Produk TikTok</th>
                  <th className="px-4 py-3 font-semibold">Pesanan</th>
                  <th className="px-4 py-3 font-semibold">Produk Aneka</th>
                  <th className="px-4 py-3 font-semibold">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const map = mapsById[r.tiktok_product_id];
                  return (
                    <tr key={r.tiktok_product_id} className="align-top hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">
                          {r.tiktok_product_name}
                        </div>
                        <div className="mt-0.5 font-mono text-xs text-slate-400">
                          ID {r.tiktok_product_id}
                          {r.manual ? (
                            <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                              MANUAL
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                        {r.manual ? (
                          "—"
                        ) : (
                          <>
                            {r.total_qty} pcs · {r.order_count} pesanan
                            <div className="text-xs text-slate-400">
                              terakhir{" "}
                              {wibDariEpoch(
                                seen.find((s) => s.product_id === r.tiktok_product_id)
                                  ?.last_order_at ?? 0,
                              )}
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
                                saveMap(r.tiktok_product_id, r.tiktok_product_name, h)
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
                              onClick={() => deleteMap(r.tiktok_product_id)}
                              disabled={saving === r.tiktok_product_id}
                              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:border-rose-300 hover:text-rose-600 disabled:opacity-50"
                            >
                              {saving === r.tiktok_product_id
                                ? "…"
                                : "Lepas"}
                            </button>
                          </div>
                        ) : saving === r.tiktok_product_id ? (
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
          Untuk produk TikTok yang belum pernah muncul di pesanan.{" "}
          <span className="font-mono">product_id</span> TikTok bisa dilihat di
          Seller Center → Produk, atau dari detail pesanan nanti.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <input
            type="text"
            value={manualId}
            onChange={(e) => setManualId(e.target.value)}
            placeholder="product_id TikTok (angka)"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
          />
          <input
            type="text"
            value={manualName}
            onChange={(e) => setManualName(e.target.value)}
            placeholder="Nama produk TikTok (opsional)"
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
