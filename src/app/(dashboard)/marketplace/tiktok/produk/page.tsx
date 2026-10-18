// Halaman Produk TikTok Shop — daftar produk + atur harga & stok semua SKU
// sekaligus (panggilan sinkron ke API produk TikTok). Bagian dari grup
// Marketplace → TikTok Shop.
import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import TiktokProdukClient from "@/components/tiktok-produk-client";
import RefreshButton from "@/components/refresh-button";
import PageHeader from "@/components/page-header";

export const dynamic = "force-dynamic";
export const metadata = { title: "Produk TikTok Shop" };

export default function ProdukTiktokPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Marketplace · TikTok Shop"
        title="Produk"
        subtitle="Daftar produk dari API TikTok Shop — ubah harga & stok semua SKU"
        actions={
          <>
            <Link
              href="/marketplace/tiktok/produk/massal"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              <SlidersHorizontal className="h-4 w-4" />
              Atur Massal
            </Link>
            <RefreshButton />
          </>
        }
      />
      <TiktokProdukClient />
    </div>
  );
}
