// Harga jual KTD Store (override rekomendasi jual Aneka) — dibaca situs
// toko (kustoro2026.com) saat menampilkan katalog & menghitung checkout.
// PUBLIK (tanpa auth): isinya hanya harga, bukan data sensitif. Cache 5
// menit di globalThis supaya lalu lintas situs tidak menekan basis data.
import { listKtdStoreHarga } from "@/lib/db";

export const dynamic = "force-dynamic";

const gHarga = globalThis as unknown as {
  __ktdHargaJual?: { at: number; data: Record<string, number> };
};
const HARGA_CACHE_TTL_MS = 5 * 60 * 1000;

export async function GET() {
  const now = Date.now();
  const hit = gHarga.__ktdHargaJual;
  if (hit && now - hit.at < HARGA_CACHE_TTL_MS) {
    return Response.json(
      { ok: true, data: hit.data },
      { headers: { "cache-control": "public, max-age=300, s-maxage=300" } },
    );
  }
  try {
    const rows = await listKtdStoreHarga();
    const data: Record<string, number> = {};
    for (const r of rows) data[r.aneka_id] = r.harga;
    gHarga.__ktdHargaJual = { at: now, data };
    return Response.json(
      { ok: true, data },
      { headers: { "cache-control": "public, max-age=300, s-maxage=300" } },
    );
  } catch (e) {
    return Response.json(
      {
        ok: false,
        detail: `Gagal membaca harga: ${
          e instanceof Error ? e.message : "tidak dikenal"
        }`,
      },
      { status: 500 },
    );
  }
}
