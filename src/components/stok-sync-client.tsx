"use client";

// Halaman Sinkron Stok (menu Aneka, Tahap 4) — satu aksi menetapkan target
// stok produk master Aneka mendorong stok yang sama ke semua kanal tempat
// produk dipetakan: TikTok Shop (semua SKU), Blibli (semua varian), Lazada
// (SellerSku), dan KTD Store (override tabel). Pratinjau tiap kanal dimuat
// paralel dari /api/aneka/sync-stok dan dijumlahkan per produk Aneka.
// Bagian bawah menampilkan riwayat penyesuaian stok otomatis (order selesai
// → kurangi semua kanal lain) plus tombol menjalankan pengecekan sekarang.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { History, PlayCircle, RefreshCw, Search } from "lucide-react";

export type StokRowRingkas = {
  id: string;
  name: string;
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

/** Stok kanal per produk Aneka: jumlah listing + total stok saat ini. */
type InfoKanal = {
  count: number;
  stok: number;
};

type KanalState =
  | { state: "idle" | "loading" }
  | { state: "ok"; byAneka: Map<string, InfoKanal> }
  | { state: "error"; detail: string };

type GagalItem = { key: string; label: string; detail: string };

type HasilKanal = {
  diubah: number;
  gagal: GagalItem[];
  catatan: string[];
};

type RiwayatRow = {
  id: string;
  channel: string;
  order_id: string;
  sku_key: string;
  aneka_id: string;
  nama: string;
  qty: number;
  tiktok_done: number;
  blibli_done: number;
  lazada_done: number;
  ktd_done: number;
  detail: string;
  created_at: string;
};

type HasilCek = {
  ok: boolean;
  detail: string;
  eventBaru: number;
  diterapkan: Record<string, number>;
  gagalKanal: string[];
};

const KANAL_KOSONG: Record<Channel, KanalState> = {
  tiktok: { state: "idle" },
  blibli: { state: "idle" },
  lazada: { state: "idle" },
  "ktd-store": { state: "idle" },
};

const KANAL_PENDEK: Record<string, string> = {
  tiktok: "TikTok",
  blibli: "Blibli",
  lazada: "Lazada",
  ktd: "KTD",
};

export default function StokSyncClient({
  rows,
  meta,
}: {
  rows: StokRowRingkas[];
  meta: { generatedAt: string; scanned: number };
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"semua" | "terpetakan">("terpetakan");
  const [sortKey, setSortKey] = useState<"nama" | "stok">("nama");
  const [targets, setTargets] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const r of rows) {
      out[r.id] = r.stok > 0 ? String(r.stok) : "0";
    }
    return out;
  });
  const [kanal, setKanal] = useState<Record<Channel, KanalState>>(KANAL_KOSONG);
  const [dipilih, setDipilih] = useState<Set<string>>(new Set());
  const [sibuk, setSibuk] = useState("");
  const [hasil, setHasil] = useState<Record<Channel, HasilKanal> | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; teks: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Riwayat penyesuaian otomatis + tombol cek sekarang.
  const [riwayat, setRiwayat] = useState<RiwayatRow[] | null>(null);
  const [riwayatError, setRiwayatError] = useState("");
  const [cekSibuk, setCekSibuk] = useState(false);
  const [cekHasil, setCekHasil] = useState<HasilCek | null>(null);

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
            `/api/aneka/sync-stok?op=pratinjau&channel=${key}`,
          );
          const data = (await r.json()) as
            | { ok: true; rows: { anekaId: string; productName: string; stok: number }[] }
            | { ok: false; detail?: string };
          if (data.ok) {
            const byAneka = new Map<string, InfoKanal>();
            for (const row of data.rows) {
              if (!row.anekaId) continue;
              const cur = byAneka.get(row.anekaId);
              if (!cur) {
                byAneka.set(row.anekaId, { count: 1, stok: Number(row.stok) || 0 });
              } else {
                cur.count += 1;
                cur.stok += Number(row.stok) || 0;
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

  const muatRiwayat = useCallback(async () => {
    setRiwayatError("");
    try {
      const r = await fetch("/api/aneka/sync-stok?op=riwayat");
      const data = (await r.json()) as
        | { ok: true; rows: RiwayatRow[] }
        | { ok: false; detail?: string };
      if (data.ok) {
        setRiwayat(data.rows);
      } else {
        setRiwayatError(data.detail ?? "Gagal memuat riwayat.");
      }
    } catch {
      setRiwayatError("Gagal menghubungi server (jaringan).");
    }
  }, []);

  useEffect(() => {
    void muatPratinjau();
    void muatRiwayat();
  }, [muatPratinjau, muatRiwayat]);

  const stokValid = (id: string): number => {
    const n = Math.round(Number(targets[id] ?? ""));
    return Number.isFinite(n) && n >= 0 ? n : -1;
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
      return b.stok - a.stok;
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
      .map((r) => ({ anekaId: r.id, stok: stokValid(r.id) }))
      .filter((p) => p.stok >= 0);
    if (daftar.length === 0) {
      setToast({ ok: false, teks: "Pilih produk dengan stok target yang valid." });
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
      `Terapkan stok ${daftar.length} produk ke ${channelTerlibat
        .map((c) => c.nama)
        .join(", ")}?\n\nStok target yang sama akan didorong ke SEMUA SKU/varian produk di tiap kanal. Stok 0 berarti produk ditandai habis di kanal itu.`,
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
            const r = await fetch("/api/aneka/sync-stok", {
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
                key: "",
                label: key,
                detail: data.detail ?? "Gagal terapkan.",
              });
            }
          } catch {
            agregat[key].gagal.push({
              key: "",
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
          ? `Selesai: ${totalUbah} stok diperbarui di semua kanal.`
          : `Selesai: ${totalUbah} berubah, ${totalGagal} gagal — lihat rincian di bawah.`,
    });
    setDipilih(new Set());
    void muatPratinjau();
  };

  /** Jalankan pengecekan order selesai sekarang (sama seperti tick otomatis). */
  const cekSekarang = async () => {
    const yakin = window.confirm(
      "Cek order selesai sekarang?\n\nPesanan selesai yang belum dicatat akan dikurangi stoknya di semua kanal LAIN (kanal asal sudah berkurang otomatis).",
    );
    if (!yakin) return;
    setCekSibuk(true);
    setCekHasil(null);
    try {
      const r = await fetch("/api/aneka/stok/check", { method: "POST" });
      const data = (await r.json()) as HasilCek & { error?: string };
      if (data.error) {
        setCekHasil({ ok: false, detail: data.error, eventBaru: 0, diterapkan: {}, gagalKanal: [] });
      } else {
        setCekHasil(data);
      }
    } catch {
      setCekHasil({
        ok: false,
        detail: "Gagal menghubungi server (jaringan).",
        eventBaru: 0,
        diterapkan: {},
        gagalKanal: [],
      });
    }
    setCekSibuk(false);
    void muatRiwayat();
    void muatPratinjau();
  };

  const muatSemua = Object.values(kanal).some((k) => k.state === "loading");
  const adaErrorKanal = CHANNELS.filter(({ key }) => kanal[key].state === "error");

  const chipKanal = (done: number) =>
    done === 1 ? (
      <span className="text-emerald-600" title="sudah diterapkan">✓</span>
    ) : (
      <span className="text-slate-300" title="belum diterapkan">·</span>
    );

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
          onChange={(e) => setSortKey(e.target.value as "nama" | "stok")}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-500"
        >
          <option value="nama">Urut: nama A-Z</option>
          <option value="stok">Urut: stok master terbanyak</option>
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
                        <span className="font-medium">{g.label || g.key}</span>: {g.detail}
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
        <table className="w-full min-w-[1000px] text-left text-sm">
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
              <th className="px-3 py-2 font-medium">Stok Master</th>
              <th className="px-3 py-2 font-medium">Stok Target</th>
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
                const targetN = stokValid(r.id);
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
                      <div className="line-clamp-2 max-w-[300px] font-medium text-slate-800">
                        {r.name}
                      </div>
                      <div className="text-xs text-slate-500">
                        Aneka #{r.id}
                        {r.status === "404" ? (
                          <span className="ml-1 rounded bg-red-100 px-1 py-0.5 text-[10px] font-medium text-red-700">
                            404
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                      {r.stok}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={targets[r.id] ?? ""}
                        onChange={(e) =>
                          setTargets((s) => ({ ...s, [r.id]: e.target.value }))
                        }
                        className={`w-24 rounded-lg border px-2 py-1.5 text-sm text-slate-800 outline-none focus:border-emerald-500 ${
                          targetN >= 0 ? "border-slate-300 bg-white" : "border-amber-300 bg-amber-50"
                        }`}
                        aria-label={`Stok target ${r.name}`}
                      />
                    </td>
                    {CHANNELS.map(({ key, nama }) => {
                      const k = kanal[key];
                      const info = infoKanal(key, r.id);
                      return (
                        <td key={key} className="whitespace-nowrap px-3 py-2 text-xs">
                          {info ? (
                            <div>
                              <div
                                className={`font-semibold ${
                                  info.stok === 0 ? "text-red-600" : "text-slate-700"
                                }`}
                              >
                                {info.stok}
                              </div>
                              <div className="text-slate-400">
                                {info.count} listing
                                {targetN >= 0 && targetN !== info.stok ? (
                                  <span
                                    className={
                                      targetN > info.stok
                                        ? "ml-1 text-emerald-600"
                                        : "ml-1 text-red-600"
                                    }
                                  >
                                    → {targetN}
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

      {/* Riwayat penyesuaian stok otomatis (hook order selesai). */}
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <History className="h-4 w-4 text-slate-500" />
          <span className="text-sm font-semibold text-slate-800">
            Riwayat Penyesuaian Otomatis
          </span>
          <span className="text-xs text-slate-400">
            order selesai → stok berkurang di kanal lain (kanal asal otomatis)
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => void cekSekarang()}
              disabled={cekSibuk}
              className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
            >
              <PlayCircle className="h-4 w-4" />
              {cekSibuk ? "Mengecek…" : "Cek Order Selesai Sekarang"}
            </button>
            <button
              type="button"
              onClick={() => void muatRiwayat()}
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Muat ulang
            </button>
          </div>
        </div>

        {cekHasil ? (
          <div
            className={`mt-2 rounded-lg px-3 py-2 text-xs ${
              cekHasil.ok
                ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border border-amber-200 bg-amber-50 text-amber-800"
            }`}
          >
            <div className="font-semibold">Hasil pengecekan:</div>
            <div>{cekHasil.detail}</div>
            {cekHasil.eventBaru > 0 ? <div>{cekHasil.eventBaru} kejadian baru dicatat.</div> : null}
            {Object.entries(cekHasil.diterapkan).some(([, v]) => v > 0) ? (
              <div>
                Diterapkan:{" "}
                {Object.entries(cekHasil.diterapkan)
                  .filter(([, v]) => v > 0)
                  .map(([k, v]) => `${KANAL_PENDEK[k] ?? k} ${v}`)
                  .join(", ")}
              </div>
            ) : null}
            {cekHasil.gagalKanal.length > 0 ? (
              <div className="text-amber-700">
                Gagal (dicoba lagi tick berikut): {cekHasil.gagalKanal.join("; ")}
              </div>
            ) : null}
          </div>
        ) : null}

        {riwayatError ? (
          <div className="mt-2 rounded bg-red-50 px-3 py-2 text-xs text-red-700">
            {riwayatError}
          </div>
        ) : null}

        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-400">
                <th className="px-2 py-1.5 font-medium">Waktu (UTC)</th>
                <th className="px-2 py-1.5 font-medium">Kanal Asal</th>
                <th className="px-2 py-1.5 font-medium">Produk</th>
                <th className="px-2 py-1.5 font-medium">Qty</th>
                <th className="px-2 py-1.5 font-medium text-center">TikTok</th>
                <th className="px-2 py-1.5 font-medium text-center">Blibli</th>
                <th className="px-2 py-1.5 font-medium text-center">Lazada</th>
                <th className="px-2 py-1.5 font-medium text-center">KTD</th>
                <th className="px-2 py-1.5 font-medium">Rincian</th>
              </tr>
            </thead>
            <tbody>
              {!riwayat ? (
                <tr>
                  <td colSpan={9} className="px-2 py-4 text-center text-slate-400">
                    Memuat riwayat…
                  </td>
                </tr>
              ) : riwayat.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-2 py-4 text-center text-slate-400">
                    Belum ada penyesuaian otomatis. Kejadian muncul setelah ada
                    order selesai yang produknya terpetakan.
                  </td>
                </tr>
              ) : (
                riwayat.slice(0, 20).map((rw) => (
                  <tr key={rw.id} className="border-b border-slate-100 last:border-b-0">
                    <td className="whitespace-nowrap px-2 py-1.5 text-slate-500">
                      {rw.created_at ? rw.created_at.slice(0, 16) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <span
                        className={`rounded px-1.5 py-0.5 font-medium ${
                          rw.channel === "tiktok"
                            ? "bg-slate-900 text-white"
                            : rw.channel === "blibli"
                              ? "bg-blue-100 text-blue-800"
                              : rw.channel === "lazada"
                                ? "bg-orange-100 text-orange-800"
                                : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {KANAL_PENDEK[rw.channel] ?? rw.channel}
                      </span>
                    </td>
                    <td className="max-w-[260px] px-2 py-1.5">
                      <div className="truncate text-slate-700" title={rw.nama || rw.aneka_id}>
                        {rw.nama || `Aneka #${rw.aneka_id}`}
                      </div>
                      <div className="text-[10px] text-slate-400">{rw.order_id}</div>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 font-semibold text-red-600">
                      −{rw.qty}
                    </td>
                    <td className="px-2 py-1.5 text-center">{chipKanal(rw.tiktok_done)}</td>
                    <td className="px-2 py-1.5 text-center">{chipKanal(rw.blibli_done)}</td>
                    <td className="px-2 py-1.5 text-center">{chipKanal(rw.lazada_done)}</td>
                    <td className="px-2 py-1.5 text-center">{chipKanal(rw.ktd_done)}</td>
                    <td className="max-w-[280px] px-2 py-1.5 text-slate-500">
                      <div className="truncate" title={rw.detail || ""}>
                        {rw.detail || "—"}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {toast ? (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg bg-slate-900 px-4 py-3 text-sm text-white shadow-lg">
          {toast.teks}
        </div>
      ) : null}
    </div>
  );
}
