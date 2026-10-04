// Kirim broadcast (lanjutkan bila masih ada yang pending).
//
// Logika pengiriman ada di src/lib/broadcast-send.ts — dipakai bersama oleh
// penjadwal kampanye. Satu permintaan memproses sejumlah penerima terbatas
// (default 40, atur via env BROADCAST_BATCH) — aman untuk serverless
// Vercel. Bila penerima belum habis, status broadcast tetap "sending" dan
// halaman detail menyediakan tombol lanjut.
import { isAuthed } from "@/lib/auth";
import { runBroadcast } from "@/lib/broadcast-send";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const { id } = await params;
  const res = await runBroadcast(Number(id));
  if (!res.ok) {
    const error = res.error ?? "Gagal mengirim";
    const status = error.includes("tidak ditemukan")
      ? 404
      : error.includes("belum diatur")
        ? 500
        : 409;
    return Response.json({ ok: false, error }, { status });
  }
  return Response.json(res);
}
