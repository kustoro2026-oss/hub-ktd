// Impor massal pemetaan awal (seed) Lazada → Aneka dari
// src/lib/lazada-map-seed.json. Hanya menambah baris yang belum ada —
// pemetaan manual yang sudah tersimpan tidak ditimpa. Perlu sesi admin
// ATAU secret cron (saluran yang sama dengan route pemulihan lain).
import { isAuthed } from "@/lib/auth";
import seedData from "@/lib/lazada-map-seed.json";
import { seedLazadaProductMaps } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type SeedRow = {
  lazada_sku?: string;
  seller_sku?: string;
  product_name?: string;
  aneka_product_id?: string;
  aneka_variant_id?: string;
  aneka_product_name?: string;
  enabled?: number;
};

/** True bila secret cron cocok lewat salah satu saluran yang didukung. */
function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  const given =
    (auth.startsWith("Bearer ") ? auth.slice(7) : "") ||
    request.headers.get("x-cron-secret") ||
    new URL(request.url).searchParams.get("secret");
  return given === secret;
}

export async function POST(request: Request) {
  if (!cronAuthorized(request) && !(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  try {
    const rows = (seedData as { rows?: SeedRow[] }).rows ?? [];
    const valid = rows.filter(
      (r): r is SeedRow & { lazada_sku: string; aneka_product_id: string } =>
        typeof r.lazada_sku === "string" &&
        r.lazada_sku !== "" &&
        typeof r.aneka_product_id === "string" &&
        r.aneka_product_id !== "",
    );
    if (valid.length === 0) {
      return Response.json(
        { ok: false, detail: "Data pemetaan awal kosong" },
        { status: 400 },
      );
    }
    const res = await seedLazadaProductMaps(valid);
    return Response.json({ ok: true, detail: "Pemetaan awal diimpor", ...res });
  } catch (e) {
    const detail = `Kesalahan server: ${
      e instanceof Error ? e.message : "tidak dikenal"
    }`;
    const status = process.env.NODE_ENV === "production" ? 200 : 502;
    return Response.json({ ok: false, detail }, { status });
  }
}
