// Simpan label resmi Lazada yang diunggah pemilik untuk satu pesanan —
// dipakai ketika label resmi TIDAK bisa diunduh lewat Open Platform
// (pesanan kurir terintegrasi: AWB hanya bisa dicetak dari Seller Center).
// Pemilik mengunduh PDF dari Seller Center (Cetak AWB / Cetak Label) lalu
// mengunggahnya di sini; setelah itu tombol Cetak Resi dan Kirim Resi
// menyajikan dokumen resmi ini, bukan PDF cadangan buatan sendiri.
//
//   POST /api/lazada/resi/<order_id>/label   (body: file PDF mentah)
//
// Perlu sesi admin (label berisi data pelanggan). Dokumen disimpan sebagai
// payload.label_pdf_base64 pada baris lazada_order_exec — status dan jejak
// pembayaran tidak tersentuh.
import { isAuthed } from "@/lib/auth";
import {
  getLazadaOrderExec,
  updateLazadaOrderExecPayload,
} from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAKS_BYTE = 5 * 1024 * 1024;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ order_id: string }> },
) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const { order_id } = await params;

  const buf = Buffer.from(await request.arrayBuffer());
  if (buf.length === 0) {
    return Response.json({ error: "File kosong" }, { status: 400 });
  }
  if (buf.length > MAKS_BYTE) {
    return Response.json(
      { error: "PDF terlalu besar (maks 5 MB)" },
      { status: 400 },
    );
  }
  if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return Response.json(
      { error: "Bukan PDF valid (penanda %PDF- tidak ditemukan)" },
      { status: 400 },
    );
  }

  const row = await getLazadaOrderExec(order_id);
  if (!row) {
    return Response.json(
      { error: "Tidak ada antrean eksekusi untuk pesanan ini" },
      { status: 404 },
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(row.payload) as Record<string, unknown>;
  } catch {
    payload = {};
  }
  payload.label_pdf_base64 = buf.toString("base64");
  await updateLazadaOrderExecPayload(order_id, JSON.stringify(payload));

  return Response.json({
    ok: true,
    order_id,
    bytes: buf.length,
    catatan:
      "Label resmi tersimpan — Cetak Resi dan Kirim Resi kini memakai dokumen ini.",
  });
}
