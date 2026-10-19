// Buat kampanye email baru + daftar kampanye.
//
// Penerima: seluruh anggota satu grup (groupId), kontak pilihan
// (contactIds), atau semua kontak berstatus subscribed. Kontak yang sudah
// berhenti berlangganan atau bounce otomatis dilewati. vars = nilai
// variabel {{namaVariabel}} sebagai objek (mis. link produk), subject
// default dari template, scheduledAt opsional = waktu kirim otomatis UTC
// "YYYY-MM-DD HH:MM:SS".
import { isAuthed } from "@/lib/auth";
import type { EmailContact } from "@/lib/db";
import {
  createEmailCampaignWithItems,
  getEmailTemplate,
  listEmailCampaigns,
  listEmailContacts,
  listEmailContactsByGroup,
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
    contactIds?: number[];
    vars?: Record<string, string>;
    scheduledAt?: string;
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

  // Penerima: grup > kontak pilihan > semua — kontak unsubscribe/bounce
  // dilewati supaya tidak mengirim ke orang yang sudah minta berhenti.
  const active = (list: EmailContact[]) =>
    list.filter((c) => c.status === "subscribed");
  let selected: EmailContact[];
  if (body.groupId) {
    selected = await listEmailContactsByGroup(body.groupId);
  } else if (body.contactIds?.length) {
    const all = await listEmailContacts();
    selected = all.filter((c) => body.contactIds!.includes(c.id));
  } else {
    selected = await listEmailContacts();
  }
  selected = active(selected);
  if (selected.length === 0) {
    return Response.json(
      { error: "Tidak ada kontak berlangganan — tambahkan kontak dulu" },
      { status: 400 },
    );
  }

  const vars: Record<string, string> = {};
  if (body.vars && typeof body.vars === "object") {
    for (const [k, v] of Object.entries(body.vars)) {
      if (typeof v === "string") vars[k] = v.trim();
    }
  }

  let scheduledAt = (body.scheduledAt ?? "").trim();
  if (scheduledAt && !isValidSchedule(scheduledAt)) {
    return Response.json(
      {
        error:
          "Jadwal tidak valid — kirim waktu UTC \"YYYY-MM-DD HH:MM:SS\" minimal 2 menit ke depan",
      },
      { status: 400 },
    );
  }

  const campaign = await createEmailCampaignWithItems(
    body.name,
    tpl.id,
    (body.subject ?? tpl.subject).trim() || tpl.subject,
    selected.map((c) => ({ contactId: c.id, name: c.name, email: c.email })),
    body.groupId ?? null,
    vars,
    scheduledAt,
  );
  return Response.json({ ok: true, campaign }, { status: 201 });
}
