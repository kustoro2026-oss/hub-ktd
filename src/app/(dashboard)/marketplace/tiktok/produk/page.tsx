// Halaman Produk TikTok Shop — daftar produk + atur harga & stok semua SKU
// sekaligus (panggilan sinkron ke API produk TikTok). Bagian dari grup
// Marketplace → TikTok Shop.
import TiktokProdukClient from "@/components/tiktok-produk-client";
import RefreshButton from "@/components/refresh-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Produk TikTok Shop" };

export default function ProdukTiktokPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
            Marketplace · TikTok Shop
          </p>
          <h1 className="text-xl font-bold text-slate-900">Produk</h1>
          <p className="text-sm text-slate-500">
            Daftar produk ditarik langsung dari API TikTok Shop — ubah harga
            &amp; stok untuk semua SKU sekaligus.
          </p>
        </div>
        <RefreshButton />
      </div>
      <TiktokProdukClient />
    </div>
  );
}
