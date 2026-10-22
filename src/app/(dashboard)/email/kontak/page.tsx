// Halaman Kontak Email — alur 3 langkah:
//   1. Buat grup (WAJIB). Setiap kontak hanya boleh berada di satu grup;
//      tidak ada keranjang "umum" yang mencampur kontak antar grup.
//   2. Tambah kontak — satuan atau import massal, keduanya wajib memilih
//      grup tujuan.
//   3. Kelola daftar: pindahkan grup, berhenti/aktifkan, hapus. Di bawah
//      tabel ada audit penyimpanan + riwayat import untuk melacak
//      rekonsiliasi (berapa baris masuk, berapa duplikat/invalid).
import {
  auditEmailContacts,
  listEmailContacts,
  listEmailGroups,
  listEmailImportRuns,
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
  const [contacts, groups, audit, imports] = await Promise.all([
    listEmailContacts(),
    listEmailGroups(),
    auditEmailContacts(),
    listEmailImportRuns(8),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kontak Email"
        subtitle="Satu kontak = satu grup · import diaudit otomatis"
      />

      {/* Audit penyimpanan — angka harus cocok dengan hasil import. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs text-slate-500">Total kontak</div>
          <div className="text-xl font-bold text-slate-900">
            {audit.contacts}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs text-slate-500">Grup</div>
          <div className="text-xl font-bold text-slate-900">{audit.groups}</div>
        </div>
        <div
          className={`rounded-xl border p-3 shadow-sm ${
            audit.ungrouped > 0
              ? "border-amber-200 bg-amber-50"
              : "border-slate-200 bg-white"
          }`}
        >
          <div className="text-xs text-slate-500">Tanpa grup (legacy)</div>
          <div
            className={`text-xl font-bold ${
              audit.ungrouped > 0 ? "text-amber-700" : "text-slate-900"
            }`}
          >
            {audit.ungrouped}
          </div>
        </div>
        <div
          className={`rounded-xl border p-3 shadow-sm ${
            audit.duplicateEmails > 0
              ? "border-red-200 bg-red-50"
              : "border-slate-200 bg-white"
          }`}
        >
          <div className="text-xs text-slate-500">Duplikat email</div>
          <div
            className={`text-xl font-bold ${
              audit.duplicateEmails > 0 ? "text-red-600" : "text-slate-900"
            }`}
          >
            {audit.duplicateEmails}
          </div>
        </div>
      </div>

      {/* Langkah 1 — grup */}
      <div className="space-y-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <StepBadge n={1} /> Buat grup (wajib)
          </h2>
          <p className="text-xs text-slate-500">
            Setiap kontak hanya masuk ke SATU grup yang kamu buat sendiri.
            Import tanpa grup tidak diizinkan supaya daftar tidak tercampur.
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
            Satuan atau import massal (CSV/XLSX/TXT) — pilih grup tujuan dulu.
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
            Pindahkan kontak antar grup lewat ikon folder; tombol lingkaran
            menandai berhenti/aktifkan langganan.
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <EmailContactsTable contacts={contacts} groups={groups} />
        </div>
      </div>

      {/* Riwayat import — jejak audit rekonsiliasi 400 → 400. */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold text-slate-900">
          Riwayat import terakhir
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          Baris = total baris file · Valid = punya email · Unik = setelah
          dedupe · Baru / Update / Pindah = aksi ke database · Duplikat /
          Invalid = dilewati.
        </p>
        {imports.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">
            Belum ada riwayat import.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 uppercase text-slate-400">
                  <th className="py-2 pr-3 font-medium">Waktu</th>
                  <th className="py-2 pr-3 font-medium">Grup</th>
                  <th className="py-2 pr-3 font-medium">Baris</th>
                  <th className="py-2 pr-3 font-medium">Valid</th>
                  <th className="py-2 pr-3 font-medium">Unik</th>
                  <th className="py-2 pr-3 font-medium">Baru</th>
                  <th className="py-2 pr-3 font-medium">Update</th>
                  <th className="py-2 pr-3 font-medium">Pindah</th>
                  <th className="py-2 pr-3 font-medium">Duplikat</th>
                  <th className="py-2 font-medium">Invalid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {imports.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap py-1.5 pr-3 text-slate-500">
                      {r.created_at}
                    </td>
                    <td className="py-1.5 pr-3 text-slate-700">
                      {r.group_name || `#${r.group_id}`}
                    </td>
                    <td className="py-1.5 pr-3">{r.total_lines}</td>
                    <td className="py-1.5 pr-3">{r.valid_lines}</td>
                    <td className="py-1.5 pr-3">{r.unique_emails}</td>
                    <td className="py-1.5 pr-3 font-medium text-emerald-700">
                      {r.added}
                    </td>
                    <td className="py-1.5 pr-3">{r.updated}</td>
                    <td className="py-1.5 pr-3">{r.moved}</td>
                    <td className="py-1.5 pr-3">{r.duplicates}</td>
                    <td className="py-1.5">{r.invalid}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
