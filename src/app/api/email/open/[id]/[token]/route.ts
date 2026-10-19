// Pixel pelacak "dibuka" (publik) — dipasang di badan tiap email kampanye
// sebagai gambar 1x1. Saat penerima membuka email, klien email memuat
// gambar ini dan item ditandai "opened" (counter dibuka kampanye naik —
// Gmail tidak menyediakan webhook statistik, jadi ini satu-satunya sinyal
// buka). Token HMAC id item (AUTH_SECRET) mencegah pemalsuan.
//
// Respons gambar GIF transparan 1x1 tanpa cache supaya tiap buka terhitung.
import { applyEmailEvent } from "@/lib/db";
import { verifyOpenPixelToken } from "@/lib/gmail";

const GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; token: string }> },
) {
  const { id, token } = await params;
  const itemId = Number(id);
  if (!Number.isInteger(itemId) || itemId <= 0 || !verifyOpenPixelToken(itemId, token)) {
    return new Response("Tidak ditemukan", { status: 404 });
  }
  await applyEmailEvent(itemId, "opened", "pixel 1x1");
  return new Response(GIF, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
