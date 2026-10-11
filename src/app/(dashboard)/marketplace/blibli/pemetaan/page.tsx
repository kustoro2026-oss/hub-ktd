// Halaman Pemetaan Produk — pasangkan produk Blibli dengan produk
// Aneka (Fase 1 eksekusi pesanan otomatis, mode semi-otomatis).
// Bagian dari grup menu Marketplace → Blibli.
import { listBlibliProductMaps } from "@/lib/db";
import {
  anekaCatalogGeneratedAt,
  getSeenBlibliProducts,
} from "@/lib/aneka-map";
import BlibliMapClient from "@/components/blibli-map-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pemetaan Produk Aneka" };

export default async function BlibliPemetaanPage() {
  const [maps, seen] = await Promise.all([
    listBlibliProductMaps(),
    getSeenBlibliProducts(),
  ]);

  return (
    <BlibliMapClient
      initialMaps={maps}
      initialSeen={seen.ok ? seen.products : []}
      seenDetail={seen.ok ? "" : seen.detail}
      catalogAt={anekaCatalogGeneratedAt()}
      catalogCount={766}
    />
  );
}
