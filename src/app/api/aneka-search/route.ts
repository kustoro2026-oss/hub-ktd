// Cari produk Aneka dari snapshot katalog (GET ?q=...). Perlu sesi admin.
import { isAuthed } from "@/lib/auth";
import { searchAnekaCatalog } from "@/lib/aneka-map";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return Response.json({ ok: true, results: searchAnekaCatalog(q, 12) });
}
