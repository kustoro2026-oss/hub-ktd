// Varian produk Blibli (harga/stok per gdnSku + pickup point) — read-only.
// Query: productSku (mis. KTS-70007-00893).
import { isAuthed } from "@/lib/auth";
import { getBlibliProductVariants } from "@/lib/blibli-products";
import { type NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }

  const productSku = (req.nextUrl.searchParams.get("productSku") ?? "").trim();
  if (productSku === "") {
    return Response.json({ ok: false, detail: "productSku wajib diisi." }, { status: 400 });
  }

  const result = await getBlibliProductVariants(productSku);
  if (!result.ok) {
    return Response.json({ ok: false, detail: result.detail });
  }
  return Response.json({ ok: true, items: result.data });
}
