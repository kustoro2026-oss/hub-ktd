// Kelola daftar blokir anti-spam: nomor yang diblokir tidak dibalas bot
// (pesan tetap dicatat di Pesan Masuk) dan tidak memakai kredit AI.
import { isAuthed } from "@/lib/auth";
import { blockNumber, listBlockedNumbers, unblockNumber } from "@/lib/db";

export async function GET() {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  return Response.json({ numbers: await listBlockedNumbers() });
}

export async function POST(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  let body: { from?: string; note?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // Tanpa body tetap sah: blokir tanpa catatan.
  }
  const from = body.from?.trim();
  if (!from) {
    return Response.json({ error: "Nomor tidak boleh kosong" }, { status: 400 });
  }
  await blockNumber(from, body.note ?? "");
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const from = new URL(request.url).searchParams.get("from")?.trim();
  if (!from) {
    return Response.json({ error: "Nomor tidak boleh kosong" }, { status: 400 });
  }
  await unblockNumber(from);
  return Response.json({ ok: true });
}
