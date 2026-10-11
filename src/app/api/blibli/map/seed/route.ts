// Impor massal pemetaan awal (seed) Blibli → Aneka dari
// src/lib/blibli-map-seed.json. Hanya menambah baris yang belum ada —
// pemetaan manual yang sudah tersimpan tidak ditimpa. Perlu sesi admin.
import { isAuthed } from "@/lib/auth";
import seedData from "@/lib/blibli-map-seed.json";
import { seedBlibliProductMaps } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type SeedRow = {
  blibli_sku?: string;
  seller_sku?: string;
  product_name?: string;
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
      (r): r is SeedRow & { blibli_sku: string; aneka_product_id: string } =>
        typeof r.blibli_sku === "string" &&
        r.blibli_sku !== "" &&
        typeof r.aneka_product_id === "string" &&
        r.aneka_product_id !== "",
    );
    if (valid.length === 0) {
      return Response.json(
        { ok: false, detail: "Data pemetaan awal kosong" },
        { status: 400 },
      );
    }
    const res = await seedBlibliProductMaps(valid);
    return Response.json({ ok: true, detail: "Pemetaan awal diimpor", ...res });
  } catch (e) {
    const detail = `Kesalahan server: ${
      e instanceof Error ? e.message : "tidak dikenal"
    }`;
    const status = process.env.NODE_ENV === "production" ? 200 : 502;
    return Response.json({ ok: false, detail }, { status });
  }
}
