// Terapkan nama tampilan baru dengan mendaftarkan ulang nomor API
// (POST /{phone-number-id}/register). PIN verifikasi 2 langkah (6 digit)
// dikirim pengguna dari browser dan hanya diteruskan ke Graph API —
// tidak disimpan di server maupun database.
import { isAuthed } from "@/lib/auth";
import { registerApplyName } from "@/lib/wa";

export async function POST(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  let body: { pin?: string } = {};
  try {
    body = (await request.json()) as { pin?: string };
  } catch {
    return Response.json({ error: "Body tidak valid" }, { status: 400 });
  }
  const pin = (body.pin ?? "").trim();
  if (!/^\d{6,8}$/.test(pin)) {
    return Response.json(
      { error: "PIN harus 6–8 digit angka" },
      { status: 400 },
    );
  }
  const result = await registerApplyName(pin);
  return Response.json(result);
}
