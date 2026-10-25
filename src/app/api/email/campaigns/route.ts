// Buat kampanye email baru.
//
// Satu kampanye = satu grup penerima + satu akun SMTP. Tidak ada sasaran
// "semua kontak" karena setiap kontak wajib punya grup. Kontak yang berhenti
// berlangganan / bounce otomatis dilewati.
//
// mode:
//   "send"     → buat lalu langsung kirim (UI menyusul lewat ?start=1)
//   "schedule" → buat dengan jadwal (scheduledAt UTC "YYYY-MM-DD HH:MM:SS")
//   "draft"    → buat sebagai draft, kirim nanti dari halaman detail
import { isAuthed } from "@/lib/auth";
import {
  createEmailCampaignWithItems,
  getEmailSmtpAccount,
  getEmailTemplate,
  listEmailCampaigns,
  listEmailContactsByGroup,
  listEmailGroups,
  updateEmailCampaignRun,
} from "@/lib/db";

// Waktu kirim otomatis minimal 2 menit di depan (pola broadcast WhatsApp).
function isValidSchedule(utc: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(utc)) return false;
  const t = new Date(utc.replace(" ", "T") + "Z");
  return !Number.isNaN(t.getTime()) && t.getTime() > Date.now() + 120_000;
}

export async function GET() {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  return Response.json({ ok: true, campaigns: await listEmailCampaigns() });
}

export async function POST(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  let body: {
    name?: string;
    templateId?: number;
    subject?: string;
    groupId?: number;
    smtpAccountId?: number;
    vars?: Record<string, string>;
    mode?: "send" | "schedule" | "draft";
    scheduledAt?: string;
    repeatDaily?: number;
    repeatStartHour?: number;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body tidak valid" }, { status: 400 });
  }

  if (!body.name?.trim()) {
    return Response.json(
      { error: "Nama kampanye wajib diisi" },
      { status: 400 },
    );
  }
  if (!body.templateId) {
    return Response.json(
      { error: "Template email wajib dipilih" },
      { status: 400 },
    );
  }
  const tpl = await getEmailTemplate(body.templateId);
  if (!tpl) {
    return Response.json({ error: "Template tidak ditemukan" }, { status: 400 });
  }

  const groupId = Number(body.groupId ?? 0);
  if (!groupId) {
    return Response.json(
      { error: "Grup penerima wajib dipilih" },
      { status: 400 },
    );
  }
  const groups = await listEmailGroups();
  if (!groups.some((g) => g.id === groupId)) {
    return Response.json({ error: "Grup tidak ditemukan" }, { status: 400 });
  }

  const smtpAccountId = Number(body.smtpAccountId ?? 0);
  if (!smtpAccountId) {
    return Response.json(
      { error: "Akun SMTP wajib dipilih — atur di halaman Pengaturan SMTP" },
      { status: 400 },
    );
  }
  const account = await getEmailSmtpAccount(smtpAccountId);
  if (!account) {
    return Response.json({ error: "Akun SMTP tidak ditemukan" }, { status: 400 });
  }
  if (account.active !== 1) {
    return Response.json(
      { error: `Akun SMTP "${account.name}" sedang dinonaktifkan` },
      { status: 400 },
    );
  }

  const mode = body.mode ?? "draft";
  if (!["send", "schedule", "draft"].includes(mode)) {
    return Response.json({ error: "mode tidak dikenal" }, { status: 400 });
  }

  let scheduledAt = (body.scheduledAt ?? "").trim();
  if (mode === "schedule") {
    if (!scheduledAt || !isValidSchedule(scheduledAt)) {
      return Response.json(
        {
          error:
            'Jadwal tidak valid — kirim waktu UTC "YYYY-MM-DD HH:MM:SS" minimal 2 menit ke depan',
        },
        { status: 400 },
      );
    }
  } else {
    scheduledAt = "";
  }

  // Penerima: anggota grup yang masih berlangganan.
  const members = await listEmailContactsByGroup(groupId);
  const selected = members.filter((c) => c.status === "subscribed");
  if (selected.length === 0) {
    return Response.json(
      {
        error:
          members.length === 0
            ? "Grup masih kosong — import kontak dulu"
            : "Semua kontak di grup ini berhenti berlangganan / bounce",
      },
      { status: 400 },
    );
  }

  const vars: Record<string, string> = {};
  if (body.vars && typeof body.vars === "object") {
    for (const [k, v] of Object.entries(body.vars)) {
      if (typeof v === "string") vars[k] = v.trim();
    }
  }

  const campaign = await createEmailCampaignWithItems({
    name: body.name,
    templateId: tpl.id,
    smtpAccountId: account.id,
    groupId,
    subject: (body.subject ?? tpl.subject).trim() || tpl.subject,
    vars,
    scheduledAt,
    repeatDaily: body.repeatDaily ? 1 : 0,
    repeatStartHour: body.repeatStartHour ?? 8,
    items: selected.map((c) => ({
      contactId: c.id,
      name: c.name,
      email: c.email,
    })),
  });

  // "send" langsung berstatus sending supaya tab yang terputus tetap
  // dilanjutkan penjadwal; "schedule" menunggu jadwal; "draft" menunggu
  // tombol kirim di halaman detail.
  if (mode === "send") {
    await updateEmailCampaignRun(campaign.id, {
      status: "sending",
      next_run_at: "",
      pause_reason: "",
    });
  }

  return Response.json(
    {
      ok: true,
      campaign: { ...campaign, status: mode === "send" ? "sending" : "draft" },
      startNow: mode === "send",
      recipients: selected.length,
    },
    { status: 201 },
  );
}
