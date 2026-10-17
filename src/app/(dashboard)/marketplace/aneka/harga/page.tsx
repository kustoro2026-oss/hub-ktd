// Halaman Sinkron Harga (menu Aneka, Tahap 3) — satu aksi mengubah harga
// jual produk master Aneka mendorong harga target ke semua kanal tempat
// produk dipetakan (TikTok Shop, Blibli, Lazada, KTD Store) sekaligus,
// dengan snapshot harga awal otomatis untuk reset.
import HargaSyncClient from "@/components/harga-sync-client";
import { anekaMasterMeta, listAnekaMaster } from "@/lib/aneka-master";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sinkron Harga Aneka" };

export default async function SinkronHargaAnekaPage() {
  // Hanya kolom yang dipakai tabel sinkron (hindari payload varian penuh).
  const rows = listAnekaMaster().map((p) => ({
    id: p.id,
    name: p.name,
    hargaModal: p.hargaModal,
    rekomendasiJual: p.rekomendasiJual,
    stok: p.stok,
    status: p.status,
  }));
  const meta = anekaMasterMeta();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
          Marketplace · Aneka (Supplier)
        </p>
        <h1 className="text-xl font-bold text-slate-900">Sinkron Harga Master</h1>
        <p className="text-sm text-slate-500">
          Satu aksi mengubah harga jual di master Aneka → harga target yang
          sama didorong ke semua kanal tempat produk dipetakan: TikTok Shop
          (semua SKU), Blibli (semua varian), Lazada (SellerSku), dan KTD
          Store (override situs toko). Harga target default = rekomendasi jual
          Aneka dan bisa diubah per baris. Snapshot harga awal tersimpan
          otomatis — Reset ada di halaman Harga Massal tiap kanal.
        </p>
      </div>
      <HargaSyncClient rows={rows} meta={meta} />
    </div>
  );
}
