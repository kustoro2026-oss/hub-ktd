// Daftar produk Lazada (KTD STORE) untuk halaman Produk KTD Hub.
// Query: filter (default all: live/inactive/sold-out), q (nama produk,
// cocok sebagian — disaring di sisi server karena API tidak mendukung
// pencarian nama), page.
import { isAuthed } from "@/lib/auth";
import {
  listLazadaProducts,
  type LazadaProductsFilter,
} from "@/lib/lazada-products";
import { type NextRequest } from "next/server";

const FILTERS = new Set<string>(["all", "live", "inactive", "sold-out"]);

export async function GET(req: NextRequest) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const filterRaw = sp.get("filter") ?? "all";
  const filter = (FILTERS.has(filterRaw) ? filterRaw : "all") as NonNullable<
    LazadaProductsFilter["filter"]
  >;
  const q = (sp.get("q") ?? "").trim().toLowerCase();
  const page = Math.max(0, Number.parseInt(sp.get("page") ?? "0", 10) || 0);

  const result = await listLazadaProducts({
    filter,
    offset: page * 50,
    limit: 50,
  });
  if (!result.ok) {
    return Response.json({ ok: false, detail: result.detail });
  }
  // Pencarian nama dilakukan di sisi server (contains, case-insensitive) —
  // API GetProducts tidak punya filter nama.
  const items = result.data.items.filter((p) => {
    if (q === "") return true;
    const nama = String(p.attributes?.name ?? "").toLowerCase();
    const skus = (p.skus ?? []).map((s) => s.SellerSku.toLowerCase());
    return nama.includes(q) || skus.some((s) => s.includes(q));
  });
  return Response.json({
    ok: true,
    items,
    totalRecord: result.data.total,
  });
}
