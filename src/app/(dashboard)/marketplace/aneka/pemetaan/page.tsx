// Halaman Pemetaan Produk — pasangkan produk TikTok Shop dengan produk
// Aneka (Fase 1 eksekusi pesanan otomatis, mode semi-otomatis).
// Bagian dari grup menu Marketplace → Aneka.
import { listAnekaProductMaps } from "@/lib/db";
import {
  anekaCatalogGeneratedAt,
  getSeenTiktokProducts,
} from "@/lib/aneka-map";
import AnekaMapClient from "@/components/aneka-map-client";
import seedData from "@/lib/aneka-map-seed.json";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pemetaan Produk Aneka" };

export default async function AnekaPemetaanPage() {
  const [maps, seen] = await Promise.all([
    listAnekaProductMaps(),
    getSeenTiktokProducts(),
  ]);

  // ID produk TikTok yang tercakup seed pemetaan awal (untuk tombol impor).
  const seedIds = (
    (seedData as { rows?: { tiktok_product_id?: string }[] }).rows ?? []
  )
    .map((r) => r.tiktok_product_id ?? "")
    .filter(Boolean);

  return (
    <AnekaMapClient
      initialMaps={maps}
      initialSeen={seen.ok ? seen.products : []}
      seenDetail={seen.ok ? "" : seen.detail}
      catalogAt={anekaCatalogGeneratedAt()}
      catalogCount={766}
      seedIds={seedIds}
    />
  );
}
