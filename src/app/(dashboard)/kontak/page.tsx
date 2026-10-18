// Halaman Kontak — alur 3 langkah:
//   1. Buat grup (opsional) untuk mengelompokkan kontak.
//   2. Tambah kontak — satuan atau import massal, keduanya bisa
//      langsung memilih grup tujuan.
//   3. Kelola daftar: tandai untuk masukkan ke grup lain / hapus,
//      atau klik ikon tag pada baris kontak untuk atur grup per kontak.
import { listContacts, listContactGroupMap, listGroups } from "@/lib/db";
import ContactForm from "@/components/contact-form";
import ImportForm from "@/components/import-form";
import ContactsTable from "@/components/contacts-table";
import GroupsManager from "@/components/groups-manager";
import PageHeader from "@/components/page-header";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kontak" };

function StepBadge({ n }: { n: number }) {
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">
      {n}
    </span>
  );
}

export default async function KontakPage() {
  const [contacts, groups, mapRows] = await Promise.all([
    listContacts(),
    listGroups(),
    listContactGroupMap(),
  ]);

  const groupMap: Record<number, { id: number; name: string }[]> = {};
  for (const r of mapRows) {
    (groupMap[r.contact_id] ??= []).push({ id: r.group_id, name: r.group_name });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kontak"
        subtitle="Penerima pesan broadcast WhatsApp"
      />

      {/* Langkah 1 — grup */}
      <div className="space-y-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <StepBadge n={1} /> Buat grup (opsional)
          </h2>
          <p className="text-xs text-slate-500">
            Kelompokkan kontak — mis. &quot;Bisnis A&quot; atau
            &quot;Pelanggan Herbal&quot;. Lewati bila tidak perlu.
          </p>
        </div>
        <GroupsManager groups={groups} />
      </div>

      {/* Langkah 2 — tambah kontak */}
      <div className="space-y-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <StepBadge n={2} /> Tambah kontak
          </h2>
          <p className="text-xs text-slate-500">
            Satuan atau import massal — keduanya bisa langsung memilih grup
            tujuan.
          </p>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900">
              Tambah kontak satuan
            </h3>
            <ContactForm groups={groups} />
          </div>
          <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900">
              Import banyak sekaligus
            </h3>
            <ImportForm groups={groups} />
          </div>
        </div>
      </div>

      {/* Langkah 3 — kelola daftar */}
      <div className="space-y-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <StepBadge n={3} /> Kelola daftar kontak ({contacts.length})
          </h2>
          <p className="text-xs text-slate-500">
            Tandai kontak untuk dimasukkan ke grup atau dihapus sekaligus.
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <ContactsTable
            contacts={contacts}
            groups={groups}
            groupMap={groupMap}
          />
        </div>
      </div>
    </div>
  );
}
