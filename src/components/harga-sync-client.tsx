"use client";

// Halaman Sinkron Harga (menu Aneka, Tahap 3) — satu aksi mengubah harga
// jual produk master Aneka mendorong harga yang sama ke semua kanal tempat
// produk dipetakan: TikTok Shop (semua SKU), Blibli (semua varian), Lazada
// (SellerSku), dan KTD Store (override tabel). Pratinjau tiap kanal dimuat
// paralel dari /api/aneka/sync-harga dan digabung per produk Aneka. Snapshot
// harga awal disimpan otomatis oleh server; Reset ada di halaman massal
// masing-masing kanal.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Search } from "lucide-react";

export type MasterRowRingkas = {
  id: string;
  name: string;
  hargaModal: number;
  rekomendasiJual: number;
  stok: number;
  status: string;
};

type Channel = "tiktok" | "blibli" | "lazada" | "ktd-store";

const CHANNELS: { key: Channel; nama: string }[] = [
  { key: "tiktok", nama: "TikTok Shop" },
  { key: "blibli", nama: "Blibli" },
  { key: "lazada", nama: "Lazada" },
  { key: "ktd-store", nama: "KTD Store" },
];

/** Harga kanal per produk Aneka: jumlah SKU + rentang harga saat ini. */
type InfoKanal = {
  count: number;
  min: number;
  max: number;
};

type KanalState =
  | { state: "idle" | "loading" }
  | { state: "ok"; byAneka: Map<string, InfoKanal> }
  | { state: "error"; detail: string };

type GagalItem = { skuKey: string; label: string; detail: string };

type HasilKanal = {
  diubah: number;
  gagal: GagalItem[];
  catatan: string[];
};

const KANAL_KOSONG: Record<Channel, KanalState> = {
  tiktok: { state: "idle" },
  blibli: { state: "idle" },
  lazada: { state: "idle" },
  "ktd-store": { state: "idle" },
};

function fmtRp(n: number): string {
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}

export default function HargaSyncClient({
  rows,
  meta,
}: {
  rows: MasterRowRingkas[];
  meta: { generatedAt: string; scanned: number };
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"semua" | "terpetakan">("terpetakan");
  const [sortKey, setSortKey] = useState<"nama" | "profit" | "stok">("nama");
  const [targets, setTargets] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const r of rows) {
      out[r.id] = r.rekomendasiJual > 0 ? String(r.rekomendasiJual) : "";
    }
    return out;
  });
  const [kanal, setKanal] = useState<Record<Channel, KanalState>>(KANAL_KOSONG);
  const [dipilih, setDipilih] = useState<Set<string>>(new Set());
  const [sibuk, setSibuk] = useState("");
  const [hasil, setHasil] = useState<Record<Channel, HasilKanal> | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; teks: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!toast) return;
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [toast]);

  const infoKanal = (ch: Channel, id: string): InfoKanal | null => {
    const k = kanal[ch];
    return k.state === "ok" ? (k.byAneka.get(id) ?? null) : null;
  };

  const muatPratinjau = useCallback(async () => {
    setHasil(null);
    await Promise.all(
      CHANNELS.map(async ({ key }) => {
        setKanal((s) => ({ ...s, [key]: { state: "loading" } }));
        try {
          const r = await fetch(
            `/api/aneka/sync-harga?op=pratinjau&channel=${key}`,
          );
          const data = (await r.json()) as
            | { ok: true; rows: { anekaId: string; hargaSekarang: number; hargaSekarangMax: number }[] }
            | { ok: false; detail?: string };
          if (data.ok) {
            const byAneka = new Map<string, InfoKanal>();
            for (const row of data.rows) {
              if (!row.anekaId) continue;
              const cur = byAneka.get(row.anekaId);
              if (!cur) {
                byAneka.set(row.anekaId, {
                  count: 1,
                  min: row.hargaSekarang,
                  max: row.hargaSekarangMax,
                });
              } else {
                cur.count += 1;
                cur.min = Math.min(cur.min, row.hargaSekarang);
                cur.max = Math.max(cur.max, row.hargaSekarangMax);
              }
            }
            setKanal((s) => ({ ...s, [key]: { state: "ok", byAneka } }));
          } else {
            setKanal((s) => ({
              ...s,
              [key]: { state: "error", detail: data.detail ?? "Gagal memuat pratinjau." },
            }));
          }
        } catch {
          setKanal((s) => ({
            ...s,
            [key]: { state: "error", detail: "Gagal menghubungi server (jaringan)." },
          }));
        }
      }),
    );
  }, []);

  useEffect(() => {
    void muatPratinjau();
  }, [muatPratinjau]);

  const hargaValid = (id: string): number => {
    const n = Math.round(Number(targets[id] ?? ""));
    return Number.isFinite(n) && n >= 1 ? n : 0;
  };

  const tersaring = useMemo(() => {
    const kueri = q.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (kueri && !r.name.toLowerCase().includes(kueri) && !r.id.includes(kueri)) {
        return false;
      }
      if (filter === "terpetakan") {
        const ada = CHANNELS.some(({ key }) => infoKanal(key, r.id) !== null);
        if (!ada) return false;
      }
      return true;
    });
    out = [...out].sort((a, b) => {
      if (sortKey === "nama") return a.name.localeCompare(b.name, "id");
      if (sortKey === "stok") return b.stok - a.stok;
      const pa = hargaValid(a.id) - a.hargaModal;
      const pb = hargaValid(b.id) - b.hargaModal;
      return pb - pa;
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, filter, sortKey, targets, kanal]);

  const semuaTerpilih = tersaring.length > 0 && tersaring.every((r) => dipilih.has(r.id));
  const jumlahDipilih = tersaring.filter((r) => dipilih.has(r.id)).length;
  const jumlahTerpetakan = useMemo(
    () =>
      rows.filter((r) => CHANNELS.some(({ key }) => infoKanal(key, r.id) !== null))
        .length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, kanal],
  );

  const terapkan = async () => {
    const daftar = tersaring
      .filter((r) => dipilih.has(r.id))
      .map((r) => ({ anekaId: r.id, harga: hargaValid(r.id) }))
      .filter((p) => p.harga > 0);
    if (daftar.length === 0) {
      setToast({ ok: false, teks: "Pilih produk dengan harga target yang valid." });
      return;
    }
    const channelTerlibat = CHANNELS.filter(({ key }) =>
      daftar.some((p) => infoKanal(key, p.anekaId) !== null),
    );
    if (channelTerlibat.length === 0) {
      setToast({
        ok: false,
        teks: "Produk terpilih belum dipetakan ke kanal mana pun.",
      });
      return;
    }
    const yakin = window.confirm(
      `Terapkan harga ${daftar.length} produk ke ${channelTerlibat
        .map((c) => c.nama)
        .join(", ")}?\n\nHarga target yang sama akan didorong ke SEMUA SKU/varian produk di tiap kanal. Snapshot harga awal tersimpan otomatis (bisa di-reset di halaman massal tiap kanal).`,
    );
    if (!yakin) return;

    const agregat: Record<Channel, HasilKanal> = {
      tiktok: { diubah: 0, gagal: [], catatan: [] },
      blibli: { diubah: 0, gagal: [], catatan: [] },
      lazada: { diubah: 0, gagal: [], catatan: [] },
      "ktd-store": { diubah: 0, gagal: [], catatan: [] },
    };
    const CHUNK = 60;
    let selesai = 0;
    for (let i = 0; i < daftar.length; i += CHUNK) {
      const chunk = daftar.slice(i, i + CHUNK);
      selesai += chunk.length;
      setSibuk(`terapkan ${selesai}/${daftar.length}`);
      await Promise.all(
        channelTerlibat.map(async ({ key }) => {
          const kirim = chunk.filter((p) => infoKanal(key, p.anekaId) !== null);
          if (kirim.length === 0) return;
          try {
            const r = await fetch("/api/aneka/sync-harga", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ op: "terapkan", channel: key, pilihan: kirim }),
            });
            const data = (await r.json()) as {
              ok: boolean;
              diubah?: number;
              gagal?: GagalItem[];
              detail?: string;
              catatan?: string[];
            };
            agregat[key].diubah += data.diubah ?? 0;
            agregat[key].catatan.push(...(data.catatan ?? []));
            for (const g of data.gagal ?? []) agregat[key].gagal.push(g);
            if (!data.ok && !data.diubah && !(data.gagal ?? []).length) {
              agregat[key].gagal.push({
                skuKey: "",
                label: key,
                detail: data.detail ?? "Gagal terapkan.",
              });
            }
          } catch {
            agregat[key].gagal.push({
              skuKey: "",
              label: key,
              detail: "Gagal menghubungi server (jaringan).",
            });
          }
        }),
      );
    }
    setSibuk("");
    setHasil(agregat);
    const totalUbah = Object.values(agregat).reduce((a, b) => a + b.diubah, 0);
    const totalGagal = Object.values(agregat).reduce((a, b) => a + b.gagal.length, 0);
    setToast({
      ok: totalGagal === 0,
      teks:
        totalGagal === 0
          ? `Selesai: ${totalUbah} harga diperbarui di semua kanal.`
          : `Selesai: ${totalUbah} berubah, ${totalGagal} gagal — lihat rincian di bawah.`,
    });
    setDipilih(new Set());
    void muatPratinjau();
  };

  const muatSemua = Object.values(kanal).some((k) => k.state === "loading");
  const adaErrorKanal = CHANNELS.filter(({ key }) => kanal[key].state === "error");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 font-medium text-emerald-800">
          {meta.scanned} produk master
        </span>
        <span className="rounded-full bg-sky-100 px-2.5 py-0.5 font-medium text-sky-800">
          {jumlahTerpetakan} terpetakan ke kanal
        </span>
        {CHANNELS.map(({ key, nama }) => {
          const k = kanal[key];
          if (k.state === "ok") {
            return (
              <span key={key} className="rounded-full bg-slate-100 px-2.5 py-0.5 font-medium text-slate-600">
                {nama}: {k.byAneka.size} produk
              </span>
            );
          }
          return null;
        })}
        {meta.generatedAt ? (
          <span className="text-slate-400">master {meta.generatedAt}</span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari nama / id produk…"
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-800 outline-none focus:border-emerald-500"
          />
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as "semua" | "terpetakan")}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-500"
        >
          <option value="terpetakan">Hanya yang terpetakan</option>
          <option value="semua">Semua produk master</option>
        </select>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as "nama" | "profit" | "stok")}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-500"
        >
          <option value="nama">Urut: nama A-Z</option>
          <option value="profit">Urut: profit target</option>
          <option value="stok">Urut: stok terbanyak</option>
        </select>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => void muatPratinjau()}
            disabled={muatSemua || sibuk !== ""}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${muatSemua ? "animate-spin" : ""}`} />
            Muat ulang
          </button>
          <button
            type="button"
            onClick={() => void terapkan()}
            disabled={sibuk !== "" || jumlahDipilih === 0}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {sibuk ? sibuk : `Terapkan ke semua kanal${jumlahDipilih ? ` (${jumlahDipilih})` : ""}`}
          </button>
        </div>
      </div>

      {adaErrorKanal.length > 0 ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {adaErrorKanal.map(({ key, nama }) => {
            const k = kanal[key];
            return k.state === "error" ? (
              <div key={key}>
                <span className="font-semibold">{nama}:</span> {k.detail}
              </div>
            ) : null;
          })}
          <div className="pt-1 text-red-600">
            Kanal yang gagal dimuat tidak ikut diubah saat Terapkan.
          </div>
        </div>
      ) : null}

      {hasil ? (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
          <div className="text-sm font-semibold text-slate-800">Hasil Terapkan</div>
          {CHANNELS.map(({ key, nama }) => {
            const h = hasil[key];
            return (
              <div key={key} className="text-xs">
                <span className="font-semibold text-slate-700">{nama}:</span>{" "}
                <span className="font-medium text-emerald-700">{h.diubah} berubah</span>
                {h.catatan.length > 0 ? (
                  <div className="text-slate-500">{h.catatan.join(" ")}</div>
                ) : null}
                {h.gagal.length > 0 ? (
                  <div className="mt-1 max-h-32 space-y-0.5 overflow-y-auto rounded bg-red-50 px-2 py-1.5 text-red-700">
                    {h.gagal.slice(0, 10).map((g, i) => (
                      <div key={i}>
                        <span className="font-medium">{g.label || g.skuKey}</span>: {g.detail}
                      </div>
                    ))}
                    {h.gagal.length > 10 ? (
                      <div className="text-red-500">… dan {h.gagal.length - 10} lainnya</div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[1100px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2 font-medium">
                <input
                  type="checkbox"
                  checked={semuaTerpilih}
                  onChange={(e) => {
                    setDipilih(
                      e.target.checked
                        ? new Set(tersaring.map((r) => r.id))
                        : new Set(),
                    );
                  }}
                  className="h-4 w-4 accent-emerald-600"
                  aria-label="Pilih semua"
                />
              </th>
              <th className="px-3 py-2 font-medium">Produk</th>
              <th className="px-3 py-2 font-medium">Harga Target</th>
              <th className="px-3 py-2 font-medium">Profit</th>
              <th className="px-3 py-2 font-medium">TikTok Shop</th>
              <th className="px-3 py-2 font-medium">Blibli</th>
              <th className="px-3 py-2 font-medium">Lazada</th>
              <th className="px-3 py-2 font-medium">KTD Store</th>
            </tr>
          </thead>
          <tbody>
            {tersaring.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                  Tidak ada produk yang cocok dengan saringan.
                </td>
              </tr>
            ) : (
              tersaring.map((r) => {
                const targetN = hargaValid(r.id);
                const profit = r.hargaModal > 0 && targetN > 0 ? targetN - r.hargaModal : 0;
                return (
                  <tr key={r.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={dipilih.has(r.id)}
                        onChange={(e) =>
                          setDipilih((s) => {
                            const n = new Set(s);
                            if (e.target.checked) n.add(r.id);
                            else n.delete(r.id);
                            return n;
                          })
                        }
                        className="h-4 w-4 accent-emerald-600"
                        aria-label={`Pilih ${r.name}`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="line-clamp-2 max-w-[320px] font-medium text-slate-800">
                        {r.name}
                      </div>
                      <div className="text-xs text-slate-500">
                        Aneka #{r.id}
                        {r.status === "404" ? (
                          <span className="ml-1 rounded bg-red-100 px-1 py-0.5 text-[10px] font-medium text-red-700">
                            404
                          </span>
                        ) : null}
                        {r.hargaModal > 0 ? (
                          <span className="ml-1 text-slate-400">modal {fmtRp(r.hargaModal)}</span>
                        ) : (
                          <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-700">
                            tanpa modal
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={targets[r.id] ?? ""}
                        onChange={(e) =>
                          setTargets((s) => ({ ...s, [r.id]: e.target.value }))
                        }
                        className={`w-28 rounded-lg border px-2 py-1.5 text-sm text-slate-800 outline-none focus:border-emerald-500 ${
                          targetN > 0 ? "border-slate-300 bg-white" : "border-amber-300 bg-amber-50"
                        }`}
                        aria-label={`Harga target ${r.name}`}
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {profit > 0 ? (
                        <span className="font-semibold text-emerald-700">{fmtRp(profit)}</span>
                      ) : targetN > 0 && r.hargaModal > 0 ? (
                        <span className="font-semibold text-red-600">rugi {fmtRp(-profit)}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    {CHANNELS.map(({ key, nama }) => {
                      const k = kanal[key];
                      const info = infoKanal(key, r.id);
                      return (
                        <td key={key} className="whitespace-nowrap px-3 py-2 text-xs">
                          {info ? (
                            <div>
                              <div className="font-semibold text-slate-700">
                                {fmtRp(info.min)}
                                {info.max !== info.min ? `–${fmtRp(info.max)}` : ""}
                              </div>
                              <div className="text-slate-400">
                                {info.count} SKU
                                {targetN > 0 && targetN !== info.min ? (
                                  <span className={targetN > info.min ? "ml-1 text-emerald-600" : "ml-1 text-red-600"}>
                                    → {fmtRp(targetN)}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          ) : k.state === "loading" || k.state === "idle" ? (
                            <span className="text-slate-400">…</span>
                          ) : k.state === "error" ? (
                            <span className="rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-700" title={k.detail}>
                              gagal muat
                            </span>
                          ) : (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-400" title={`Belum dipetakan ke ${nama}`}>
                              belum dipetakan
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {toast ? (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg bg-slate-900 px-4 py-3 text-sm text-white shadow-lg">
          {toast.teks}
        </div>
      ) : null}
    </div>
  );
}
