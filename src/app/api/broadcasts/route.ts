// Buat kampanye broadcast baru: nama kampanye + daftar penerima.
// Penerima: semua kontak (default), kontak pilihan (contactIds), atau
// seluruh anggota satu grup (groupId). vars = nilai variabel {{1}}, {{2}}…
// template (mis. link produk), lang = bahasa template. scheduledAt (opsional)
// = waktu kirim otomatis dalam UTC "YYYY-MM-DD HH:MM:SS" — bila diisi,
// kampanye disimpan sebagai draft terjadwal dan dikirim oleh penjadwal.
import { isAuthed } from "@/lib/auth";
import {
  createBroadcastWithItems,
  listContacts,
  listContactsByGroup,
} from "@/lib/db";

// Waktu kirim otomatis minimal 2 menit di depan supaya tidak melewatkan tick
// pertama penjadwal.
function isValidSchedule(utc: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(utc)) return false;
  const t = new Date(utc.replace(" ", "T") + "Z");
  return !Number.isNaN(t.getTime()) && t.getTime() > Date.now() + 120_000;
}

export async function POST(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  let body: {
    name?: string;
    template?: string;
    contactIds?: number[];
    groupId?: number;
    vars?: string[];
    lang?: string;
    scheduledAt?: string;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body tidak valid" }, { status: 400 });
  }
  if (!body.name?.trim()) {
    return Response.json({ error: "Nama kampanye wajib diisi" }, { status: 400 });
  }

  let selected;
  if (body.groupId) {
    selected = await listContactsByGroup(body.groupId);
  } else if (body.contactIds?.length) {
    const all = await listContacts();
    selected = all.filter((c) => body.contactIds!.includes(c.id));
  } else {
    selected = await listContacts();
  }
  if (selected.length === 0) {
    return Response.json(
      { error: "Tidak ada kontak — tambahkan kontak dulu" },
      { status: 400 },
    );
  }

  const vars = (body.vars ?? []).map((v) => v.trim());
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
  const broadcast = await createBroadcastWithItems(
    body.name,
    body.template?.trim() || "info_promo_v2",
    selected.map((c) => ({ contactId: c.id, phone: c.phone })),
    body.groupId ?? null,
    vars,
    (body.lang ?? "id").trim() || "id",
    scheduledAt,
  );
  return Response.json({ ok: true, broadcast }, { status: 201 });
}
