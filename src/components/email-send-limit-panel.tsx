// Panel "Status kirim & batas harian" email marketing — per akun SMTP.
// Server component: nilai segar tiap kali halaman dibuka.
import {
  countEmailsSentTodayByAccounts,
  listEmailSmtpAccounts,
} from "@/lib/db";

export default async function EmailSendLimitPanel() {
  const accounts = await listEmailSmtpAccounts(false);
  const usage = await countEmailsSentTodayByAccounts(accounts.map((a) => a.id));

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">
          Status kirim &amp; batas harian per akun SMTP
        </h2>
        <span className="flex items-center gap-1.5 text-xs text-emerald-700">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
          dihitung dari Hub
        </span>
      </div>

      {accounts.length === 0 ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Belum ada akun SMTP — tambahkan di panel Akun SMTP di halaman ini.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {accounts.map((a) => {
            const sent = usage[a.id] ?? 0;
            const limit = a.daily_limit || 0;
            const remaining = limit > 0 ? Math.max(0, limit - sent) : null;
            const over = limit > 0 && sent >= limit;
            const pct = limit > 0 ? Math.min(100, (sent / limit) * 100) : 0;
            return (
              <div
                key={a.id}
                className={`rounded-lg border px-3 py-2 ${
                  over
                    ? "border-red-200 bg-red-50"
                    : "border-slate-100 bg-slate-50/60"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold text-slate-800">
                    {a.name}
                  </span>
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                      a.active
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-slate-200 text-slate-600"
                    }`}
                  >
                    {a.active ? "Aktif" : "Nonaktif"}
                  </span>
                </div>
                <div className="mt-1 flex items-end justify-between">
                  <span className="text-lg font-bold text-slate-900">{sent}</span>
                  <span className="text-[11px] text-slate-500">
                    {limit > 0 ? `dari ${limit} / hari` : "tanpa batas harian"}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white">
                  <div
                    className={`h-full rounded-full ${
                      over ? "bg-red-500" : "bg-emerald-500"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-[11px] text-slate-500">
                  <span>
                    Batch {a.batch_size} · jeda {a.batch_pause_seconds}s
                  </span>
                  <span>
                    {over
                      ? "kuota habis — lanjut besok"
                      : remaining === null
                        ? "sisa tak terbatas"
                        : `sisa ${remaining}`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <details className="mt-3 rounded-lg bg-slate-50 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-slate-600">
          Cara kerja aturan kirim per akun
        </summary>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-slate-500">
          <li>
            <strong>Batch &amp; jeda</strong> — mesin kirim mengirim{" "}
            <strong>batch_size</strong> email, lalu berhenti{" "}
            <strong>batch_pause_seconds</strong> detik sebelum batch
            berikutnya. Contoh Gmail: 40 email per batch, jeda 60 detik.
          </li>
          <li>
            <strong>Batas harian</strong> dihitung dari waktu kirim sebenarnya
            (kolom sent_at) per akun, termasuk kampanye lain yang memakai akun
            yang sama.
          </li>
          <li>
            <strong>Bila batas tercapai</strong>, kampanye otomatis dijeda dan
            dilanjutkan pukul 00:00 WIB — tidak ada email yang hilang dari
            antrean.
          </li>
          <li>
            <strong>Galat akun</strong> (password salah, host salah) membuat
            kampanye berhenti dengan status dijeda, bukan menghabiskan sisa
            antrean dengan galat yang sama.
          </li>
        </ul>
      </details>
    </div>
  );
}
