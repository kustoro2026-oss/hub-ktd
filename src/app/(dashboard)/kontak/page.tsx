// Halaman Kontak — daftar penerima broadcast WhatsApp dengan grup.
import { listContacts, listContactGroupMap, listGroups } from "@/lib/db";
import ContactForm from "@/components/contact-form";
import ImportForm from "@/components/import-form";
import ContactsTable from "@/components/contacts-table";
import GroupsManager from "@/components/groups-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kontak" };

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
      <div>
        <h1 className="text-xl font-bold text-slate-900">Kontak</h1>
        <p className="text-sm text-slate-500">
          Daftar penerima pesan broadcast WhatsApp
        </p>
      </div>

      <GroupsManager groups={groups} />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Tambah kontak</h2>
          <ContactForm />
        </div>
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Import banyak</h2>
          <ImportForm />
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            Semua kontak ({contacts.length})
          </h2>
        </div>
        <ContactsTable contacts={contacts} groups={groups} groupMap={groupMap} />
      </div>
    </div>
  );
}
