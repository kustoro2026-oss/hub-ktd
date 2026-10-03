// Halaman Kontak — daftar penerima broadcast WhatsApp.
import { listContacts } from "@/lib/db";
import ContactForm from "@/components/contact-form";
import ImportForm from "@/components/import-form";
import ContactsTable from "@/components/contacts-table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kontak" };

export default async function KontakPage() {
  const contacts = await listContacts();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Kontak</h1>
        <p className="text-sm text-slate-500">
          Daftar penerima pesan broadcast WhatsApp
        </p>
      </div>

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
        <ContactsTable contacts={contacts} />
      </div>
    </div>
  );
}
