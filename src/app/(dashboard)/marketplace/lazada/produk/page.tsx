// Halaman Produk Lazada — daftar produk + atur harga & stok per SellerSku
// (UpdatePriceQuantity, sinkron). Bagian dari grup Marketplace → Lazada.
import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import LazadaProdukClient from "@/components/lazada-produk-client";
import RefreshButton from "@/components/refresh-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Produk Lazada" };

export default function ProdukLazadaPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
            Marketplace · Lazada
          </p>
          <h1 className="text-xl font-bold text-slate-900">Produk</h1>
          <p className="text-sm text-slate-500">
            Daftar produk ditarik langsung dari API Open Platform — ubah
            harga &amp; stok per SellerSku.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/marketplace/lazada/produk/massal"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Atur Massal
          </Link>
          <RefreshButton />
        </div>
      </div>
      <LazadaProdukClient />
    </div>
  );
}
