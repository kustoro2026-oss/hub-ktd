// Override stok KTD Store (hasil kurangi otomatis & sinkron manual) —
// dibaca situs toko (kustoro2026.com) saat menampilkan katalog & checkout.
// PUBLIK (tanpa auth): isinya hanya stok, bukan data sensitif. Cache 60
// detik di globalThis + edge supaya perubahan stok cepat menyebar ke situs
// (±2-3 menit), tanpa menekan basis data.
import { listKtdStoreStok } from "@/lib/db";

export const dynamic = "force-dynamic";

const gStok = globalThis as unknown as {
  __ktdStokJual?: { at: number; data: Record<string, number> };
};
const STOK_CACHE_TTL_MS = 60 * 1000;
const CACHE_HEADERS = { "cache-control": "public, max-age=60, s-maxage=60" };

export async function GET() {
  const now = Date.now();
  const hit = gStok.__ktdStokJual;
  if (hit && now - hit.at < STOK_CACHE_TTL_MS) {
    return Response.json({ ok: true, data: hit.data }, { headers: CACHE_HEADERS });
  }
  try {
    const rows = await listKtdStoreStok();
    const data: Record<string, number> = {};
    for (const r of rows) data[r.aneka_id] = r.stok;
    gStok.__ktdStokJual = { at: now, data };
    return Response.json({ ok: true, data }, { headers: CACHE_HEADERS });
  } catch (e) {
    return Response.json(
      {
        ok: false,
        detail: `Gagal membaca stok: ${
          e instanceof Error ? e.message : "tidak dikenal"
        }`,
      },
      { status: 500 },
    );
  }
}
