// Pemetaan produk TikTok → Aneka (Fase 1): GET daftar pemetaan + produk
// TikTok dari pesanan, POST simpan pemetaan, DELETE hapus pemetaan.
// Perlu sesi admin.
import { isAuthed } from "@/lib/auth";
import {
  deleteAnekaProductMap,
  listAnekaProductMaps,
  saveAnekaProductMap,
} from "@/lib/db";
import {
  findAnekaCatalogById,
  getSeenTiktokProducts,
} from "@/lib/aneka-map";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const maps = await listAnekaProductMaps();
  const seen = await getSeenTiktokProducts();
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
    tiktok_product_id?: string;
    tiktok_product_name?: string;
    aneka_product_id?: string;
  };
  const tiktokProductId = String(body.tiktok_product_id ?? "").trim();
  const anekaProductId = String(body.aneka_product_id ?? "").trim();
  if (!tiktokProductId || !anekaProductId) {
    return Response.json(
      { ok: false, detail: "product_id TikTok dan Aneka wajib diisi." },
      { status: 400 },
    );
  }
  const aneka = findAnekaCatalogById(anekaProductId);
  try {
    await saveAnekaProductMap({
      tiktok_product_id: tiktokProductId,
      tiktok_product_name: String(body.tiktok_product_name ?? "").trim(),
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
  const tiktokProductId =
    new URL(request.url).searchParams.get("tiktok_product_id") ?? "";
  if (!tiktokProductId) {
    return Response.json(
      { error: "tiktok_product_id tidak ada" },
      { status: 400 },
    );
  }
  try {
    await deleteAnekaProductMap(tiktokProductId);
    return Response.json({ ok: true });
  } catch (e) {
    const result = `Kesalahan server: ${
      e instanceof Error ? e.message : "tidak dikenal"
    }`;
    const status = process.env.NODE_ENV === "production" ? 200 : 502;
    return Response.json({ ok: false, result }, { status });
  }
}
