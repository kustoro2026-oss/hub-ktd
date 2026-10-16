// Pemetaan produk Lazada → Aneka (Fase 1): GET daftar pemetaan + produk
// Lazada dari pesanan, POST simpan pemetaan, DELETE hapus pemetaan.
// Perlu sesi admin.
import { isAuthed } from "@/lib/auth";
import {
  deleteLazadaProductMap,
  listLazadaProductMaps,
  saveLazadaProductMap,
} from "@/lib/db";
import {
  findAnekaCatalogById,
  getSeenLazadaProducts,
} from "@/lib/aneka-map";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const maps = await listLazadaProductMaps();
  const seen = await getSeenLazadaProducts();
  return Response.json({
    ok: true,
    maps,
    seen: seen.ok ? seen.products : [],
    seenDetail: seen.ok ? "" : seen.detail,
  });
}

export async function POST(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    lazada_sku?: string;
    seller_sku?: string;
    product_name?: string;
    aneka_product_id?: string;
  };
  const lazadaSku = String(body.lazada_sku ?? "").trim();
  const anekaProductId = String(body.aneka_product_id ?? "").trim();
  if (!lazadaSku || !anekaProductId) {
    return Response.json(
      { ok: false, detail: "SellerSku Lazada dan product_id Aneka wajib diisi." },
      { status: 400 },
    );
  }
  const aneka = findAnekaCatalogById(anekaProductId);
  try {
    await saveLazadaProductMap({
      lazada_sku: lazadaSku,
      seller_sku: String(body.seller_sku ?? "").trim(),
      product_name: String(body.product_name ?? "").trim(),
      aneka_product_id: anekaProductId,
      aneka_product_name: aneka?.name ?? "",
    });
    return Response.json({ ok: true });
  } catch (e) {
    const result = `Kesalahan server: ${
      e instanceof Error ? e.message : "tidak dikenal"
    }`;
    const status = process.env.NODE_ENV === "production" ? 200 : 502;
    return Response.json({ ok: false, result }, { status });
  }
}

export async function DELETE(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const lazadaSku =
    new URL(request.url).searchParams.get("lazada_sku") ?? "";
  if (!lazadaSku) {
    return Response.json(
      { error: "lazada_sku tidak ada" },
      { status: 400 },
    );
  }
  try {
    await deleteLazadaProductMap(lazadaSku);
    return Response.json({ ok: true });
  } catch (e) {
    const result = `Kesalahan server: ${
      e instanceof Error ? e.message : "tidak dikenal"
    }`;
    const status = process.env.NODE_ENV === "production" ? 200 : 502;
    return Response.json({ ok: false, result }, { status });
  }
}
