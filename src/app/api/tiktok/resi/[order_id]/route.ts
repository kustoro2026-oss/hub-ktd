// Label kirim RESMI TikTok Shop satu pesanan (persis menu "Cetak Resi"
// aplikasi) — dibuka di tab baru dari halaman Pesanan lalu dicetak. Perlu
// sesi admin karena label berisi data pelanggan (nama, alamat, telepon)
// yang sensitif.
//
// Meniru alur aplikasi TikTok Shop: bila pesanan masih "Menunggu kirim"
// (AWAITING_SHIPMENT), pengiriman dijadwalkan dulu otomatis (slot
// penjemputan tercepat) baru label diambil — status pesanan berubah jadi
// "Menunggu pickup" dan resi bisa dicetak ulang kapan saja.
import { isAuthed } from "@/lib/auth";
import { getOfficialResiForOrder } from "@/lib/tiktok-resi";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ order_id: string }> },
) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const { order_id } = await params;

  const res = await getOfficialResiForOrder(order_id);
  if (res.ok) {
    return new Response(new Uint8Array(res.pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="resi-${order_id}.pdf"`,
      },
    });
  }

  // Label resmi tidak tersedia — tampilkan keterangan + alasan dari API.
  const safe = res.detail
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return new Response(
    `<!doctype html><html lang="id"><head><meta charset="utf-8">` +
      `<title>Label tidak tersedia</title></head><body style="font-family:system-ui,sans-serif;max-width:520px;margin:60px auto;padding:0 16px;color:#334155">` +
      `<h1 style="font-size:20px">Label kirim belum tersedia</h1>` +
      `<p>Label resmi TikTok Shop untuk pesanan ini belum bisa diambil lewat API.` +
      ` Kemungkinan paketnya belum diatur pengirimannya atau pesanan tidak memakai pengiriman platform.</p>` +
      (safe
        ? `<p style="background:#fff1f2;border:1px solid #fecdd3;border-radius:8px;padding:8px 10px;font-size:13px">Alasan dari API: ${safe}</p>`
        : "") +
      `<p>Silakan cetak lewat aplikasi TikTok Shop: <b>Pesanan → pilih pesanan → Cetak Resi</b>.</p>` +
      `<p><a href="/marketplace/tiktok/pesanan" style="color:#059669">Kembali ke halaman Pesanan</a></p>` +
      `</body></html>`,
    {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  );
}
