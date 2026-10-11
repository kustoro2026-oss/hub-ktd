// Label kirim RESMI Blibli satu paket (persis menu "Cetak Resi" Seller
// Center) — dibuka di tab baru dari halaman Pesanan lalu dicetak. Perlu
// sesi admin karena label berisi data pelanggan (nama, alamat, telepon)
// yang sensitif.
//
// Meniru alur aplikasi TikTok Shop: bila paket masih "Pesanan Baru" (FP),
// pengiriman dikonfirmasi dulu otomatis (fulfill + AWB) baru label diambil
// — kurir bisa dijadwalkan dan label bisa dicetak ulang kapan saja.
import { isAuthed } from "@/lib/auth";
import { getBlibliResiPdf } from "@/lib/blibli-resi";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ package_id: string }> },
) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const { package_id } = await params;

  const res = await getBlibliResiPdf(package_id);

  // Mode diagnostik (?debug=1): kembalikan JSON ringkasan hasil cetak +
  // alasan API — tanpa isi PDF (untuk memeriksa hasil cetak).
  const url = new URL(_request.url);
  if (url.searchParams.get("debug") === "1") {
    return Response.json(
      res.ok
        ? {
            ok: true,
            tracking_number: res.tracking_number,
            arranged: res.arranged,
          }
        : { ok: false, detail: res.detail, butuhAwb: res.butuhAwb === true },
    );
  }

  if (res.ok) {
    // Header ASCII (nama file) — nilai non-ASCII ditolak server.
    const headers: Record<string, string> = {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="resi-${package_id}.pdf"`,
    };
    return new Response(new Uint8Array(res.pdf), { headers });
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
      `<p>Label resmi Blibli untuk paket ini belum bisa diambil lewat API.` +
      ` Kemungkinan paketnya belum dibuat (packageCreated) atau statusnya belum memungkinkan pencetakan label.</p>` +
      (safe
        ? `<p style="background:#fff1f2;border:1px solid #fecdd3;border-radius:8px;padding:8px 10px;font-size:13px">Alasan dari API: ${safe}</p>`
        : "") +
      `<p>Silakan cetak lewat Blibli Seller Center: <b>Pesanan → pilih pesanan → Cetak Label</b>.</p>` +
      `<p><a href="/marketplace/blibli/pesanan" style="color:#059669">Kembali ke halaman Pesanan</a></p>` +
      `</body></html>`,
    {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  );
}
