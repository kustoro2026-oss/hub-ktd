// Halaman Kontak Email — alur 3 langkah (pola halaman Kontak WA):
//   1. Buat grup (opsional) untuk mengelompokkan kontak.
//   2. Tambah kontak — satuan atau import massal, keduanya bisa
//      langsung memilih grup tujuan.
//   3. Kelola daftar: tandai untuk dimasukkan ke grup lain / hapus,
//      atur grup per kontak, atau berhenti/aktifkan langganan manual.
import {
  listEmailContacts,
  listEmailContactGroupMap,
  listEmailGroups,
} from "@/lib/db";
import EmailContactForm from "@/components/email-contact-form";
import EmailImportForm from "@/components/email-import-form";
import EmailContactsTable from "@/components/email-contacts-table";
import EmailGroupsManager from "@/components/email-groups-manager";
import PageHeader from "@/components/page-header";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kontak Email" };

function StepBadge({ n }: { n: number }) {
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">
      {n}
    </span>
  );
}

export default async function EmailKontakPage() {
  const [contacts, groups, mapRows] = await Promise.all([
    listEmailContacts(),
    listEmailGroups(),
    listEmailContactGroupMap(),
  ]);

  const groupMap: Record<number, { id: number; name: string }[]> = {};
  for (const r of mapRows) {
    (groupMap[r.contact_id] ??= []).push({ id: r.group_id, name: r.group_name });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kontak Email"
        subtitle="Penerima kampanye email marketing"
      />

      {/* Langkah 1 — grup */}
      <div className="space-y-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <StepBadge n={1} /> Buat grup (opsional)
          </h2>
          <p className="text-xs text-slate-500">
            Kelompokkan kontak — mis. &quot;Pelanggan Toko&quot; atau
            &quot;Pembeli Marketplace&quot;. Lewati bila tidak perlu.
          </p>
        </div>
        <EmailGroupsManager groups={groups} />
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
            <EmailContactForm groups={groups} />
          </div>
          <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900">
              Import banyak sekaligus
            </h3>
            <EmailImportForm groups={groups} />
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
            Tandai kontak untuk dimasukkan ke grup atau dihapus sekaligus —
            tombol lingkaran-coret menandai berhenti/aktifkan langganan.
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <EmailContactsTable
            contacts={contacts}
            groups={groups}
            groupMap={groupMap}
          />
        </div>
      </div>
    </div>
  );
}
