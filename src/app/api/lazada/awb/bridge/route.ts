// Titik temu engine jembatan browser (window.__lzdBridge di halaman
// Seller Center yang login):
//   GET  ?secret=...  → daftar pekerjaan pending + detak engine
//   POST {order_id, pdf_base64|error} → hasil cetak AWB
//   PUT  {status}     → detak engine (status opsional)
// Dipanggil lintas-origin dari https://sellercenter.lazada.co.id — CORS
// dibuka khusus origin itu, dan setiap panggilan wajib membawa secret
// LZD_BRIDGE_SECRET (header x-bridge-secret atau query secret).
import {
  awbBridgeHeartbeat,
  awbPendingJobs,
  awbSubmitResult,
} from "@/lib/lazada-awb";

export const dynamic = "force-dynamic";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "https://sellercenter.lazada.co.id",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-bridge-secret",
  "Access-Control-Max-Age": "86400",
};

function ok(data: unknown): Response {
  return Response.json(data, { headers: CORS });
}

function err(msg: string, status = 400): Response {
  return Response.json({ error: msg }, { status, headers: CORS });
}

/** Validasi secret engine — wajib untuk SEMUA metode jembatan. */
function secretOk(request: Request): boolean {
  const want = process.env.LZD_BRIDGE_SECRET ?? "";
  if (!want) return false;
  const header = request.headers.get("x-bridge-secret") ?? "";
  const query = new URL(request.url).searchParams.get("secret") ?? "";
  return header === want || query === want;
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS });
}

/** Daftar pekerjaan pending + detak. */
export async function GET(request: Request): Promise<Response> {
  if (!secretOk(request)) return err("rahasia jembatan salah", 401);
  // Setiap polling dihitung sebagai detak engine.
  await awbBridgeHeartbeat("online");
  const jobs = await awbPendingJobs();
  return ok({ jobs });
}

/** Hasil cetak satu pekerjaan (PDF base64 atau error). */
export async function POST(request: Request): Promise<Response> {
  if (!secretOk(request)) return err("rahasia jembatan salah", 401);
  let body: { order_id?: string; pdf_base64?: string; error?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return err("body bukan JSON");
  }
  const orderId = (body.order_id ?? "").trim();
  if (!orderId) return err("order_id kosong");
  const hasil = await awbSubmitResult(orderId, {
    pdf_base64: body.pdf_base64,
    error: body.error,
  });
  return ok(hasil);
}

/** Detak engine (status opsional — mis. "logout" saat sesi hilang). */
export async function PUT(request: Request): Promise<Response> {
  if (!secretOk(request)) return err("rahasia jembatan salah", 401);
  let status = "online";
  try {
    const body = (await request.json()) as { status?: string };
    status = (body.status ?? "online").slice(0, 100);
  } catch {
    // body kosong — tetap dihitung detak online.
  }
  await awbBridgeHeartbeat(status);
  return ok({ heartbeat: "ok" });
}
