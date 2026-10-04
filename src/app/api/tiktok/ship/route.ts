// Atur pengiriman (jadwalkan penjemputan) untuk satu pesanan TikTok Shop —
// sama seperti menu "Atur Pengiriman" di aplikasi. Perlu sesi admin.
import { isAuthed } from "@/lib/auth";
import { arrangeShipmentForOrder } from "@/lib/tiktok-resi";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }

  let orderId = "";
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as {
      order_id?: string;
    };
    orderId = String(body.order_id ?? "");
  }
  if (!orderId) {
    orderId = new URL(request.url).searchParams.get("order_id") ?? "";
  }
  if (!orderId) {
    return Response.json({ error: "order_id tidak ada" }, { status: 400 });
  }

  try {
    const res = await arrangeShipmentForOrder(orderId);
    // Di production, body 5xx bisa diganti Cloudflare dengan halaman 502
    // generik — balas 200 + pesan supaya alasan aslinya sampai ke browser.
    const status = res.ok ? 200 : process.env.NODE_ENV === "production" ? 200 : 502;
    return Response.json(res, { status });
  } catch (e) {
    const result = `Kesalahan server: ${
      e instanceof Error ? e.message : "tidak dikenal"
    }`;
    const status = process.env.NODE_ENV === "production" ? 200 : 502;
    return Response.json({ ok: false, result }, { status });
  }
}
