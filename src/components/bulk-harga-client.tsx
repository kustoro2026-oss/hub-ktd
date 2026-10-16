"use client";

// Panel "Harga Massal" untuk TikTok Shop, Blibli & Lazada — aturan bertingkat
// berbasis profit dari modal Aneka dropship (rentang profit → potong/naik
// harga Rp/%), pratinjau dengan centang manual per produk, tombol Terapkan,
// dan Reset Semua ke harga awal (snapshot otomatis sebelum perubahan massal
// pertama). Semua penulisan hanya dari klik tombol di halaman ini.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Undo2,
  Wand2,
  X,
  XCircle,
} from "lucide-react";

type Marketplace = "tiktok" | "blibli" | "lazada";

const INFO: Record<Marketplace, { nama: string; pemetaanUrl: string }> = {
  tiktok: { nama: "TikTok Shop", pemetaanUrl: "/marketplace/tiktok/pemetaan" },
  blibli: { nama: "Blibli", pemetaanUrl: "/marketplace/blibli/pemetaan" },
  lazada: { nama: "Lazada", pemetaanUrl: "/marketplace/lazada/pemetaan" },
};

type AturanApi = {
  id: string;
  posisi: number;
  minProfit: number;
  maxProfit: number | null;
  aksi: string;
  jenis: string;
  nilai: number;
  aktif: boolean;
};

type AturanDraft = {
  id: string;
  minProfit: string;
  maxProfit: string;
  aksi: "potong" | "naik";
  jenis: "rp" | "persen";
  nilai: string;
  aktif: boolean;
};

type BarisPratinjau = {
  skuKey: string;
  productName: string;
  skuLabel: string;
  hargaSekarang: number;
  hargaSekarangMax: number;
  modal: number;
  rekomendasiJual: number;
  profit: number;
  profitMax: number;
  kenaAturan: boolean;
  aksi: string;
  jenis: string;
  nilai: number;
  hargaBaru: number;
  hargaBaruMax: number;
  alasan: string;
  punyaSnapshot: boolean;
};

type PratinjauApi =
  | {
      ok: true;
      shopName?: string;
      rows: BarisPratinjau[];
      tanpaPemetaan: number;
      snapshotCount: number;
    }
  | { ok: false; detail: string };

type HasilOperasi = {
  ok: boolean;
  detail?: string;
  tersimpan?: number;
  diubah?: number;
  dipulihkan?: number;
  gagal?: { skuKey: string; label: string; detail: string }[];
  catatan?: string[];
};

function fmtRp(n: number): string {
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}

function fmtRentang(min: number, max: number): string {
  if (min === max) return fmtRp(min);
  return `${fmtRp(min)} – ${fmtRp(max)}`;
}

function fmtAksi(a: { aksi: string; jenis: string; nilai: number }): string {
  const tanda = a.aksi === "potong" ? "-" : "+";
  return a.jenis === "rp" ? `${tanda}${fmtRp(a.nilai)}` : `${tanda}${a.nilai}%`;
}

/** Draf aturan baru (contoh awal sesuai permintaan: profit ≥ 20.000 →
 *  potong Rp 2.000). */
function draftBaru(): AturanDraft {
  return {
    id: crypto.randomUUID(),
    minProfit: "20000",
    maxProfit: "",
    aksi: "potong",
    jenis: "rp",
    nilai: "2000",
    aktif: true,
  };
}

function apiKeDraft(a: AturanApi): AturanDraft {
  return {
    id: a.id,
    minProfit: String(a.minProfit ?? ""),
    maxProfit: a.maxProfit === null ? "" : String(a.maxProfit),
    aksi: a.aksi === "naik" ? "naik" : "potong",
    jenis: a.jenis === "persen" ? "persen" : "rp",
    nilai: String(a.nilai ?? ""),
    aktif: a.aktif === true,
  };
}

export default function BulkHargaClient({
  marketplace,
}: {
  marketplace: Marketplace;
}) {
  const info = INFO[marketplace];

  // ---------- Editor aturan ----------
  const [drafts, setDrafts] = useState<AturanDraft[]>([]);
  const [muatAturan, setMuatAturan] = useState<"idle" | "loading" | "error">(
    "idle",
  );
  const [pesanAturan, setPesanAturan] = useState<{ ok: boolean; teks: string }>(
    { ok: true, teks: "" },
  );
  const [simpanSedang, setSimpanSedang] = useState(false);

  // ---------- Pratinjau ----------
  const [pratinjau, setPratinjau] = useState<PratinjauApi | null>(null);
  const [muatPratinjau, setMuatPratinjau] = useState(false);
  const [errorPratinjau, setErrorPratinjau] = useState("");
  const [dipilih, setDipilih] = useState<Set<string>>(new Set());

  // ---------- Operasi ----------
  // Nilai kosong = senggang; "terapkan N/M" = progres terapkan bertahap.
  const [sibuk, setSibuk] = useState<string>("");
  const [hasil, setHasil] = useState<HasilOperasi | null>(null);

  // ---------- Toast notifikasi (pertanda operasi berhasil/gagal) ----------
  const [toast, setToast] = useState<{ ok: boolean; teks: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const munculkanToast = useCallback((ok: boolean, teks: string) => {
    setToast({ ok, teks });
  }, []);

  useEffect(() => {
    if (!toast) return;
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [toast]);

  const loadAturan = useCallback(async () => {
    setMuatAturan("loading");
    try {
      const r = await fetch(
        `/api/bulk-harga?marketplace=${marketplace}&op=aturan`,
      );
      const data = (await r.json()) as
        | { ok: true; aturan: AturanApi[] }
        | { ok: false; detail?: string };
      if (data.ok) {
        setDrafts(data.aturan.map(apiKeDraft));
        setMuatAturan("idle");
      } else {
        setMuatAturan("error");
        setPesanAturan({ ok: false, teks: data.detail ?? "Gagal memuat aturan." });
      }
    } catch {
      setMuatAturan("error");
      setPesanAturan({ ok: false, teks: "Gagal menghubungi server (jaringan)." });
    }
  }, [marketplace]);

  const loadPratinjau = useCallback(async () => {
    setMuatPratinjau(true);
    setErrorPratinjau("");
    setHasil(null);
    try {
      const r = await fetch(
        `/api/bulk-harga?marketplace=${marketplace}&op=pratinjau`,
      );
      const data = (await r.json()) as PratinjauApi;
      if (data.ok) {
        setPratinjau(data);
        setDipilih(
          new Set(data.rows.filter((b) => b.kenaAturan).map((b) => b.skuKey)),
        );
      } else {
        setPratinjau(null);
        setErrorPratinjau(data.detail);
      }
    } catch {
      setPratinjau(null);
      setErrorPratinjau("Gagal menghubungi server (jaringan).");
    } finally {
      setMuatPratinjau(false);
    }
  }, [marketplace]);

  useEffect(() => {
    void loadAturan();
  }, [loadAturan]);

  const ubahDraf = (id: string, patch: Partial<AturanDraft>) => {
    setDrafts((d) => d.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  };

  const geserDraf = (index: number, arah: -1 | 1) => {
    setDrafts((d) => {
      const j = index + arah;
      if (j < 0 || j >= d.length) return d;
      const next = [...d];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  };

  const simpanAturan = async () => {
    setPesanAturan({ ok: true, teks: "" });
    // Validasi ringan di sisi klien — validasi lengkap tetap di server.
    for (const d of drafts) {
      const min = Number(d.minProfit);
      if (!Number.isInteger(min) || min < 0) {
        setPesanAturan({
          ok: false,
          teks: "Batas profit minimum harus bilangan bulat ≥ 0.",
        });
        return;
      }
      if (d.maxProfit !== "") {
        const max = Number(d.maxProfit);
        if (!Number.isInteger(max) || max < min) {
          setPesanAturan({
            ok: false,
            teks: "Batas maksimum harus bilangan bulat ≥ batas minimum (atau kosong).",
          });
          return;
        }
      }
      const nilai = Number(d.nilai);
      if (!Number.isFinite(nilai) || nilai <= 0) {
        setPesanAturan({ ok: false, teks: "Nilai aturan harus angka > 0." });
        return;
      }
    }
    setSimpanSedang(true);
    try {
      const r = await fetch(`/api/bulk-harga`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          marketplace,
          op: "simpan-aturan",
          aturan: drafts.map((d, i) => ({
            id: d.id,
            posisi: i,
            minProfit: Number(d.minProfit),
            maxProfit: d.maxProfit === "" ? null : Number(d.maxProfit),
            aksi: d.aksi,
            jenis: d.jenis,
            nilai: Number(d.nilai),
            aktif: d.aktif,
          })),
        }),
      });
      const data = (await r.json()) as {
        ok: boolean;
        detail?: string;
        tersimpan?: number;
      };
      setPesanAturan(
        data.ok
          ? {
              ok: true,
              teks: `${data.tersimpan ?? drafts.length} aturan tersimpan — muat ulang pratinjau untuk melihat efeknya.`,
            }
          : { ok: false, teks: data.detail ?? "Gagal menyimpan aturan." },
      );
    } catch {
      setPesanAturan({ ok: false, teks: "Gagal menghubungi server (jaringan)." });
    } finally {
      setSimpanSedang(false);
    }
  };

  const terapkan = async () => {
    const jumlah = dipilih.size;
    if (jumlah === 0) return;
    const lanjut = window.confirm(
      `Terapkan aturan harga massal ke ${jumlah} produk/SKU terpilih di ${info.nama}? Harga lama tersimpan otomatis sebagai dasar Reset Semua.`,
    );
    if (!lanjut) return;
    setSibuk("terapkan");
    setHasil(null);
    try {
      // Server membatasi 60 produk per permintaan (serverless 60 detik) —
      // pilihan besar dipecah otomatis bertahap dengan indikator progres.
      const MAKS_PER_TAHAP = 60;
      const semua = [...dipilih];
      const totalTahap = Math.ceil(semua.length / MAKS_PER_TAHAP);
      let diubah = 0;
      const gagal: NonNullable<HasilOperasi["gagal"]> = [];
      const catatan: string[] = [];
      let errorTahap = "";
      for (let i = 0; i < semua.length; i += MAKS_PER_TAHAP) {
        const tahap = Math.floor(i / MAKS_PER_TAHAP) + 1;
        setSibuk(`terapkan ${tahap}/${totalTahap}`);
        const r = await fetch(`/api/bulk-harga`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            marketplace,
            op: "terapkan",
            pilihan: semua.slice(i, i + MAKS_PER_TAHAP),
          }),
        });
        const data = (await r.json()) as HasilOperasi;
        diubah += data.diubah ?? 0;
        if (Array.isArray(data.gagal)) gagal.push(...data.gagal);
        if (Array.isArray(data.catatan)) catatan.push(...data.catatan);
        // detail berisi = kegagalan keras (kredensial/jaringan pasar) —
        // hentikan, tahap berikutnya pasti gagal dengan alasan yang sama.
        if (!data.ok && data.detail) {
          errorTahap = data.detail;
          break;
        }
      }
      const hasilGabung: HasilOperasi = {
        ok: errorTahap ? false : diubah > 0 || gagal.length === 0,
        diubah,
        gagal,
        detail: errorTahap,
        catatan: [...new Set(catatan)],
      };
      setHasil(hasilGabung);
      if (hasilGabung.ok) {
        munculkanToast(
          true,
          marketplace === "blibli"
            ? `${hasilGabung.diubah ?? 0} varian dikirim ke antrean Blibli — harga berubah dalam beberapa menit.`
            : `Harga ${hasilGabung.diubah ?? 0} SKU berhasil diperbarui di ${info.nama}.`,
        );
        await loadPratinjau();
      } else {
        munculkanToast(false, hasilGabung.detail || "Terapkan gagal.");
      }
    } catch {
      setHasil({
        ok: false,
        detail: "Gagal menghubungi server (jaringan).",
      });
      munculkanToast(false, "Gagal menghubungi server (jaringan).");
    } finally {
      setSibuk("");
    }
  };

  const resetSemua = async () => {
    const jumlah = pratinjau?.ok ? pratinjau.snapshotCount : 0;
    const lanjut = window.confirm(
      `Reset SEMUA harga ke harga awal (${jumlah} baris snapshot) di ${info.nama}?`,
    );
    if (!lanjut) return;
    setSibuk("reset");
    setHasil(null);
    try {
      const r = await fetch(`/api/bulk-harga`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ marketplace, op: "reset" }),
      });
      const data = (await r.json()) as HasilOperasi;
      setHasil(data);
      if (data.ok) {
        munculkanToast(
          true,
          `${data.dipulihkan ?? 0} harga dipulihkan ke harga awal di ${info.nama}.`,
        );
        await loadPratinjau();
      } else {
        munculkanToast(false, data.detail ?? "Reset gagal.");
      }
    } catch {
      setHasil({
        ok: false,
        detail: "Gagal menghubungi server (jaringan).",
      });
      munculkanToast(false, "Gagal menghubungi server (jaringan).");
    } finally {
      setSibuk("");
    }
  };

  const jumlahKena = pratinjau?.ok
    ? pratinjau.rows.filter((b) => b.kenaAturan).length
    : 0;

  return (
    <div className="space-y-4">
      {/* Petunjuk singkat */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
        Profit dihitung dari <strong>harga jual − modal Aneka dropship</strong>{" "}
        (level produk, dari pemetaan &amp; snapshot katalog). Aturan dinilai
        berurutan dari atas — aturan pertama yang cocok menang. Harga awal
        disimpan otomatis sebelum perubahan massal pertama; tombol Reset Semua
        memulihkannya.
        {pratinjau?.ok && pratinjau.tanpaPemetaan > 0 ? (
          <span className="mt-1 block text-amber-700">
            {pratinjau.tanpaPemetaan} produk tanpa pemetaan Aneka — petakan di{" "}
            <Link
              href={info.pemetaanUrl}
              className="font-medium underline decoration-amber-400 underline-offset-2"
            >
              halaman Pemetaan
            </Link>{" "}
            supaya ikut aturan.
          </span>
        ) : null}
      </div>

      {/* ---------- Editor aturan ---------- */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">
            Aturan Harga ({drafts.length})
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDrafts((d) => [...d, draftBaru()])}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Plus className="h-4 w-4" /> Tambah Aturan
            </button>
            <button
              type="button"
              onClick={() => void loadAturan()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <RotateCcw className="h-4 w-4" /> Batal
            </button>
            <button
              type="button"
              onClick={() => void simpanAturan()}
              disabled={simpanSedang || drafts.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
            >
              {simpanSedang ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Simpan Aturan
            </button>
          </div>
        </div>

        {pesanAturan.teks ? (
          <div
            className={`mb-3 rounded-lg border px-3 py-2 text-sm ${
              pesanAturan.ok
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-rose-200 bg-rose-50 text-rose-800"
            }`}
          >
            {pesanAturan.teks}
          </div>
        ) : null}

        {muatAturan === "loading" ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Memuat aturan…
          </div>
        ) : drafts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">
            Belum ada aturan. Contoh: <strong>profit ≥ 20.000 → potong Rp
            2.000</strong> — klik Tambah Aturan, lalu sesuaikan nilainya.
          </div>
        ) : (
          <div className="space-y-2">
            {drafts.map((d, i) => (
              <div
                key={d.id}
                className={`flex flex-wrap items-center gap-2 rounded-lg border p-2.5 ${
                  d.aktif ? "border-slate-200 bg-slate-50" : "border-slate-200 bg-white opacity-60"
                }`}
              >
                <span className="w-5 text-center text-xs font-semibold text-slate-400">
                  {i + 1}
                </span>
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => geserDraf(i, -1)}
                    disabled={i === 0}
                    className="rounded p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30"
                    aria-label="Naikkan urutan"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => geserDraf(i, 1)}
                    disabled={i === drafts.length - 1}
                    className="rounded p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30"
                    aria-label="Turunkan urutan"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>
                <span className="text-xs text-slate-500">profit</span>
                <input
                  type="number"
                  min={0}
                  value={d.minProfit}
                  onChange={(e) => ubahDraf(d.id, { minProfit: e.target.value })}
                  className="w-28 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800 outline-none focus:border-emerald-500"
                  aria-label="Profit minimum"
                />
                <span className="text-xs text-slate-500">sampai</span>
                <input
                  type="number"
                  min={0}
                  value={d.maxProfit}
                  placeholder="∞"
                  onChange={(e) => ubahDraf(d.id, { maxProfit: e.target.value })}
                  className="w-28 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800 outline-none focus:border-emerald-500"
                  aria-label="Profit maksimum (kosong = tanpa batas)"
                />
                <span className="text-xs text-slate-500">→</span>
                <select
                  value={d.aksi}
                  onChange={(e) =>
                    ubahDraf(d.id, { aksi: e.target.value as "potong" | "naik" })
                  }
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800 outline-none focus:border-emerald-500"
                  aria-label="Aksi"
                >
                  <option value="potong">potong</option>
                  <option value="naik">naik</option>
                </select>
                <input
                  type="number"
                  min={1}
                  value={d.nilai}
                  onChange={(e) => ubahDraf(d.id, { nilai: e.target.value })}
                  className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800 outline-none focus:border-emerald-500"
                  aria-label="Nilai"
                />
                <select
                  value={d.jenis}
                  onChange={(e) =>
                    ubahDraf(d.id, { jenis: e.target.value as "rp" | "persen" })
                  }
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800 outline-none focus:border-emerald-500"
                  aria-label="Jenis nilai"
                >
                  <option value="rp">Rp</option>
                  <option value="persen">%</option>
                </select>
                <label className="flex items-center gap-1.5 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={d.aktif}
                    onChange={(e) => ubahDraf(d.id, { aktif: e.target.checked })}
                  />
                  aktif
                </label>
                <button
                  type="button"
                  onClick={() => setDrafts((x) => x.filter((y) => y.id !== d.id))}
                  className="ml-auto rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                  aria-label="Hapus aturan"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---------- Pratinjau ---------- */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">Pratinjau</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadPratinjau()}
              disabled={muatPratinjau}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {muatPratinjau ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="h-4 w-4" />
              )}
              Muat Pratinjau
            </button>
            <button
              type="button"
              onClick={() => void terapkan()}
              disabled={dipilih.size === 0 || sibuk !== ""}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
            >
              {sibuk.startsWith("terapkan") ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {sibuk.startsWith("terapkan ") ? sibuk : `Terapkan ke ${dipilih.size} Terpilih`}
            </button>
            <button
              type="button"
              onClick={() => void resetSemua()}
              disabled={!(pratinjau?.ok && pratinjau.snapshotCount > 0) || sibuk !== ""}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-60"
            >
              {sibuk === "reset" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Undo2 className="h-4 w-4" />
              )}
              Reset Semua ke Harga Awal
              {pratinjau?.ok ? ` (${pratinjau.snapshotCount})` : ""}
            </button>
          </div>
        </div>

        {errorPratinjau ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            {errorPratinjau}
          </div>
        ) : muatPratinjau ? (
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 p-4 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Menghitung profit dari
            katalog Aneka &amp; aturan… (bisa memakan waktu untuk Blibli)
          </div>
        ) : !pratinjau?.ok ? (
          <div className="rounded-lg border border-slate-200 p-5 text-center text-sm text-slate-500">
            Klik Muat Pratinjau untuk melihat produk yang kena aturan.
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 font-medium text-emerald-800">
                {jumlahKena} kena aturan
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 font-medium text-slate-700">
                {dipilih.size} dipilih
              </span>
              {pratinjau.shopName ? (
                <span className="text-slate-500">{pratinjau.shopName}</span>
              ) : null}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2 font-medium">Pilih</th>
                    <th className="px-3 py-2 font-medium">Produk</th>
                    <th className="px-3 py-2 font-medium">Harga Sekarang</th>
                    <th className="px-3 py-2 font-medium">Modal Aneka</th>
                    <th className="px-3 py-2 font-medium">Profit</th>
                    <th className="px-3 py-2 font-medium">Aksi</th>
                    <th className="px-3 py-2 font-medium">Harga Baru</th>
                    <th className="px-3 py-2 font-medium">Catatan</th>
                  </tr>
                </thead>
                <tbody>
                  {pratinjau.rows.map((b) => (
                    <tr
                      key={b.skuKey}
                      className={`border-b border-slate-100 last:border-b-0 ${
                        b.kenaAturan ? "" : "opacity-60"
                      } ${dipilih.has(b.skuKey) ? "bg-emerald-50/60" : "hover:bg-slate-50"}`}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={dipilih.has(b.skuKey)}
                          disabled={!b.kenaAturan}
                          onChange={(e) =>
                            setDipilih((s) => {
                              const next = new Set(s);
                              if (e.target.checked) next.add(b.skuKey);
                              else next.delete(b.skuKey);
                              return next;
                            })
                          }
                          className="h-4 w-4 accent-emerald-700"
                          aria-label={`Pilih ${b.productName}`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="line-clamp-2 font-medium text-slate-800">
                          {b.productName || "(tanpa judul)"}
                        </div>
                        <div className="text-xs text-slate-500">{b.skuLabel}</div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                        {fmtRentang(b.hargaSekarang, b.hargaSekarangMax)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                        <div>{b.modal > 0 ? fmtRp(b.modal) : "—"}</div>
                        {b.rekomendasiJual > 0 ? (
                          <div className="text-xs text-slate-400">
                            saran jual {fmtRp(b.rekomendasiJual)}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                        {b.modal > 0
                          ? fmtRentang(b.profit, b.profitMax)
                          : "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {b.kenaAturan ? (
                          <span className="rounded bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">
                            {fmtAksi(b)}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {b.kenaAturan ? (
                          <span className="font-semibold text-emerald-700">
                            {fmtRentang(b.hargaBaru, b.hargaBaruMax)}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {b.alasan ? (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                              {b.alasan}
                            </span>
                          ) : null}
                          {b.punyaSnapshot ? (
                            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800">
                              snapshot ada
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ---------- Hasil operasi ---------- */}
      {hasil ? (
        <div
          className={`rounded-xl border p-4 text-sm ${
            hasil.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-rose-200 bg-rose-50 text-rose-900"
          }`}
        >
          <div className="font-semibold">
            {hasil.ok ? "Operasi selesai." : "Operasi gagal."}{" "}
            {typeof hasil.diubah === "number"
              ? `${hasil.diubah} SKU/varian dikirim.`
              : ""}
            {typeof hasil.dipulihkan === "number"
              ? `${hasil.dipulihkan} harga dipulihkan.`
              : ""}
          </div>
          {hasil.detail ? <div className="mt-1">{hasil.detail}</div> : null}
          {hasil.catatan?.length ? (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {hasil.catatan.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          ) : null}
          {hasil.gagal?.length ? (
            <div className="mt-2">
              <div className="font-medium">Gagal ({hasil.gagal.length}):</div>
              <ul className="mt-1 max-h-56 space-y-1 overflow-y-auto pl-5">
                {hasil.gagal.map((g) => (
                  <li key={g.skuKey}>
                    <span className="font-medium">{g.label || g.skuKey}</span> —{" "}
                    {g.detail}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ---------- Toast notifikasi ---------- */}
      {toast ? (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-5 right-5 z-50 flex max-w-sm items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg ${
            toast.ok
              ? "border-emerald-300 bg-emerald-50 text-emerald-900"
              : "border-rose-300 bg-rose-50 text-rose-900"
          }`}
        >
          {toast.ok ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          ) : (
            <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
          )}
          <div className="flex-1">
            <div className="font-semibold">
              {toast.ok ? "Berhasil" : "Gagal"}
            </div>
            <div className="mt-0.5 text-slate-700">{toast.teks}</div>
          </div>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="rounded p-0.5 text-slate-400 hover:text-slate-700"
            aria-label="Tutup notifikasi"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
