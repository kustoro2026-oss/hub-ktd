// Pengaturan — status env, catatan webhook, dan info deploy.
import { AD_PRODUCT_MAP } from "@/lib/replies";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pengaturan" };

function status(key: string, label: string, ok: boolean, detail?: string) {
  return (
    <li
      key={key}
      className="flex items-center justify-between gap-4 border-b border-slate-100 py-2.5 text-sm last:border-0"
    >
      <span className="text-slate-700">{label}</span>
      <span className="flex items-center gap-2">
        {detail && <span className="font-mono text-xs text-slate-400">{detail}</span>}
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            ok ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
          }`}
        >
          {ok ? "Terisi" : "Kosong"}
        </span>
      </span>
    </li>
  );
}

export default function PengaturanPage() {
  const envs = [
    { label: "WA_TOKEN (token permanen Meta)", ok: !!process.env.WA_TOKEN },
    {
      label: "WA_PHONE_NUMBER_ID",
      ok: !!process.env.WA_PHONE_NUMBER_ID,
      detail: process.env.WA_PHONE_NUMBER_ID,
    },
    {
      label: "WA_VERIFY_TOKEN (verifikasi webhook)",
      ok: !!process.env.WA_VERIFY_TOKEN,
    },
    { label: "AUTH_PASSWORD (kata sandi admin)", ok: !!process.env.AUTH_PASSWORD },
    { label: "AUTH_SECRET (penanda cookie sesi)", ok: !!process.env.AUTH_SECRET },
    {
      label: "DATABASE_URL / POSTGRES_URL (database produksi)",
      ok: !!(process.env.DATABASE_URL ?? process.env.POSTGRES_URL),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Pengaturan</h1>
        <p className="text-sm text-slate-500">
          Status konfigurasi dan kredensial KTD Hub
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">
          Environment variables
        </h2>
        <ul>{envs.map((e) => status(e.label, e.label, e.ok, e.detail))}</ul>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <h2 className="mb-2 font-semibold text-slate-900">
          Pemetaan iklan CTWA
        </h2>
        {Object.keys(AD_PRODUCT_MAP).length === 0 ? (
          <p className="text-slate-500">
            Belum ada pemetaan. Saat iklan CTWA dibuat, tambahkan pasangan
            <code> ID iklan → URL produk</code> di <code>src/lib/replies.ts</code>{" "}
            agar balasan bot mengarah ke produk yang diiklankan.
          </p>
        ) : (
          <ul className="space-y-1 font-mono text-xs">
            {Object.entries(AD_PRODUCT_MAP).map(([adId, url]) => (
              <li key={adId}>
                {adId} → {url}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <h2 className="mb-2 font-semibold text-slate-900">Catatan penting</h2>
        <ul className="list-disc space-y-1 pl-5 text-slate-600">
          <li>
            <strong>Database:</strong> SQLite lokal (data/ktd-hub.db) untuk
            pengembangan; di Vercel otomatis memakai Postgres lewat DATABASE_URL
            (Neon / Vercel Postgres) karena filesystem serverless bersifat
            sementara.
          </li>
          <li>
            <strong>Webhook bot:</strong> Meta hanya mengizinkan satu Callback
            URL per app. Setelah KTD Hub deploy, arahkan Callback URL Meta App ke{" "}
            <code>/api/wa/webhook</code> di domain Hub dan jalankan{" "}
            <code>Verifikasi dan simpan</code> — log chat otomatis masuk ke menu
            Pesan Masuk.
          </li>
          <li>
            <strong>Kirim massal:</strong> wajib opt-in dan memakai template yang
            disetujui (info_promo). Batas kirim dihitung per portofolio bisnis:{" "}
            <strong>250 nomor unik/24 jam</strong> untuk akun baru; setelah
            verifikasi bisnis naik ke <strong>2.000</strong>, lalu bisa naik
            otomatis bertahap (10.000 → 100.000 → tanpa batas) bila kualitas
            pesan terjaga.
          </li>
          <li>
            <strong>Balasan otomatis:</strong> teks bebas gratis dalam window 24
            jam sejak pesan terakhir pelanggan — tanpa template.
          </li>
        </ul>
      </div>
    </div>
  );
}
