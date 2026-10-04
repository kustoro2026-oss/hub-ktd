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
      <div>
        <h1 className="text-xl font-bold text-slate-900">Kontak</h1>
        <p className="text-sm text-slate-500">
          Daftar penerima pesan broadcast WhatsApp
        </p>
      </div>

      {/* Langkah 1 — grup */}
      <div className="space-y-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <StepBadge n={1} /> Buat grup (opsional)
          </h2>
          <p className="text-xs text-slate-500">
            Grup untuk mengelompokkan kontak — mis. &quot;Bisnis A&quot; atau
            &quot;Pelanggan Herbal&quot;. Satu kontak boleh masuk beberapa grup.
            Kalau tidak perlu dikelompokkan, lewati langkah ini; kontak tetap
            tersimpan di daftar umum.
          </p>
        </div>
        <GroupsManager groups={groups} />
      </div>

      {/* Langkah 2 — tambah kontak */}
      <div className="space-y-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <StepBadge n={2} /> Tambah kontak — satuan atau massal
          </h2>
          <p className="text-xs text-slate-500">
            Kedua cara bisa langsung memilih grup tujuan. Pilih &quot;Tanpa
            grup&quot; untuk menyimpan di daftar umum — nanti tetap bisa
            dikelompokkan lewat Langkah 3.
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
            Tandai satu atau beberapa kontak lalu pilih &quot;Masukkan ke
            grup&quot; atau &quot;Hapus terpilih&quot;. Untuk satu kontak saja,
            klik ikon tag di barisnya untuk mengubah keanggotaan grup.
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
