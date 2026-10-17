// Halaman Cek Aturan (menu Aneka, Tahap 5) — server page. Meneruskan
// daftar produk master ke komponen client; pemeriksaan rule engine
// dihitung di client (aturan-produk.ts murni, tanpa dependensi server).
import AturanClient from "@/components/aturan-client";
import { anekaMasterMeta, listAnekaMaster } from "@/lib/aneka-master";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cek Aturan Produk" };

export default async function AturanAnekaPage() {
  const rows = listAnekaMaster().map((p) => ({
    id: p.id,
    name: p.name,
    kategori: p.kategori,
    status: p.status,
  }));
  const meta = anekaMasterMeta();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
          Marketplace · Aneka (Supplier)
        </p>
        <h1 className="text-xl font-bold text-slate-900">Cek Aturan Produk</h1>
        <p className="text-sm text-slate-500">
          Rule engine produk dilarang — memeriksa NAMA setiap produk master
          terhadap aturan 2 lapis dari hasil riset (lapis umum yang berlaku
          di semua marketplace, plus aturan khas per marketplace). Hasil
          blokir/review menjadi gerbang upload otomatis Tahap 6: produk
          dilarang tidak akan dikirim ke channel terkait sebelum nama
          dibersihkan. KTD Store (situs sendiri) tidak diperiksa —
          kebijakan internal bebas.
        </p>
      </div>
      <AturanClient rows={rows} meta={meta} />
    </div>
  );
}
