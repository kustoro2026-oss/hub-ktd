// Pemetaan produk Blibli → Aneka (Fase 1): GET daftar pemetaan + produk
// Blibli dari pesanan, POST simpan pemetaan, DELETE hapus pemetaan.
// Perlu sesi admin.
import { isAuthed } from "@/lib/auth";
import {
  deleteBlibliProductMap,
  listBlibliProductMaps,
  saveBlibliProductMap,
} from "@/lib/db";
import {
  findAnekaCatalogById,
  getSeenBlibliProducts,
} from "@/lib/aneka-map";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const maps = await listBlibliProductMaps();
  const seen = await getSeenBlibliProducts();
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
    blibli_sku?: string;
    seller_sku?: string;
    product_name?: string;
    aneka_product_id?: string;
  };
  const blibliSku = String(body.blibli_sku ?? "").trim();
  const anekaProductId = String(body.aneka_product_id ?? "").trim();
  if (!blibliSku || !anekaProductId) {
    return Response.json(
      { ok: false, detail: "productSku Blibli dan product_id Aneka wajib diisi." },
      { status: 400 },
    );
  }
  const aneka = findAnekaCatalogById(anekaProductId);
  try {
    await saveBlibliProductMap({
      blibli_sku: blibliSku,
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
  const blibliSku =
    new URL(request.url).searchParams.get("blibli_sku") ?? "";
  if (!blibliSku) {
    return Response.json(
      { error: "blibli_sku tidak ada" },
      { status: 400 },
    );
  }
  try {
    await deleteBlibliProductMap(blibliSku);
    return Response.json({ ok: true });
  } catch (e) {
    const result = `Kesalahan server: ${
      e instanceof Error ? e.message : "tidak dikenal"
    }`;
    const status = process.env.NODE_ENV === "production" ? 200 : 502;
    return Response.json({ ok: false, result }, { status });
  }
}
