// Halaman Harga Massal KTD Store — aturan bertingkat berbasis profit dari
// modal Aneka dropship, pratinjau dengan centang per produk, tombol
// Terapkan, dan Reset Semua. Hasil disimpan ke override harga toko yang
// dibaca situs (toko.kustoro2026.com) dalam ±5 menit. Subhalaman dari
// Marketplace → KTD Store → Produk.
import Link from "next/link";
import BulkHargaClient from "@/components/bulk-harga-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Harga Massal KTD Store" };

export default function HargaMassalKtdStorePage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
          Marketplace · KTD Store · Produk
        </p>
        <h1 className="text-xl font-bold text-slate-900">Harga Massal</h1>
        <p className="text-sm text-slate-500">
          Atur harga banyak produk situs toko sekaligus lewat aturan berbasis
          profit (harga toko − modal Aneka dropship). Perubahan tampil di
          toko.kustoro2026.com dalam ±5 menit. Kembali ke{" "}
          <Link
            href="/marketplace/ktd-store/produk"
            className="font-medium text-emerald-700 hover:underline"
          >
            daftar Produk
          </Link>
          .
        </p>
      </div>
      <BulkHargaClient marketplace="ktd-store" />
    </div>
  );
}
