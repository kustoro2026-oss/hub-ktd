// Buat kampanye broadcast baru: nama kampanye + daftar penerima.
// Penerima diambil dari semua kontak (default) atau daftar id kontak pilihan.
import { isAuthed } from "@/lib/auth";
import { createBroadcastWithItems, listContacts } from "@/lib/db";

export async function POST(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  let body: { name?: string; template?: string; contactIds?: number[] } = {};
  try {
    body = (await request.json()) as {
      name?: string;
      template?: string;
      contactIds?: number[];
    };
  } catch {
    return Response.json({ error: "Body tidak valid" }, { status: 400 });
  }
  if (!body.name?.trim()) {
    return Response.json({ error: "Nama kampanye wajib diisi" }, { status: 400 });
  }

  const all = await listContacts();
  const selected = body.contactIds?.length
    ? all.filter((c) => body.contactIds!.includes(c.id))
    : all;
  if (selected.length === 0) {
    return Response.json(
      { error: "Tidak ada kontak — tambahkan kontak dulu" },
      { status: 400 },
    );
  }

  const broadcast = await createBroadcastWithItems(
    body.name,
    body.template?.trim() || "info_promo_v2",
    selected.map((c) => ({ contactId: c.id, phone: c.phone })),
  );
  return Response.json({ ok: true, broadcast }, { status: 201 });
}
