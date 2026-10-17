// Halaman Produk Aneka — master katalog seluruh produk anekadropship.id
// (snapshot hasil sweep listing + detail). Kolom harga beli, rekomendasi
// jual, profit, stok efektif, varian, alamat seller, dan pengiriman —
// dasar sinkronisasi harga/stok ke semua marketplace (fase berikutnya).
import AnekaProdukClient from "@/components/aneka-produk-client";
import { anekaMasterMeta, listAnekaMaster } from "@/lib/aneka-master";

export const dynamic = "force-dynamic";
export const metadata = { title: "Katalog Aneka" };

export default async function ProdukAnekaPage() {
  const rows = listAnekaMaster();
  const meta = anekaMasterMeta();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
          Marketplace · Aneka (Supplier)
        </p>
        <h1 className="text-xl font-bold text-slate-900">Katalog Master Aneka</h1>
        <p className="text-sm text-slate-500">
          Seluruh produk anekadropship.id — harga beli, rekomendasi jual,
          stok, varian, alamat seller, dan pengiriman. Nama produk sudah
          dibersihkan dari tag seller (mis. [PG STORE], [HERBALUNA]); nama
          mentah Aneka tetap tersimpan di rincian baris. Data ini menjadi
          sumber sinkronisasi harga &amp; stok ke semua marketplace.
        </p>
      </div>
      <AnekaProdukClient rows={rows} meta={meta} />
    </div>
  );
}
