// Halaman Harga Massal Lazada — aturan bertingkat berbasis profit dari modal
// Aneka dropship, pratinjau dengan centang per produk, tombol Terapkan, dan
// Reset Semua ke harga awal. Subhalaman dari Marketplace → Lazada → Produk.
import Link from "next/link";
import BulkHargaClient from "@/components/bulk-harga-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Harga Massal Lazada" };

export default function HargaMassalLazadaPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
          Marketplace · Lazada · Produk
        </p>
        <h1 className="text-xl font-bold text-slate-900">Harga Massal</h1>
        <p className="text-sm text-slate-500">
          Atur harga banyak produk sekaligus lewat aturan berbasis profit
          (harga jual − modal Aneka dropship). Kembali ke{" "}
          <Link
            href="/marketplace/lazada/produk"
            className="font-medium text-emerald-700 hover:underline"
          >
            daftar Produk
          </Link>
          .
        </p>
      </div>
      <BulkHargaClient marketplace="lazada" />
    </div>
  );
}
