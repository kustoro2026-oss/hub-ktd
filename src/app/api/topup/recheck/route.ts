// Cek ulang order top-up pending — proxy aman ke API toko.
//
// Memanggil GET /api/topup/cron/pending milik toko (menerima x-topup-secret):
// menandai pesanan gateway kedaluwarsa + mengirim ulang cek status transaksi
// Digiflazz yang masih Pending (idempoten via ref_id yang sama). Aman
// dijalankan kapan pun — tidak mengubah status apa pun secara manual.
import { isAuthed } from "@/lib/auth";
import { topupStoreUrl } from "@/lib/topup";

export const runtime = "nodejs";

export async function POST() {
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

  const url = `${topupStoreUrl()}/api/topup/cron/pending`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "x-topup-secret": secret },
      cache: "no-store",
    });
  } catch (e) {
    return Response.json({
      ok: false,
      detail: `Tidak bisa menghubungi ${url}: ${e instanceof Error ? e.message : "galat jaringan"}`,
    });
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok || !body || typeof body !== "object" || !("ok" in body)) {
    return Response.json({
      ok: false,
      detail: `API toko menjawab HTTP ${res.status} — ${res.status === 403 ? "rahasia admin tidak cocok dengan produksi toko" : "respons tidak dikenali"}`,
    });
  }

  const j = body as {
    ok?: boolean;
    expired?: number;
    rechecked?: number;
    results?: unknown;
    detail?: string;
  };
  return Response.json({
    ok: j.ok === true,
    expired: typeof j.expired === "number" ? j.expired : undefined,
    rechecked: typeof j.rechecked === "number" ? j.rechecked : undefined,
    results: Array.isArray(j.results) ? j.results : [],
    detail: j.detail,
    at: Date.now(),
    sumber: url,
  });
}
