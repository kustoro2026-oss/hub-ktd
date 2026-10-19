// Pengaturan SMTP Gmail — disimpan di tabel email_settings (bukan env)
// supaya akun Gmail bisa diganti-ganti dari UI tanpa redeploy.
//
// GET: alamat Gmail + alamat pengirim + status password tersimpan
//      (password TIDAK pernah dikembalikan ke klien).
// POST: simpan {user, pass?, senderEmail?} — password boleh kosong bila
//       tidak diganti (nilai lama dipertahankan).
import { isAuthed } from "@/lib/auth";
import { getEmailSettings, setEmailSetting } from "@/lib/db";

export async function GET() {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const s = await getEmailSettings();
  return Response.json({
    ok: true,
    user: s.gmail_smtp_user ?? "",
    senderEmail: s.gmail_sender_email ?? "",
    hasPass: Boolean(s.gmail_smtp_pass),
  });
}

export async function POST(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  let body: { user?: string; pass?: string; senderEmail?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body tidak valid" }, { status: 400 });
  }

  const user = (body.user ?? "").trim();
  if (!user || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user)) {
    return Response.json(
      { error: "Alamat Gmail tidak valid" },
      { status: 400 },
    );
  }

  await setEmailSetting("gmail_smtp_user", user);
  const pass = (body.pass ?? "").trim();
  if (pass) {
    await setEmailSetting("gmail_smtp_pass", pass);
  }
  await setEmailSetting(
    "gmail_sender_email",
    (body.senderEmail ?? "").trim() || user,
  );

  return Response.json({
    ok: true,
    detail: pass
      ? "Pengaturan SMTP tersimpan"
      : "Pengaturan SMTP tersimpan (password lama dipertahankan)",
  });
}
