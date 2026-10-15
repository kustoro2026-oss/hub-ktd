// Halaman Produk Blibli — daftar produk + atur harga & stok (update massal
// lewat antrian API Blibli, asinkron). Bagian dari grup Marketplace → Blibli.
import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import BlibliProdukClient from "@/components/blibli-produk-client";
import RefreshButton from "@/components/refresh-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Produk Blibli" };

export default function ProdukBlibliPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
            Marketplace · Blibli
          </p>
          <h1 className="text-xl font-bold text-slate-900">Produk</h1>
          <p className="text-sm text-slate-500">
            Daftar produk ditarik langsung dari API Seller — ubah harga &amp;
            stok untuk semua varian sekaligus.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/marketplace/blibli/produk/massal"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Atur Massal
          </Link>
          <RefreshButton />
        </div>
      </div>
      <BlibliProdukClient />
    </div>
  );
}
