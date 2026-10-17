// Status cetak AWB otomatis satu pesanan (admin): status pekerjaan
// jembatan browser + detak engine + apakah label resmi sudah tersedia.
import { isAuthed } from "@/lib/auth";
import { awbStatus } from "@/lib/lazada-awb";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const orderId =
    new URL(request.url).searchParams.get("order_id")?.trim() ?? "";
  if (!orderId) {
    return Response.json({ error: "order_id kosong" }, { status: 400 });
  }
  return Response.json(await awbStatus(orderId));
}
