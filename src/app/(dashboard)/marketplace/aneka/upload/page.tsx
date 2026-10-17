// Halaman Upload Baru (menu Aneka, Tahap 6) — server page. Menarik
// kandidat produk yang belum terpetakan di kanal aktif (Blibli / Lazada /
// TikTok) + riwayat pembuatan file, lalu diserahkan ke komponen client
// kanal. Alur: pilih produk → hub membangun file bulk channel → upload
// manual ke Seller Center oleh user (alur terbukti).
import Link from "next/link";
import UploadClient from "@/components/upload-client";
import UploadLazadaClient from "@/components/upload-lazada-client";
import UploadTikTokClient from "@/components/upload-tiktok-client";
import { kandidatUploadBlibli } from "@/lib/upload-blibli";
import { kandidatUploadLazada } from "@/lib/upload-lazada";
import { kandidatUploadTikTok } from "@/lib/upload-tiktok";
import { listAnekaUploads } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Upload Produk Baru" };

export default async function UploadAnekaPage({
  searchParams,
}: {
  searchParams: Promise<{ kanal?: string }>;
}) {
  const { kanal } = await searchParams;
  const aktif: "blibli" | "lazada" | "tiktok" =
    kanal === "lazada" ? "lazada" : kanal === "tiktok" ? "tiktok" : "blibli";
  const riwayat = await listAnekaUploads(30);

  const tabKelas = (tab: "blibli" | "lazada" | "tiktok") =>
    `rounded-lg border px-4 py-1.5 text-sm font-medium ${
      aktif === tab
        ? "border-emerald-600 bg-emerald-600 text-white"
        : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
    }`;

  const kepala = (
    <>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
          Marketplace · Aneka (Supplier)
        </p>
        <h1 className="text-xl font-bold text-slate-900">Upload Produk Baru</h1>
        <p className="text-sm text-slate-500">
          Kirim produk master Aneka yang belum ada di channel. Alur: pilih
          produk → hub membangun file bulk-upload channel → unduh file →
          upload manual di Seller Center. Gerbang aturan Tahap 5 otomatis:
          produk berstatus blokir/review tidak dapat masuk file.
        </p>
      </div>
      {/* Tab kanal */}
      <div className="flex gap-2">
        <Link href="/marketplace/aneka/upload?kanal=blibli" className={tabKelas("blibli")}>
          Blibli
        </Link>
        <Link href="/marketplace/aneka/upload?kanal=lazada" className={tabKelas("lazada")}>
          Lazada
        </Link>
        <Link href="/marketplace/aneka/upload?kanal=tiktok" className={tabKelas("tiktok")}>
          TikTok
        </Link>
      </div>
    </>
  );

  if (aktif === "tiktok") {
    const { kandidat, ringkasan } = await kandidatUploadTikTok();
    return (
      <div className="space-y-6">
        {kepala}
        <UploadTikTokClient kandidat={kandidat} ringkasan={ringkasan} riwayat={riwayat} />
      </div>
    );
  }

  if (aktif === "lazada") {
    const { kandidat, ringkasan } = await kandidatUploadLazada();
    return (
      <div className="space-y-6">
        {kepala}
        <UploadLazadaClient kandidat={kandidat} ringkasan={ringkasan} riwayat={riwayat} />
      </div>
    );
  }

  const { kandidat, ringkasan } = await kandidatUploadBlibli();
  return (
    <div className="space-y-6">
      {kepala}
      <UploadClient kandidat={kandidat} ringkasan={ringkasan} riwayat={riwayat} />
    </div>
  );
}
