// Pemeriksaan aturan produk dilarang (Tahap 5). Hanya admin.
//
// GET /api/aneka/aturan?op=semua
//     → periksa seluruh produk master Aneka terhadap rule engine (2 lapis)
// GET /api/aneka/aturan?op=uji&teks=Nama%20produk
//     → uji satu teks nama bebas (untuk kotak tester di UI & skrip Tahap 6)
import { isAuthed } from "@/lib/auth";
import { anekaMasterMeta, listAnekaMaster } from "@/lib/aneka-master";
import { cekAturanProduk, ringkasHasil } from "@/lib/aturan-produk";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function bad(detail: string) {
  return Response.json({ ok: false, detail }, { status: 400 });
}

export async function GET(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const url = new URL(request.url);
  const op = url.searchParams.get("op") ?? "semua";

  if (op === "uji") {
    const teks = (url.searchParams.get("teks") ?? "").trim();
    if (!teks) return bad("teks wajib diisi.");
    return Response.json({ ok: true, hasil: cekAturanProduk(teks) });
  }

  try {
    const baris = listAnekaMaster().map((p) => ({
      id: p.id,
      name: p.name,
      kategori: p.kategori,
      hasil: cekAturanProduk(p.name, p.kategori),
    }));
    return Response.json({
      ok: true,
      meta: anekaMasterMeta(),
      ringkasan: ringkasHasil(baris.map((b) => b.hasil)),
      baris,
    });
  } catch (e) {
    const detail = `Kesalahan server: ${
      e instanceof Error ? e.message : "tidak dikenal"
    }`;
    const status = process.env.NODE_ENV === "production" ? 200 : 502;
    return Response.json({ ok: false, detail }, { status });
  }
}
