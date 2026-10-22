// Akun SMTP email marketing (multi-akun).
//
// GET  → daftar akun + pemakaian hari ini + jumlah kampanye aktif
// POST → buat akun baru (password wajib)
//
// Password tidak pernah dikembalikan ke klien.
import { isAuthed } from "@/lib/auth";
import {
  countCampaignsUsingSmtpAccount,
  countEmailsSentTodayByAccounts,
  createEmailSmtpAccount,
  listEmailSmtpAccounts,
} from "@/lib/db";
import { sanitizeSmtpAccountInput } from "@/lib/email-smtp";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const accounts = await listEmailSmtpAccounts(false);
  const usage = await countEmailsSentTodayByAccounts(
    accounts.map((a) => a.id),
  );
  const activeCampaigns = await Promise.all(
    accounts.map((a) => countCampaignsUsingSmtpAccount(a.id)),
  );
  return Response.json({
    ok: true,
    accounts: accounts.map((a, i) => ({
      ...a,
      sentToday: usage[a.id] ?? 0,
      activeCampaigns: activeCampaigns[i] ?? 0,
    })),
  });
}

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
  const input = sanitizeSmtpAccountInput(body);
  if (!input.name) {
    return Response.json({ error: "Nama akun wajib diisi" }, { status: 400 });
  }
  if (!input.host || !input.username || !input.password) {
    return Response.json(
      { error: "Host, username, dan password wajib diisi" },
      { status: 400 },
    );
  }
  try {
    const account = await createEmailSmtpAccount(input);
    return Response.json(
      { ok: true, account: { ...account, password: "" } },
      { status: 201 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Gagal menyimpan akun SMTP";
    return Response.json({ error: msg }, { status: 500 });
  }
}
