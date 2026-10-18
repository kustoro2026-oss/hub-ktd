// Halaman Sinkron Stok (menu Aneka, Tahap 4) — satu aksi menetapkan target
// stok produk master Aneka mendorong stok yang sama ke semua kanal tempat
// produk dipetakan (TikTok Shop, Blibli, Lazada, KTD Store) sekaligus,
// plus riwayat pengurangan stok otomatis dari order selesai.
import StokSyncClient from "@/components/stok-sync-client";
import { anekaMasterMeta, listAnekaMaster } from "@/lib/aneka-master";
import PageHeader from "@/components/page-header";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sinkron Stok Aneka" };

export default async function SinkronStokAnekaPage() {
  // Hanya kolom yang dipakai tabel sinkron (hindari payload varian penuh).
  const rows = listAnekaMaster().map((p) => ({
    id: p.id,
    name: p.name,
    stok: p.stok,
    status: p.status,
  }));
  const meta = anekaMasterMeta();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Marketplace · Aneka (Supplier)"
        title="Sinkron Stok Master"
        subtitle="Tetapkan stok di master Aneka → didorong ke semua kanal yang terpetakan"
      />
      <StokSyncClient rows={rows} meta={meta} />
    </div>
  );
}
