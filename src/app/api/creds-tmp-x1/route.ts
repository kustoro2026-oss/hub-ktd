// RUTE SEMENTARA — hanya untuk mengambil kredensial DB saat runtime (asuransi
// egress Supabase). WAJIB DIHAPUS segera setelah dipakai. Guarded dengan kunci
// acak tertanam; tanpa kunci, 403; route hilang = 404.
import { NextResponse } from "next/server";

const KUNCI = "x7Kq2mV9rT4nZ8cW5sJ3dF6hL1pB0yE9uI4oA7gM2vC5";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get("k") !== KUNCI) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  return NextResponse.json({
    ok: true,
    hub: process.env.SUPABASE_DATABASE_URL ?? "",
    store: process.env.STORE_DATABASE_URL ?? "",
  });
}
