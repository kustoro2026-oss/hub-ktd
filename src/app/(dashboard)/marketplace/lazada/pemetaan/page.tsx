// Halaman Pemetaan Produk — pasangkan produk Lazada dengan produk
// Aneka (Fase 1 eksekusi pesanan otomatis, mode semi-otomatis).
// Bagian dari grup menu Marketplace → Lazada.
import { listLazadaProductMaps } from "@/lib/db";
import { anekaCatalogGeneratedAt } from "@/lib/aneka-map";
import LazadaMapClient from "@/components/lazada-map-client";
import seedData from "@/lib/lazada-map-seed.json";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pemetaan Produk Aneka" };

export default async function LazadaPemetaanPage() {
  // Daftar "produk terlihat" TIDAK ditarik saat render server (4 panggilan
  // API Lazada berurutan + HTML besar) — klien memuatnya setelah mount lewat
  // /api/lazada/map, yang hasilnya di-cache 5 menit di server.
  const maps = await listLazadaProductMaps();

  // SellerSku Lazada yang tercakup seed pemetaan awal (untuk tombol impor).
  const seedIds = (
    (seedData as { rows?: { lazada_sku?: string }[] }).rows ?? []
  )
    .map((r) => r.lazada_sku ?? "")
    .filter(Boolean);

  return (
    <LazadaMapClient
      initialMaps={maps}
      initialSeen={[]}
      seenDetail=""
      catalogAt={anekaCatalogGeneratedAt()}
      catalogCount={766}
      seedIds={seedIds}
    />
  );
}
