// Impor massal pemetaan awal (seed) TikTok → Aneka dari
// src/lib/aneka-map-seed.json. Hanya menambah baris yang belum ada —
// pemetaan manual yang sudah tersimpan tidak ditimpa. Perlu sesi admin.
import { isAuthed } from "@/lib/auth";
import seedData from "@/lib/aneka-map-seed.json";
import { seedAnekaProductMaps } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type SeedRow = {
  tiktok_product_id?: string;
  tiktok_product_name?: string;
  tiktok_sku?: string;
  aneka_product_id?: string;
  aneka_variant_id?: string;
  aneka_product_name?: string;
  enabled?: number;
};

export async function POST() {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  try {
    const rows = (seedData as { rows?: SeedRow[] }).rows ?? [];
    const valid = rows.filter(
      (r): r is SeedRow & { tiktok_product_id: string; aneka_product_id: string } =>
        typeof r.tiktok_product_id === "string" &&
        r.tiktok_product_id !== "" &&
        typeof r.aneka_product_id === "string" &&
        r.aneka_product_id !== "",
    );
    if (valid.length === 0) {
      return Response.json(
        { ok: false, detail: "Data pemetaan awal kosong" },
        { status: 400 },
      );
    }
    const res = await seedAnekaProductMaps(valid);
    return Response.json({ ok: true, detail: "Pemetaan awal diimpor", ...res });
  } catch (e) {
    const detail = `Kesalahan server: ${
      e instanceof Error ? e.message : "tidak dikenal"
    }`;
    const status = process.env.NODE_ENV === "production" ? 200 : 502;
    return Response.json({ ok: false, detail }, { status });
  }
}
