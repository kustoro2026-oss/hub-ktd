// Kirim resi PDF satu pesanan ke WhatsApp admin secara manual (tombol
// "Kirim Resi" di halaman Pesanan). Perlu sesi admin — tindakan ini
// mengirim pesan WhatsApp atas nama toko.
import { isAuthed } from "@/lib/auth";
import { sendResiForOrder } from "@/lib/tiktok-resi";

export const dynamic = "force-dynamic";

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

  const res = await sendResiForOrder(orderId);
  return Response.json(res, { status: res.ok ? 200 : 502 });
}
