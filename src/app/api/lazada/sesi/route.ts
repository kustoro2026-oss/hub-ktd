// Sesi web Seller Center (cookie mtop) — disimpan supaya Hub bisa mencetak
// AWB resmi otomatis (mtop print) tanpa unggah manual. Cookie berisi sesi
// sensitif sehingga hanya admin yang boleh membaca/menulis; GET tidak
// pernah mengembalikan nilai cookie, hanya statusnya.
import { isAuthed } from "@/lib/auth";
import { getLazadaWebSessionInfo } from "@/lib/lazada-mtop";
import { saveLazadaWebSession } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Short code toko KTD Store (Seller Center → Pengaturan → Kode Pendek). */
const SELLER = "ID69LJAH8J";

export async function GET() {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  return Response.json(await getLazadaWebSessionInfo());
}

export async function POST(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  let body: { cookie_text?: string } = {};
  try {
    body = (await request.json()) as { cookie_text?: string };
  } catch {
    // body rusak — ditangani validasi di bawah.
  }
  const cookieText = (body.cookie_text ?? "").trim();
  if (cookieText.length < 40) {
    return Response.json({ error: "cookie_text kosong" }, { status: 400 });
  }
  if (!cookieText.includes("_m_h5_tk")) {
    return Response.json(
      { error: "cookie tidak memuat token mtop (_m_h5_tk)" },
      { status: 400 },
    );
  }
  const tk = cookieText
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith("_m_h5_tk="));
  const exp = tk?.split("_").pop() ?? "";
  await saveLazadaWebSession(SELLER, cookieText, exp);
  return Response.json({
    ok: true,
    seller_id: SELLER,
    panjang: cookieText.length,
    catatan:
      "Sesi tersimpan — Cetak Resi kini mencetak AWB resmi otomatis dari Seller Center.",
  });
}

/** Baca nilai cookie tersimpan (dipakai debug lokal saja — tetap admin). */
export async function DELETE() {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  await saveLazadaWebSession(SELLER, "");
  return Response.json({ ok: true, seller_id: SELLER, catatan: "Sesi dihapus" });
}
