// Halaman Sinkron Stok (menu Aneka, Tahap 4) — satu aksi menetapkan target
// stok produk master Aneka mendorong stok yang sama ke semua kanal tempat
// produk dipetakan (TikTok Shop, Blibli, Lazada, KTD Store) sekaligus,
// plus riwayat pengurangan stok otomatis dari order selesai.
import StokSyncClient from "@/components/stok-sync-client";
import { anekaMasterMeta, listAnekaMaster } from "@/lib/aneka-master";

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
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
          Marketplace · Aneka (Supplier)
        </p>
        <h1 className="text-xl font-bold text-slate-900">Sinkron Stok Master</h1>
        <p className="text-sm text-slate-500">
          Satu aksi menetapkan target stok produk Aneka → stok yang sama
          didorong ke semua kanal tempat produk dipetakan: TikTok Shop
          (semua SKU & gudang), Blibli (semua varian, exactStock), Lazada
          (SellerSku), dan KTD Store (override situs toko). Target stok
          default = stok master Aneka dan bisa diubah per baris. Selain
          manual, stok otomatis berkurang di semua kanal lain setiap order
          berstatus selesai (TikTok COMPLETED / Blibli terkirim / Lazada
          delivered) — riwayatnya tampil di bagian bawah.
        </p>
      </div>
      <StokSyncClient rows={rows} meta={meta} />
    </div>
  );
}
