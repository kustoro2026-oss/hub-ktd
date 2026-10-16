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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
            Marketplace · KTD Store
          </p>
          <h1 className="text-xl font-bold text-slate-900">Produk</h1>
          <p className="text-sm text-slate-500">
            Katalog situs toko (toko.kustoro2026.com) dari snapshot Aneka —
            harga toko mengikuti override bila ada, selain itu rekomendasi
            jual Aneka. Ubah harga banyak produk lewat{" "}
            <Link
              href="/marketplace/ktd-store/produk/massal"
              className="font-medium text-emerald-700 hover:underline"
            >
              Harga Massal
            </Link>
            .
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/marketplace/ktd-store/produk/massal"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Atur Massal
          </Link>
        </div>
      </div>
      <KtdStoreProdukClient rows={rows} generatedAt={anekaCatalogGeneratedAt()} />
    </div>
  );
}
