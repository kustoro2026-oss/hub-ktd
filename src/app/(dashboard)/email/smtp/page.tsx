// Halaman Pengaturan SMTP — kelola banyak akun SMTP beserta aturan
// kirimnya. Satu kampanye memakai satu akun, dan mesin kirim mematuhi
// batch/jeda/kuota akun tersebut secara otomatis.
import EmailSendLimitPanel from "@/components/email-send-limit-panel";
import EmailSmtpSettings from "@/components/email-smtp-settings";
import PageHeader from "@/components/page-header";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pengaturan SMTP" };

export default function EmailSmtpPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Pengaturan SMTP"
        subtitle="Banyak akun, aturan kirim masing-masing, berjalan otomatis"
      />

      <EmailSendLimitPanel />

      <EmailSmtpSettings />

      <div className="rounded-xl border border-slate-200 bg-blue-50/40 p-4 text-xs text-slate-600">
        <p className="mb-1 font-semibold text-slate-800">
          Cara kerja aturan kirim
        </p>
        <ul className="list-inside list-disc space-y-1">
          <li>
            <strong>Batch</strong> — jumlah email dikirim berurutan sebelum
            berhenti sejenak.
          </li>
          <li>
            <strong>Jeda antar batch</strong> — mesin kirim menunggu selama ini
            lalu lanjut otomatis; kampanye berstatus &quot;Jeda batch&quot;.
          </li>
          <li>
            <strong>Jeda antar email</strong> — meniru pola kirim manusia agar
            tidak dianggap spam.
          </li>
          <li>
            <strong>Kuota harian</strong> — dihitung dari email sukses per akun
            per hari. Bila habis, sisa kampanye dilanjutkan otomatis pukul
            00:00.
          </li>
        </ul>
      </div>
    </div>
  );
}
