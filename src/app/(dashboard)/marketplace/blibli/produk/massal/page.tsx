// Halaman Harga Massal Blibli — aturan bertingkat berbasis profit dari modal
// Aneka dropship, pratinjau dengan centang per produk, tombol Terapkan, dan
// Reset Semua ke harga awal. Subhalaman dari Marketplace → Blibli → Produk.
import Link from "next/link";
import BulkHargaClient from "@/components/bulk-harga-client";
import PageHeader from "@/components/page-header";

export const dynamic = "force-dynamic";
export const metadata = { title: "Harga Massal Blibli" };

export default function HargaMassalBlibliPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Marketplace · Blibli · Produk"
        title="Harga Massal"
        subtitle={
          <>
            Atur harga banyak produk sekaligus lewat aturan berbasis profit
            (harga jual − modal Aneka dropship). Kembali ke{" "}
            <Link
              href="/marketplace/blibli/produk"
              className="font-medium text-emerald-700 hover:underline"
            >
              daftar Produk
            </Link>
            .
          </>
        }
      />
      <BulkHargaClient marketplace="blibli" />
    </div>
  );
}
