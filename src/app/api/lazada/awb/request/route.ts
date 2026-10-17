// Antrekan cetak AWB resmi satu pesanan lewat jembatan browser (admin).
// Body: { order_id }. Item ids diambil lewat Open Platform (order items)
// supaya tombol UI tidak perlu tahu struktur item pesanan.
import { isAuthed } from "@/lib/auth";
import { awbEnqueue } from "@/lib/lazada-awb";
import { getLazadaOrderItems } from "@/lib/lazada";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  let body: { order_id?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "body bukan JSON" }, { status: 400 });
  }
  const orderId = (body.order_id ?? "").trim();
  if (!orderId) {
    return Response.json({ error: "order_id kosong" }, { status: 400 });
  }
  const items = await getLazadaOrderItems(orderId);
  if (!items.ok) {
    return Response.json({ error: items.detail }, { status: 502 });
  }
  const hasil = await awbEnqueue(
    orderId,
    items.data.map((i) => i.order_item_id),
  );
  if (!hasil.ok) {
    return Response.json({ error: hasil.detail }, { status: 409 });
  }
  return Response.json({ ok: true, detail: hasil.detail });
}
