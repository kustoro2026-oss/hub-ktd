"use client";

// Komponen Cek Aturan (Tahap 5) — memeriksa seluruh produk master Aneka
// terhadap rule engine 2 lapis (umum + per marketplace) secara lokal di
// browser (aturan-produk.ts murni). Fitur: kartu ringkasan, filter status/
// kanal/cari, tabel verdict per kanal dengan detail temuan yang bisa
// dibuka, dan kotak uji teks bebas.
import { useMemo, useState } from "react";
import {
  Ban,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  Eye,
  FlaskConical,
  Search,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import {
  cekAturanProduk,
  DAFTAR_KANAL,
  LABEL_KANAL,
  ringkasHasil,
  type HasilCekAturan,
  type KanalPasar,
  type StatusAturan,
  type StatusPerKanal,
} from "@/lib/aturan-produk";

export type BarisAturan = {
  id: string;
  name: string;
  kategori: string;
  status: string;
};

type Meta = {
  generatedAt: string;
  scanned: number;
  withVariants: number;
  totalVariants: number;
  status404: number;
  stokHabis: number;
};

const KANAL_PENDEK: Record<KanalPasar, string> = {
  tiktok: "TT",
  blibli: "BL",
  lazada: "LZ",
};

const URUT_STATUS: StatusAturan[] = ["blokir", "review", "perhatian", "aman"];

const GAYA_STATUS: Record<StatusAturan, string> = {
  aman: "border-emerald-200 bg-emerald-50 text-emerald-700",
  perhatian: "border-yellow-200 bg-yellow-50 text-yellow-700",
  review: "border-amber-200 bg-amber-50 text-amber-700",
  blokir: "border-red-200 bg-red-50 text-red-700",
};

const LABEL_STATUS: Record<StatusAturan, string> = {
  aman: "Aman",
  perhatian: "Perhatian",
  review: "Review",
  blokir: "Blokir",
};

const IKON_STATUS: Record<StatusAturan, typeof CircleCheck> = {
  aman: CircleCheck,
  perhatian: TriangleAlert,
  review: Eye,
  blokir: Ban,
};

function ChipStatus({ status, kecil = false }: { status: StatusAturan; kecil?: boolean }) {
  const Ikon = IKON_STATUS[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium ${GAYA_STATUS[status]} ${
        kecil ? "text-[10px]" : "text-xs"
      }`}
    >
      <Ikon className={kecil ? "h-3 w-3" : "h-3.5 w-3.5"} />
      {LABEL_STATUS[status]}
    </span>
  );
}

function ChipKanal({ kanal, status }: { kanal: KanalPasar; status: StatusAturan }) {
  return (
    <span
      title={`${LABEL_KANAL[kanal]}: ${LABEL_STATUS[status]}`}
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${GAYA_STATUS[status]}`}
    >
      {KANAL_PENDEK[kanal]}
      {status !== "aman" ? `·${status === "perhatian" ? "!" : status === "review" ? "R" : "X"}` : ""}
    </span>
  );
}

function KartuStat({ label, nilai, warna }: { label: string; nilai: number; warna: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${warna}`}>{nilai}</p>
    </div>
  );
}

function PanelTemuan({ hasil }: { hasil: HasilCekAturan }) {
  if (hasil.jumlahTemuan === 0) {
    return (
      <p className="text-xs text-emerald-600">
        Tidak ada temuan — aman untuk semua kanal.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {hasil.temuan.map((t, i) => (
        <li key={`${t.kode}-${i}`} className="rounded-md border border-slate-200 bg-slate-50 p-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] font-bold text-white">
              {t.kode}
            </span>
            <ChipStatus status={t.status} kecil />
            <span className="font-mono text-[11px] text-slate-500">
              pemicu: “{t.pemicu}”
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-700">{t.aturan}</p>
          <p className="text-[11px] text-slate-400">Sumber: {t.sumber}</p>
        </li>
      ))}
    </ul>
  );
}

function PanelUji({ nama }: { nama: string }) {
  const hasil = cekAturanProduk(nama);
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-slate-700">Hasil uji:</span>
        <ChipStatus status={hasil.keseluruhan} />
        {DAFTAR_KANAL.map((k) => (
          <ChipKanal key={k} kanal={k} status={hasil.perKanal[k]} />
        ))}
      </div>
      <PanelTemuan hasil={hasil} />
    </div>
  );
}

export default function AturanClient({ rows, meta }: { rows: BarisAturan[]; meta: Meta }) {
  const [q, setQ] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterKanal, setFilterKanal] = useState("");
  const [hanyaBermasalah, setHanyaBermasalah] = useState(true);
  const [buka, setBuka] = useState<string | null>(null);
  const [teksUji, setTeksUji] = useState("");
  const [hasilUji, setHasilUji] = useState<string | null>(null);

  // Hitung sekali; murni regex pada nama sehingga cepat.
  const terperiksa = useMemo(() => {
    const hasil = rows.map((r) => ({
      ...r,
      hasil: cekAturanProduk(r.name, r.kategori),
    }));
    hasil.sort((a, b) => {
      const sa = URUT_STATUS.indexOf(a.hasil.keseluruhan);
      const sb = URUT_STATUS.indexOf(b.hasil.keseluruhan);
      if (sa !== sb) return sa - sb;
      return a.name.localeCompare(b.name);
    });
    return hasil;
  }, [rows]);

  const ringkasan = useMemo(() => ringkasHasil(terperiksa.map((t) => t.hasil)), [terperiksa]);

  const terfilter = useMemo(() => {
    const kata = q.trim().toLowerCase();
    return terperiksa.filter((t) => {
      if (kata && !t.name.toLowerCase().includes(kata) && !t.id.includes(kata)) return false;
      const status =
        filterKanal === "" ? t.hasil.keseluruhan : t.hasil.perKanal[filterKanal as KanalPasar];
      if (filterStatus && status !== filterStatus) return false;
      if (hanyaBermasalah && status === "aman") return false;
      return true;
    });
  }, [terperiksa, q, filterStatus, filterKanal, hanyaBermasalah]);

  const hitungKanal = (kanal: KanalPasar, status: StatusAturan) =>
    ringkasan.perKanal[kanal][status];

  return (
    <div className="space-y-6">
      {/* Ringkasan */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KartuStat label="Total produk master" nilai={ringkasan.total} warna="text-slate-900" />
        <KartuStat label="Blokir (keseluruhan)" nilai={ringkasan.blokir} warna="text-red-600" />
        <KartuStat label="Wajib review" nilai={ringkasan.review} warna="text-amber-600" />
        <KartuStat label="Aman semua kanal" nilai={ringkasan.aman} warna="text-emerald-600" />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Blokir + review per kanal
        </p>
        <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-3">
          {DAFTAR_KANAL.map((k) => (
            <div key={k} className="rounded-md border border-slate-200 p-3">
              <p className="text-sm font-semibold text-slate-700">{LABEL_KANAL[k]}</p>
              <div className="mt-1 flex items-end gap-3">
                <p className="text-xl font-bold text-red-600">{hitungKanal(k, "blokir")}</p>
                <p className="text-xs text-slate-400">blokir</p>
                <p className="text-xl font-bold text-amber-600">{hitungKanal(k, "review")}</p>
                <p className="text-xs text-slate-400">review</p>
                <p className="ml-auto text-xs text-slate-400">
                  {hitungKanal(k, "aman")} aman
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Filter */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari nama atau id produk…"
            className="rounded-lg border border-slate-300 py-1.5 pl-8 pr-3 text-sm focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <select
          value={filterKanal}
          onChange={(e) => setFilterKanal(e.target.value)}
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
        >
          <option value="">Semua kanal</option>
          {DAFTAR_KANAL.map((k) => (
            <option key={k} value={k}>
              {LABEL_KANAL[k]}
            </option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
        >
          <option value="">Semua status</option>
          {URUT_STATUS.map((s) => (
            <option key={s} value={s}>
              {LABEL_STATUS[s]}
            </option>
          ))}
        </select>
        <label className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={hanyaBermasalah}
            onChange={(e) => setHanyaBermasalah(e.target.checked)}
            className="h-4 w-4 accent-emerald-600"
          />
          Hanya bermasalah
        </label>
        <span className="ml-auto text-xs text-slate-500">
          {terfilter.length} dari {terperiksa.length} produk
        </span>
      </div>

      {/* Tabel */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Produk</th>
              <th className="px-3 py-2 text-center">TikTok</th>
              <th className="px-3 py-2 text-center">Blibli</th>
              <th className="px-3 py-2 text-center">Lazada</th>
              <th className="px-3 py-2">Keseluruhan</th>
              <th className="px-3 py-2">Temuan</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {terfilter.map((t) => (
              <BarisTabel
                key={t.id}
                id={t.id}
                name={t.name}
                kategori={t.kategori}
                hasil={t.hasil}
                terbuka={buka === t.id}
                onToggle={() => setBuka(buka === t.id ? null : t.id)}
              />
            ))}
            {terfilter.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-400">
                  Tidak ada produk yang cocok dengan filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Kotak uji */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-emerald-600" />
          <p className="text-sm font-semibold text-slate-700">Uji teks nama produk</p>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Tempel nama produk (lama/baru) untuk melihat verdict rule engine
          sebelum dipakai di channel. Perhitungan lokal, tidak menyentuh
          channel mana pun.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            value={teksUji}
            onChange={(e) => setTeksUji(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && teksUji.trim()) setHasilUji(teksUji.trim());
            }}
            placeholder="mis. EROS SERUM VITALITAS PRIA…"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
          />
          <button
            onClick={() => teksUji.trim() && setHasilUji(teksUji.trim())}
            className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Uji
          </button>
        </div>
        {hasilUji && (
          <div className="mt-3">
            <PanelUji nama={hasilUji} />
          </div>
        )}
      </div>

      {/* Keterangan */}
      <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-semibold">Cara kerja & catatan kepatuhan</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            <li>
              Lapis umum (kode U-*) berlaku di semua channel: palsu/replika,
              klaim medis &amp; afrodisiak, bahan berbahaya, senjata, produk
              dewasa, off-platform, dll — sesuai{" "}
              <span className="font-mono">docs/aturan-produk-marketplace.md</span>.
            </li>
            <li>
              Lapis per marketplace: TikTok (BPOM wajib untuk herbal/
              suplemen, kotak misteri dilarang, logam mulia invite-only),
              Blibli (moderasi kata ketat: racun/antibiotik/pestisida/
              herbisida/ayam aduan langsung merah), Lazada (sistem poin NCP).
            </li>
            <li>
              Pemeriksaan berbasis NAMA (moderasi platform juga berbasis
              kata). Deskripsi upload Tahap 6 akan difilter terpisah:
              dilarang shareloc, link, nomor WA, dan alamat gudang.
            </li>
            <li>
              Status <b>blokir</b> = produk tidak diupload otomatis ke kanal
              itu sampai nama dibersihkan; <b>review</b> = wajib tinjau
              manual; <b>perhatian</b> = boleh upload dengan catatan.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function BarisTabel({
  id,
  name,
  kategori,
  hasil,
  terbuka,
  onToggle,
}: {
  id: string;
  name: string;
  kategori: string;
  hasil: HasilCekAturan;
  terbuka: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer transition-colors hover:bg-slate-50 ${terbuka ? "bg-slate-50" : ""}`}
      >
        <td className="px-3 py-2">
          <div className="flex items-start gap-2">
            {terbuka ? (
              <ChevronUp className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            ) : (
              <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            )}
            <div>
              <p className="font-medium text-slate-800">{name}</p>
              <p className="text-[11px] text-slate-400">
                #{id}
                {kategori ? ` · ${kategori}` : ""}
              </p>
            </div>
          </div>
        </td>
        {DAFTAR_KANAL.map((k) => (
          <td key={k} className="px-3 py-2 text-center">
            <ChipKanal kanal={k} status={hasil.perKanal[k]} />
          </td>
        ))}
        <td className="px-3 py-2">
          <ChipStatus status={hasil.keseluruhan} kecil />
        </td>
        <td className="px-3 py-2 text-xs text-slate-500">
          {hasil.jumlahTemuan > 0 ? (
            <span className="font-medium text-slate-700">
              {hasil.jumlahTemuan} temuan
            </span>
          ) : (
            "—"
          )}
        </td>
      </tr>
      {terbuka && (
        <tr>
          <td colSpan={6} className="bg-slate-50 px-3 pb-3">
            <PanelTemuan hasil={hasil} />
          </td>
        </tr>
      )}
    </>
  );
}
