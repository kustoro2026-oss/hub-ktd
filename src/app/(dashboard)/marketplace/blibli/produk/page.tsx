// Halaman Produk Blibli — daftar produk + atur harga & stok (update massal
// lewat antrian API Blibli, asinkron). Bagian dari grup Marketplace → Blibli.
import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import BlibliProdukClient from "@/components/blibli-produk-client";
import RefreshButton from "@/components/refresh-button";
import PageHeader from "@/components/page-header";

export const dynamic = "force-dynamic";
export const metadata = { title: "Produk Blibli" };

export default function ProdukBlibliPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Marketplace · Blibli"
        title="Produk"
        subtitle="Daftar produk dari API Seller — ubah harga & stok semua varian sekaligus"
        actions={
          <>
            <Link
              href="/marketplace/blibli/produk/massal"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              <SlidersHorizontal className="h-4 w-4" />
              Atur Massal
            </Link>
            <RefreshButton />
          </>
        }
      />
      <BlibliProdukClient />
    </div>
  );
}
