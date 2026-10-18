// Halaman Harga Massal Lazada — aturan bertingkat berbasis profit dari modal
// Aneka dropship, pratinjau dengan centang per produk, tombol Terapkan, dan
// Reset Semua ke harga awal. Subhalaman dari Marketplace → Lazada → Produk.
import Link from "next/link";
import BulkHargaClient from "@/components/bulk-harga-client";
import PageHeader from "@/components/page-header";

export const dynamic = "force-dynamic";
export const metadata = { title: "Harga Massal Lazada" };

export default function HargaMassalLazadaPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Marketplace · Lazada · Produk"
        title="Harga Massal"
        subtitle={
          <>
            Atur harga banyak produk sekaligus lewat aturan berbasis profit
            (harga jual − modal Aneka dropship). Kembali ke{" "}
            <Link
              href="/marketplace/lazada/produk"
              className="font-medium text-emerald-700 hover:underline"
            >
              daftar Produk
            </Link>
            .
          </>
        }
      />
      <BulkHargaClient marketplace="lazada" />
    </div>
  );
}
