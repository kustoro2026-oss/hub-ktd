// Kirim balasan manual (teks bebas) ke satu nomor pelanggan dari halaman
// chat Pesan Masuk. Sah tanpa template selama masih dalam window 24 jam
// sejak pesan terakhir pelanggan; di luar window Meta menolak kiriman.
import { isAuthed } from "@/lib/auth";
import { insertMessage } from "@/lib/db";
import { normalizePhone, sendText } from "@/lib/wa";

export async function POST(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  let body: { to?: string; text?: string } = {};
  try {
    body = (await request.json()) as { to?: string; text?: string };
  } catch {
    return Response.json({ error: "Body tidak valid" }, { status: 400 });
  }
  const to = body.to ? normalizePhone(body.to) : null;
  const text = (body.text ?? "").trim();
  if (!to) {
    return Response.json({ error: "Nomor tujuan tidak valid" }, { status: 400 });
  }
  if (!text) {
    return Response.json({ error: "Pesan kosong" }, { status: 400 });
  }
  if (text.length > 4096) {
    return Response.json(
      { error: "Pesan terlalu panjang (maks 4096 karakter)" },
      { status: 400 },
    );
  }

  const res = await sendText(to, text);
  if (!res.ok) {
    return Response.json(
      { error: res.error ?? "Gagal mengirim pesan ke Meta" },
      { status: 502 },
    );
  }

  // Catat pesan keluar agar tampil di riwayat percakapan.
  await insertMessage({
    id: res.waId ?? `out-${Date.now()}`,
    wa_from: to,
    body: text,
    reply: "",
    kind: "general",
    ad_id: "",
    direction: "out",
  });
  return Response.json({ ok: true }, { status: 201 });
}
