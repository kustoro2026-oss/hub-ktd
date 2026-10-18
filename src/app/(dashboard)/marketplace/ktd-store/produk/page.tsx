// Halaman Produk KTD Store — katalog toko sendiri (snapshot Aneka) dengan
// harga jual efektif (override tersimpan ?? rekomendasi jual Aneka), kolom
// profit, dan tombol Atur Massal. Bagian dari grup Marketplace → KTD Store.
import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import KtdStoreProdukClient, {
  type BarisProdukToko,
} from "@/components/ktd-store-produk-client";
import { anekaCatalogGeneratedAt, listAnekaCatalog } from "@/lib/aneka-map";
import { listKtdStoreHarga } from "@/lib/db";
import PageHeader from "@/components/page-header";

export const dynamic = "force-dynamic";
export const metadata = { title: "Produk KTD Store" };

/** "Rp18.450" → 18450. Sama seperti parseRpModal di bulk-harga. */
function parseRp(s: string): number {
  const n = Number(String(s ?? "").replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export default async function ProdukKtdStorePage() {
  const overrideRows = await listKtdStoreHarga();
  const katalog = listAnekaCatalog();
  const override = new Map(overrideRows.map((r) => [r.aneka_id, r.harga]));
  const rows: BarisProdukToko[] = katalog
    .map((p) => {
      const id = String(p.id ?? "");
      const modal = parseRp(p.hargaModal);
      const rekomendasi = parseRp(p.rekomendasiJual);
      const harga = override.get(id) ?? rekomendasi;
      return {
        id,
        nama: p.name,
        modal,
        harga,
        rekomendasi,
        profit: modal > 0 ? harga - modal : 0,
        lokasi: p.location,
        override: override.has(id),
      };
    })
    .sort((a, b) => b.profit - a.profit);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Marketplace · KTD Store"
        title="Produk"
        subtitle="Katalog toko.kustoro2026.com — harga mengikuti override bila ada"
        actions={
          <Link
            href="/marketplace/ktd-store/produk/massal"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Atur Massal
          </Link>
        }
      />
      <KtdStoreProdukClient rows={rows} generatedAt={anekaCatalogGeneratedAt()} />
    </div>
  );
}
