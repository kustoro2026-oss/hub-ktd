// Proxy konsol API Digiflazz — diteruskan ke route admin toko
// (POST /api/topup/digiflazz) yang dijaga x-topup-secret. Hub tidak
// menyimpan kredensial Digiflazz; penandatanganan md5 dilakukan di toko.
// Guard sesi: isAuthed (401 {"error":"Belum masuk"} tanpa sesi).
import { isAuthed } from "@/lib/auth";
import { topupStoreUrl } from "@/lib/topup";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }

  const secret = process.env.TOPUP_ADMIN_SECRET;
  if (!secret) {
    return Response.json({
      ok: false,
      detail: "Rahasia admin top-up (TOPUP_ADMIN_SECRET) belum diatur di KTD Hub.",
    });
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object" || !("action" in body)) {
    return Response.json(
      { ok: false, detail: "action wajib diisi." },
      { status: 400 },
    );
  }

  const url = `${topupStoreUrl()}/api/topup/digiflazz`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-topup-secret": secret,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (e) {
    return Response.json({
      ok: false,
      detail: `Tidak bisa menghubungi ${url}: ${e instanceof Error ? e.message : "galat jaringan"}`,
    });
  }

  let j: unknown = null;
  try {
    j = await res.json();
  } catch {
    j = null;
  }
  if (j && typeof j === "object") {
    return Response.json(j, { status: res.status });
  }
  // 200 di produksi: Cloudflare menutupi body 5xx dengan halaman teks polos,
  // jadi detail ini tidak akan pernah sampai ke browser bila memakai 502.
  const status = process.env.NODE_ENV === "production" ? 200 : 502;
  return Response.json(
    {
      ok: false,
      detail: `API toko menjawab HTTP ${res.status} — ${res.status === 403 ? "rahasia admin tidak cocok dengan produksi toko" : "respons tidak dikenali"}`,
    },
    { status },
  );
}
