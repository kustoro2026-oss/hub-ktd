// Tes koneksi akun SMTP tanpa mengirim email.
//
// body { id?, ...field akun } — bila id dikirim, field yang kosong
// dilengkapi dari akun tersimpan (termasuk password). Cocok untuk tombol
// "Tes koneksi" sebelum menyimpan form baru.
import { isAuthed } from "@/lib/auth";
import { getEmailSmtpAccount } from "@/lib/db";
import { sanitizeSmtpAccountInput, testSmtpAccount } from "@/lib/email-smtp";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Body tidak valid" }, { status: 400 });
  }
  const id = Number(body.id ?? 0);
  const current = id > 0 ? await getEmailSmtpAccount(id) : undefined;
  if (id > 0 && !current) {
    return Response.json({ error: "Akun SMTP tidak ditemukan" }, { status: 404 });
  }
  const input = sanitizeSmtpAccountInput(body, current);
  if (!input.host || !input.username || !input.password) {
    return Response.json(
      { error: "Host, username, dan password wajib diisi" },
      { status: 400 },
    );
  }
  const res = await testSmtpAccount({
    ...(current ?? {
      id: 0,
      created_at: "",
    }),
    ...input,
  });
  return Response.json(res);
}
