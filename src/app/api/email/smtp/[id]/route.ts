// Ubah / hapus satu akun SMTP.
//
// PATCH  → perbarui konfigurasi (password kosong = pertahankan yang lama)
// DELETE → hapus akun; ditolak bila masih dipakai kampanye aktif
import { isAuthed } from "@/lib/auth";
import {
  countCampaignsUsingSmtpAccount,
  deleteEmailSmtpAccount,
  getEmailSmtpAccount,
  updateEmailSmtpAccount,
} from "@/lib/db";
import { clearSmtpTransport, sanitizeSmtpAccountInput } from "@/lib/email-smtp";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const id = Number((await params).id);
  if (!Number.isFinite(id) || id <= 0) {
    return Response.json({ error: "id akun tidak valid" }, { status: 400 });
  }
  const current = await getEmailSmtpAccount(id);
  if (!current) {
    return Response.json({ error: "Akun SMTP tidak ditemukan" }, { status: 404 });
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Body tidak valid" }, { status: 400 });
  }
  const input = sanitizeSmtpAccountInput(body, current);
  if (!input.name || !input.host || !input.username || !input.password) {
    return Response.json(
      { error: "Nama, host, username, dan password wajib diisi" },
      { status: 400 },
    );
  }
  const account = await updateEmailSmtpAccount(id, input);
  clearSmtpTransport(id);
  return Response.json({
    ok: true,
    account: account ? { ...account, password: "" } : undefined,
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const id = Number((await params).id);
  if (!Number.isFinite(id) || id <= 0) {
    return Response.json({ error: "id akun tidak valid" }, { status: 400 });
  }
  const used = await countCampaignsUsingSmtpAccount(id);
  if (used > 0) {
    return Response.json(
      {
        error: `Akun masih dipakai ${used} kampanye aktif. Selesaikan atau hentikan kampanye itu dulu.`,
      },
      { status: 409 },
    );
  }
  await deleteEmailSmtpAccount(id);
  clearSmtpTransport(id);
  return Response.json({ ok: true });
}
