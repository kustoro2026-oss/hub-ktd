// Halaman Harga Massal KTD Store — aturan bertingkat berbasis profit dari
// modal Aneka dropship, pratinjau dengan centang per produk, tombol
// Terapkan, dan Reset Semua. Hasil disimpan ke override harga toko yang
// dibaca situs (toko.kustoro2026.com) dalam beberapa menit. Subhalaman dari
// Marketplace → KTD Store → Produk.
import Link from "next/link";
import BulkHargaClient from "@/components/bulk-harga-client";
import PageHeader from "@/components/page-header";

export const dynamic = "force-dynamic";
export const metadata = { title: "Harga Massal KTD Store" };

export default function HargaMassalKtdStorePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Marketplace · KTD Store · Produk"
        title="Harga Massal"
        subtitle={
          <>
            Atur harga banyak produk situs toko sekaligus lewat aturan berbasis
            profit (harga toko − modal Aneka dropship). Perubahan tampil di
            toko.kustoro2026.com dalam beberapa menit. Kembali ke{" "}
            <Link
              href="/marketplace/ktd-store/produk"
              className="font-medium text-emerald-700 hover:underline"
            >
              daftar Produk
            </Link>
            .
          </>
        }
      />
      <BulkHargaClient marketplace="ktd-store" />
    </div>
  );
}
