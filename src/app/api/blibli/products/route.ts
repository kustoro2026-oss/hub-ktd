// Daftar produk Blibli (KTD STORE) untuk halaman Produk KTD Hub.
// Query: state (default ACTIVE), q (nama produk, cocok sebagian), page.
import { isAuthed } from "@/lib/auth";
import {
  listBlibliProducts,
  type BlibliProductState,
} from "@/lib/blibli-products";
import { type NextRequest } from "next/server";

const STATES = new Set<string>([
  "ACTIVE",
  "OOS",
  "ARCHIVED",
  "SUSPENDED",
  "IN_PROGRESS",
  "NEED_CORRECTION",
  "REJECTED",
]);

export async function GET(req: NextRequest) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const stateRaw = sp.get("state") ?? "ACTIVE";
  const state = (STATES.has(stateRaw) ? stateRaw : "ACTIVE") as BlibliProductState;
  const q = (sp.get("q") ?? "").trim();
  const page = Math.max(0, Number.parseInt(sp.get("page") ?? "0", 10) || 0);

  const result = await listBlibliProducts({
    state,
    ...(q !== "" ? { productName: q } : {}),
    page,
    size: 50,
  });
  if (!result.ok) {
    return Response.json({ ok: false, detail: result.detail });
  }
  return Response.json({
    ok: true,
    items: result.data.items,
    totalRecord: result.data.totalRecord,
  });
}
