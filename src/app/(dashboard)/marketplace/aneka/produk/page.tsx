// Halaman Produk Aneka — master katalog seluruh produk anekadropship.id
// (snapshot hasil sweep listing + detail). Kolom harga beli, rekomendasi
// jual, profit, stok efektif, varian, alamat seller, dan pengiriman —
// dasar sinkronisasi harga/stok ke semua marketplace (fase berikutnya).
import AnekaProdukClient from "@/components/aneka-produk-client";
import { anekaMasterMeta, listAnekaMaster } from "@/lib/aneka-master";
import PageHeader from "@/components/page-header";

export const dynamic = "force-dynamic";
export const metadata = { title: "Katalog Aneka" };

export default async function ProdukAnekaPage() {
  const rows = listAnekaMaster();
  const meta = anekaMasterMeta();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Marketplace · Aneka (Supplier)"
        title="Katalog Master Aneka"
        subtitle="Seluruh produk anekadropship.id — harga beli, stok, varian, dan pengiriman"
      />
      <AnekaProdukClient rows={rows} meta={meta} />
    </div>
  );
}
