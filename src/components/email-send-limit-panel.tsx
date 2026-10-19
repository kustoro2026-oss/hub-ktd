// Panel "Status kirim & batas harian" untuk email marketing — batas akun
// gratis Brevo 300 email/hari dipadukan dengan hitungan kiriman Hub hari
// ini dari database lokal. Server component: nilai segar tiap kali halaman
// dibuka (pola send-limit-panel WA).
import { countEmailsSentToday } from "@/lib/db";

// Batas akun gratis Brevo (300/hari). Naikkan bila berlangganan paket
// berbayar — nilainya di sini supaya tampil jelas di UI.
const FREE_TIER_LIMIT = 300;

export default async function EmailSendLimitPanel() {
  const [sentToday] = await Promise.all([countEmailsSentToday()]);

  const remaining = Math.max(0, FREE_TIER_LIMIT - sentToday);
  const over = sentToday >= FREE_TIER_LIMIT;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">
          Status kirim &amp; batas harian email
        </h2>
        <span className="flex items-center gap-1.5 text-xs text-emerald-700">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
          dihitung dari Hub
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
            Batas harian Brevo
          </div>
          <div className="mt-0.5 text-lg font-bold text-slate-900">
            {FREE_TIER_LIMIT}
          </div>
          <div className="text-[11px] text-slate-500">tier gratis</div>
        </div>
        <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
            Terkirim dari Hub
          </div>
          <div className="mt-0.5 text-lg font-bold text-slate-900">
            {sentToday}
          </div>
          <div className="text-[11px] text-slate-500">hari ini</div>
        </div>
        <div
          className={`rounded-lg border px-3 py-2 ${
            over
              ? "border-red-200 bg-red-50"
              : "border-slate-100 bg-slate-50/60"
          }`}
        >
          <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
            Sisa hari ini
          </div>
          <div
            className={`mt-0.5 text-lg font-bold ${over ? "text-red-600" : "text-slate-900"}`}
          >
            {remaining}
          </div>
          <div className="text-[11px] text-slate-500">
            {over ? "kuota habis!" : "email"}
          </div>
        </div>
      </div>

      <details className="mt-3 rounded-lg bg-slate-50 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-slate-600">
          Cara kerja batas &amp; yang terjadi bila tembus
        </summary>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-slate-500">
          <li>
            <strong>Batas 300/hari</strong> = akun gratis Brevo. Angka ini
            dihitung dari tabel kampanye email Hub — kiriman dari dashboard
            Brevo di luar Hub tidak ikut terhitung, jadi samakan perkiraan
            Anda.
          </li>
          <li>
            <strong>Bila tembus:</strong> Brevo menolak email berikutnya
            (kode 402) sampai kuota pulih keesokan hari. Hub menandai
            barisnya <strong>Gagal</strong> beserta alasannya.
          </li>
          <li>
            <strong>Saran:</strong> pecah kampanye besar jadi beberapa hari,
            atau jadwalkan pengiriman pada jam yang berbeda.
          </li>
        </ul>
      </details>
    </div>
  );
}
