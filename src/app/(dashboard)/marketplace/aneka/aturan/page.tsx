// Halaman Cek Aturan (menu Aneka, Tahap 5) — server page. Meneruskan
// daftar produk master ke komponen client; pemeriksaan rule engine
// dihitung di client (aturan-produk.ts murni, tanpa dependensi server).
import AturanClient from "@/components/aturan-client";
import { anekaMasterMeta, listAnekaMaster } from "@/lib/aneka-master";
import PageHeader from "@/components/page-header";

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
      <PageHeader
        eyebrow="Marketplace · Aneka (Supplier)"
        title="Cek Aturan Produk"
        subtitle="Periksa nama produk terhadap aturan produk dilarang per marketplace"
      />
      <AturanClient rows={rows} meta={meta} />
    </div>
  );
}
