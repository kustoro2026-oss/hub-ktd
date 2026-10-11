// Halaman Pemetaan Produk — pasangkan produk Blibli dengan produk
// Aneka (Fase 1 eksekusi pesanan otomatis, mode semi-otomatis).
// Bagian dari grup menu Marketplace → Blibli.
import { listBlibliProductMaps } from "@/lib/db";
import {
  anekaCatalogGeneratedAt,
  getSeenBlibliProducts,
} from "@/lib/aneka-map";
import BlibliMapClient from "@/components/blibli-map-client";
import seedData from "@/lib/blibli-map-seed.json";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pemetaan Produk Aneka" };

export default async function BlibliPemetaanPage() {
  const [maps, seen] = await Promise.all([
    listBlibliProductMaps(),
    getSeenBlibliProducts(),
  ]);

  // productSku Blibli yang tercakup seed pemetaan awal (untuk tombol impor).
  const seedIds = (
    (seedData as { rows?: { blibli_sku?: string }[] }).rows ?? []
  )
    .map((r) => r.blibli_sku ?? "")
    .filter(Boolean);

  return (
    <BlibliMapClient
      initialMaps={maps}
      initialSeen={seen.ok ? seen.products : []}
      seenDetail={seen.ok ? "" : seen.detail}
      catalogAt={anekaCatalogGeneratedAt()}
      catalogCount={766}
      seedIds={seedIds}
    />
  );
}
