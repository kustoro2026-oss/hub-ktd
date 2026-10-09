// Eksekusi pesanan TikTok → Aneka (Fase 2, semi-otomatis). Perlu sesi admin.
// action "setuju" menjalankan rantai checkout Aneka penuh untuk antrean
// "menunggu"/"gagal"; action "batalkan" membatalkan antrean "menunggu".
import { isAuthed } from "@/lib/auth";
import { cancelAnekaExec, executeAnekaOrder } from "@/lib/aneka-exec";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }

  let orderId = "";
  let action = "";
  let force = false;
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as {
      order_id?: string;
      action?: string;
      force?: boolean;
    };
    orderId = String(body.order_id ?? "");
    action = String(body.action ?? "");
    force = body.force === true;
  }
  if (!orderId) {
    orderId = new URL(request.url).searchParams.get("order_id") ?? "";
    action = new URL(request.url).searchParams.get("action") ?? "";
    force = new URL(request.url).searchParams.get("force") === "true";
  }
  if (!orderId) {
    return Response.json({ error: "order_id tidak ada" }, { status: 400 });
  }
  if (action !== "setuju" && action !== "batalkan") {
    return Response.json({ error: "action harus setuju atau batalkan" }, { status: 400 });
  }

  try {
    const res =
      action === "batalkan"
        ? await cancelAnekaExec(orderId).then(() => ({
            ok: true,
            detail: "Eksekusi dibatalkan",
          }))
        : await executeAnekaOrder(orderId, { force });
    // Di production, body 5xx bisa diganti Cloudflare dengan halaman 502
    // generik — balas 200 + pesan supaya alasan aslinya sampai ke browser.
    const status = res.ok ? 200 : process.env.NODE_ENV === "production" ? 200 : 502;
    return Response.json(res, { status });
  } catch (e) {
    const result = `Kesalahan server: ${
      e instanceof Error ? e.message : "tidak dikenal"
    }`;
    const status = process.env.NODE_ENV === "production" ? 200 : 502;
    return Response.json({ ok: false, detail: result }, { status });
  }
}
