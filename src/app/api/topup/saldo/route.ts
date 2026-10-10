// Saldo Digiflazz terkini — proxy aman ke API toko.
//
// Hub tidak menyimpan kredensial Digiflazz; saldo diambil dari endpoint
// admin toko (GET /api/topup/cek-saldo) yang dijaga x-topup-secret. Hasil
// di-cache in-memory 60 detik supaya polling tidak membebani toko.
// Kegagalan dikembalikan 200 {ok:false, detail} (konvensi graceful-error).
import { isAuthed } from "@/lib/auth";
import { topupStoreUrl } from "@/lib/topup";

export const runtime = "nodejs";

const g = globalThis as unknown as { __ktdSaldoCache?: { at: number; data: unknown } };
const CACHE_MS = 60_000;

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

  const cache = g.__ktdSaldoCache;
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return Response.json(cache.data);
  }

  const url = `${topupStoreUrl()}/api/topup/cek-saldo`;
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

  const j = body as { ok?: boolean; balance?: number; detail?: string; error?: string };
  const data = {
    ok: j.ok === true,
    balance: typeof j.balance === "number" ? j.balance : undefined,
    detail: j.detail ?? j.error,
    at: Date.now(),
    sumber: url,
  };
  g.__ktdSaldoCache = { at: Date.now(), data };
  return Response.json(data);
}
