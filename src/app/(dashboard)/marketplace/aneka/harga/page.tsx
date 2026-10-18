// Halaman Sinkron Harga (menu Aneka, Tahap 3) — satu aksi mengubah harga
// jual produk master Aneka mendorong harga target ke semua kanal tempat
// produk dipetakan (TikTok Shop, Blibli, Lazada, KTD Store) sekaligus,
// dengan snapshot harga awal otomatis untuk reset.
import HargaSyncClient from "@/components/harga-sync-client";
import { anekaMasterMeta, listAnekaMaster } from "@/lib/aneka-master";
import PageHeader from "@/components/page-header";

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
      <PageHeader
        eyebrow="Marketplace · Aneka (Supplier)"
        title="Sinkron Harga Master"
        subtitle="Ubah harga di master Aneka → didorong ke semua kanal yang terpetakan"
      />
      <HargaSyncClient rows={rows} meta={meta} />
    </div>
  );
}
