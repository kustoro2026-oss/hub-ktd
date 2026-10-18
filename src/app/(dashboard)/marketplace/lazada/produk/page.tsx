// Halaman Produk Lazada — daftar produk + atur harga & stok per SellerSku
// (UpdatePriceQuantity, sinkron). Bagian dari grup Marketplace → Lazada.
import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import LazadaProdukClient from "@/components/lazada-produk-client";
import RefreshButton from "@/components/refresh-button";
import PageHeader from "@/components/page-header";

export const dynamic = "force-dynamic";
export const metadata = { title: "Produk Lazada" };

export default function ProdukLazadaPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Marketplace · Lazada"
        title="Produk"
        subtitle="Daftar produk dari API Open Platform — ubah harga & stok per SellerSku"
        actions={
          <>
            <Link
              href="/marketplace/lazada/produk/massal"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              <SlidersHorizontal className="h-4 w-4" />
              Atur Massal
            </Link>
            <RefreshButton />
          </>
        }
      />
      <LazadaProdukClient />
    </div>
  );
}
