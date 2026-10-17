"use client";

// Komponen Upload Baru (Tahap 6) — kanal Blibli aktif, Lazada/TikTok
// "segera". Tipe KandidatUpload/RingkasanUpload didefinisikan ulang di sini
// (bukan import dari lib/upload-blibli) karena lib tersebut server-only
// (node:zlib + db).
import { useMemo, useState } from "react";
import {
  Ban,
  CircleCheck,
  Download,
  Eye,
  ImageOff,
  Info,
  Layers,
  MapPin,
  PackagePlus,
  TriangleAlert,
} from "lucide-react";

export type KandidatUpload = {
  id: string;
  name: string;
  lokasi: string;
  ppCode: string;
  ppNama: string;
  ppFallback: boolean;
  hargaJual: number;
  stok: number;
  statusAturan: "aman" | "perhatian" | "review" | "blokir";
  jumlahVarian: number;
  kategori: string;
  adaDeskripsi: boolean;
  jumlahGambar: number;
  alasan: string[];
  layak: boolean;
};

export type RingkasanUpload = {
  totalMaster: number;
  sudahTerpetakan: number;
  baru: number;
  mati404: number;
  layak: number;
  tidakLayak: number;
  varian: number;
  tanpaVarian: number;
  aman: number;
  perhatian: number;
  review: number;
  blokir: number;
  kategoriKosong: number;
  denganDeskripsi: number;
  tanpaDeskripsi: number;
  lokasiFallback: number;
};

export type RiwayatUpload = {
  id: string;
  channel: string;
  nama_file: string;
  jumlah_produk: number;
  jumlah_baris: number;
  daftar_id: string;
  keterangan: string;
  created_at: string;
};

const GAYA_STATUS: Record<KandidatUpload["statusAturan"], string> = {
  aman: "border-emerald-200 bg-emerald-50 text-emerald-700",
  perhatian: "border-yellow-200 bg-yellow-50 text-yellow-700",
  review: "border-amber-200 bg-amber-50 text-amber-700",
  blokir: "border-red-200 bg-red-50 text-red-700",
};

const LABEL_STATUS: Record<KandidatUpload["statusAturan"], string> = {
  aman: "Aman",
  perhatian: "Perhatian",
  review: "Review",
  blokir: "Blokir",
};

const IKON_STATUS: Record<KandidatUpload["statusAturan"], typeof CircleCheck> = {
  aman: CircleCheck,
  perhatian: TriangleAlert,
  review: Eye,
  blokir: Ban,
};

function ChipStatus({ status }: { status: KandidatUpload["statusAturan"] }) {
  const Ikon = IKON_STATUS[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${GAYA_STATUS[status]}`}
    >
      <Ikon className="h-3 w-3" />
      {LABEL_STATUS[status]}
    </span>
  );
}

function KartuStat({
  label,
  nilai,
  warna = "text-slate-900",
}: {
  label: string;
  nilai: number;
  warna?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${warna}`}>{nilai}</p>
    </div>
  );
}

function rupiah(n: number): string {
  return `Rp ${(n || 0).toLocaleString("id-ID")}`;
}

export default function UploadClient({
  kandidat,
  ringkasan,
  riwayat: riwayatAwal,
}: {
  kandidat: KandidatUpload[];
  ringkasan: RingkasanUpload;
  riwayat: RiwayatUpload[];
}) {
  const [q, setQ] = useState("");
  const [filterLayak, setFilterLayak] = useState<"semua" | "layak" | "tidak">(
    "layak",
  );
  const [terpilih, setTerpilih] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [pesan, setPesan] = useState<{ jenis: "ok" | "galat"; teks: string } | null>(
    null,
  );
  const [riwayat, setRiwayat] = useState<RiwayatUpload[]>(riwayatAwal);

  const terfilter = useMemo(() => {
    const kata = q.trim().toLowerCase();
    return kandidat.filter((k) => {
      if (kata && !k.name.toLowerCase().includes(kata) && !k.id.includes(kata)) {
        return false;
      }
      if (filterLayak === "layak" && !k.layak) return false;
      if (filterLayak === "tidak" && k.layak) return false;
      return true;
    });
  }, [kandidat, q, filterLayak]);

  const jumlahLayakTerfilter = terfilter.filter((k) => k.layak).length;

  function setel(id: string, centang: boolean) {
    setTerpilih((s) => {
      const baru = new Set(s);
      if (centang) baru.add(id);
      else baru.delete(id);
      return baru;
    });
  }

  function setelSemuaLayak() {
    setTerpilih((s) => {
      const baru = new Set(s);
      const semuaTercek = terfilter.every((k) => !k.layak || baru.has(k.id));
      for (const k of terfilter) {
        if (!k.layak) continue;
        if (semuaTercek) baru.delete(k.id);
        else baru.add(k.id);
      }
      return baru;
    });
  }

  async function buatFile() {
    if (!terpilih.size || busy) return;
    setBusy(true);
    setPesan(null);
    try {
      const res = await fetch("/api/aneka/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "buat-file", ids: [...terpilih] }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({} as { detail?: string }));
        setPesan({ jenis: "galat", teks: j.detail || "Gagal membangun file." });
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const m = cd.match(/filename="?([^";]+)"?/);
      const nama = m ? m[1] : "blibli-upload-baru.xlsx";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = nama;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);

      const peringatan = decodeURIComponent(
        res.headers.get("X-Upload-Peringatan") || "",
      );
      setPesan({
        jenis: "ok",
        teks: `File "${nama}" diunduh (${terpilih.size} produk).${
          peringatan ? ` Peringatan: ${peringatan}` : ""
        }`,
      });
      // Muat ulang riwayat (file sudah tercatat di DB oleh server).
      const r = await fetch("/api/aneka/upload?op=riwayat").then((x) => x.json());
      if (r?.ok) setRiwayat(r.riwayat);
    } catch (e) {
      setPesan({
        jenis: "galat",
        teks: e instanceof Error ? e.message : "Gagal membangun file.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Ringkasan */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KartuStat label="Belum di Blibli" nilai={ringkasan.baru} />
        <KartuStat label="Layak di-file" nilai={ringkasan.layak} warna="text-emerald-600" />
        <KartuStat
          label="Tidak layak (aturan/kategori)"
          nilai={ringkasan.tidakLayak}
          warna="text-red-600"
        />
        <KartuStat label="Produk varian" nilai={ringkasan.varian} />
        <KartuStat
          label="Nonaktif di Aneka (404)"
          nilai={ringkasan.mati404}
          warna="text-slate-500"
        />
      </div>

      {/* Catatan gate */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
        <p className="flex items-center gap-1.5 font-semibold text-slate-800">
          <Info className="h-4 w-4 text-emerald-600" />
          Catatan kandidat (dari {ringkasan.totalMaster} master,{" "}
          {ringkasan.sudahTerpetakan} sudah terpetakan)
        </p>
        <ul className="mt-2 grid list-disc gap-1 pl-5 md:grid-cols-2">
          <li>
            Aturan: {ringkasan.aman} aman, {ringkasan.perhatian} perhatian,{" "}
            {ringkasan.review} review, {ringkasan.blokir} blokir — blokir/review
            tidak bisa masuk file.
          </li>
          <li>
            Kategori: {ringkasan.kategoriKosong} tanpa pemetaan kategori (tidak
            layak sampai dipetakan manual).
          </li>
          <li>
            Deskripsi: {ringkasan.denganDeskripsi} pakai deskripsi hasil scrape,{" "}
            {ringkasan.tanpaDeskripsi} fallback &ldquo;Produk: nama&rdquo;.
          </li>
          <li>
            Lokasi: {ringkasan.lokasiFallback} produk tanpa pickup point terdaftar
            (dikirim ke PP default Cengkareng).
          </li>
          <li>
            Kanal Lazada sudah tersedia di tab Lazada; TikTok menyusul setelah
            user memberi instruksi lanjutan (kuota 1000).
          </li>
        </ul>
      </div>

      {/* Filter + aksi */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari nama atau id…"
            className="rounded-lg border border-slate-300 py-1.5 pl-3 pr-3 text-sm focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <select
          value={filterLayak}
          onChange={(e) => setFilterLayak(e.target.value as typeof filterLayak)}
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
        >
          <option value="semua">Semua kandidat</option>
          <option value="layak">Hanya layak</option>
          <option value="tidak">Hanya tidak layak</option>
        </select>
        <span className="ml-auto text-xs text-slate-500">
          {terfilter.length} tampil · {terpilih.size} dipilih
        </span>
        <button
          onClick={buatFile}
          disabled={!terpilih.size || busy}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PackagePlus className="h-4 w-4" />
          {busy ? "Membangun…" : `Buat File Upload (${terpilih.size})`}
        </button>
      </div>

      {pesan ? (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            pesan.jenis === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {pesan.teks}
        </div>
      ) : null}

      {/* Tabel kandidat */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">
                <input
                  type="checkbox"
                  checked={jumlahLayakTerfilter > 0 && terfilter.every((k) => !k.layak || terpilih.has(k.id))}
                  onChange={setelSemuaLayak}
                  className="h-4 w-4 accent-emerald-600"
                  title="Pilih semua yang layak"
                />
              </th>
              <th className="px-3 py-2">Produk</th>
              <th className="px-3 py-2">Lokasi → Pickup</th>
              <th className="px-3 py-2">Kategori</th>
              <th className="px-3 py-2 text-right">Harga</th>
              <th className="px-3 py-2 text-right">Stok</th>
              <th className="px-3 py-2">Aturan</th>
              <th className="px-3 py-2">Catatan</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {terfilter.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-slate-400">
                  Tidak ada kandidat yang cocok.
                </td>
              </tr>
            ) : (
              terfilter.map((k) => (
                <tr key={k.id} className={k.layak ? "" : "bg-slate-50"}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={terpilih.has(k.id)}
                      disabled={!k.layak}
                      onChange={(e) => setel(k.id, e.target.checked)}
                      className="h-4 w-4 accent-emerald-600 disabled:cursor-not-allowed"
                    />
                  </td>
                  <td className="max-w-[320px] px-3 py-2">
                    <p className="font-medium text-slate-800">{k.name}</p>
                    <p className="text-xs text-slate-400">#{k.id}</p>
                    <p className="mt-0.5 flex flex-wrap gap-1 text-[11px]">
                      {k.jumlahVarian > 1 ? (
                        <span className="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
                          <Layers className="h-3 w-3" />
                          {k.jumlahVarian} varian
                        </span>
                      ) : null}
                      {!k.adaDeskripsi ? (
                        <span className="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">
                          <ImageOff className="h-3 w-3" />
                          deskripsi fallback
                        </span>
                      ) : null}
                      {k.jumlahGambar === 0 ? (
                        <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-600">
                          tanpa gambar
                        </span>
                      ) : null}
                    </p>
                  </td>
                  <td className="px-3 py-2">
                    <p className="text-slate-700">{k.lokasi || "—"}</p>
                    <p className="flex items-center gap-0.5 text-xs text-slate-400">
                      <MapPin className="h-3 w-3" />
                      {k.ppCode}
                      {k.ppFallback ? " (default)" : ""}
                    </p>
                  </td>
                  <td className="max-w-[220px] px-3 py-2">
                    <p className="truncate text-xs text-slate-600" title={k.kategori}>
                      {k.kategori || <span className="text-red-600">tidak terpetakan</span>}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-right text-slate-700">
                    {rupiah(k.hargaJual)}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-700">{k.stok}</td>
                  <td className="px-3 py-2">
                    <ChipStatus status={k.statusAturan} />
                  </td>
                  <td className="px-3 py-2 text-xs text-red-600">
                    {k.alasan.join("; ") || <span className="text-slate-300">—</span>}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Riwayat */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Riwayat pembuatan file
        </p>
        {riwayat.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">
            Belum ada file yang dibuat lewat hub.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {riwayat.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className="font-medium text-slate-800">{r.nama_file}</span>
                <span className="text-xs text-slate-500">
                  {r.jumlah_produk} produk · {r.jumlah_baris} baris · {r.channel}
                </span>
                <span className="text-xs text-slate-400">{r.created_at}</span>
                {r.keterangan ? (
                  <span
                    className="inline-flex items-center gap-1 text-xs text-amber-700"
                    title={r.keterangan}
                  >
                    <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                    {r.keterangan.slice(0, 80)}
                    {r.keterangan.length > 80 ? "…" : ""}
                  </span>
                ) : null}
                <a
                  href={`/api/aneka/upload?op=unduh&id=${r.id}`}
                  className="ml-auto inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                >
                  <Download className="h-3.5 w-3.5" />
                  Unduh ulang
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Instruksi */}
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <p className="font-semibold">Langkah setelah file terunduh</p>
        <ol className="mt-1.5 list-decimal space-y-1 pl-5">
          <li>
            Buka Blibli Seller Center → Produk → Mass Upload → pilih file yang
            baru diunduh.
          </li>
          <li>
            Pantau hasil proses: status &ldquo;Berhasil Sebagian&rdquo; adalah
            hal yang wajar — unduh file error-nya (berisi HANYA baris gagal)
            untuk melihat alasan per baris.
          </li>
          <li>
            Jangan meng-upload ulang baris yang sudah sukses: Blibli tidak
            mendeteksi SKU duplikat dan akan membuat listing ganda.
          </li>
          <li>
            Produk varian memakai nilai Warna/Ukuran dari master tanpa
            sinkronisasi enum resmi — bila ada baris ditolak karena nilai
            varian, perbaiki manual di Seller Center.
          </li>
        </ol>
      </div>
    </div>
  );
}
