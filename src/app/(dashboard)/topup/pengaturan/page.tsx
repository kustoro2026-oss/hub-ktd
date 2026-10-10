// Pengaturan Top Up — status koneksi ke API toko (rahasia terpasang, URL
// toko, ambang saldo), hasil cek saldo terakhir, tombol cek ulang pending,
// dan catatan bahwa eksekusi manual tetap di halaman admin toko. Hub TIDAK
// menyediakan tombol pengubah status transaksi (keputusan: aksi aman saja).
import Link from "next/link";
import { fmtRp } from "@/lib/keuangan";
import { topupStoreUrl, topupThreshold } from "@/lib/topup";
import TopupSaldoCard from "@/components/topup-saldo-card";
import TopupRecheck from "@/components/topup-recheck";

export const dynamic = "force-dynamic";
export const metadata = { title: "Top Up · Pengaturan" };

export default async function TopupPengaturanPage() {
  const threshold = topupThreshold();
  const storeUrl = topupStoreUrl();
  const secretTerpasang = !!process.env.TOPUP_ADMIN_SECRET;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
          Top Up · Pengaturan
        </p>
        <h1 className="text-xl font-bold text-slate-900">Pengaturan Top Up</h1>
        <p className="text-sm text-slate-500">
          Status koneksi hub ke API toko dan ambang peringatan saldo.
        </p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">
          Status koneksi
        </h2>
        <dl className="mt-3 divide-y divide-slate-100 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <dt className="text-slate-500">
              Rahasia admin (<code className="text-xs">TOPUP_ADMIN_SECRET</code>)
            </dt>
            <dd>
              {secretTerpasang ? (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                  Terpasang
                </span>
              ) : (
                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800">
                  Belum diatur — cek saldo &amp; cek ulang tidak bisa jalan
                </span>
              )}
            </dd>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <dt className="text-slate-500">
              URL toko (<code className="text-xs">TOPUP_STORE_URL</code>)
            </dt>
            <dd>
              <a
                href={storeUrl}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-emerald-700 hover:underline"
              >
                {storeUrl}
              </a>
            </dd>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <dt className="text-slate-500">
              Ambang saldo rendah (
              <code className="text-xs">TOPUP_LOW_BALANCE_THRESHOLD</code>)
            </dt>
            <dd className="font-medium text-slate-900">{fmtRp(threshold)}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">
          Cek saldo terakhir
        </h2>
        <p className="mb-3 mt-1 text-xs text-slate-500">
          Hasil panggilan ke {storeUrl}/api/topup/cek-saldo (di-cache 60
          detik di server hub).
        </p>
        <div className="max-w-sm">
          <TopupSaldoCard threshold={threshold} />
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">
          Cek ulang transaksi pending
        </h2>
        <p className="mb-3 mt-1 text-xs text-slate-500">
          Memanggil {storeUrl}/api/topup/cron/pending — menandai order
          kedaluwarsa dan mengecek ulang status Digiflazz transaksi pending.
          Idempoten, aman dijalankan kapan pun.
        </p>
        <TopupRecheck />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
        <h2 className="text-sm font-semibold text-slate-900">Catatan</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            Eksekusi manual (ubah status, refund, retry) tetap dilakukan di
            halaman admin toko:{" "}
            <a
              href={`${storeUrl}/topup/admin`}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-emerald-700 hover:underline"
            >
              {storeUrl.replace("https://", "")}/topup/admin
            </a>
          </li>
          <li>
            Hub hanya menyediakan aksi aman (baca saldo, cek ulang pending,
            lihat data) — tidak ada tombol pengubah status transaksi.
          </li>
          <li>
            Data order dibaca dari tabel bersama <code>topup_orders</code> di
            database yang sama dengan toko — tidak ada sinkronisasi manual.
          </li>
        </ul>
      </section>

      <div className="flex flex-wrap gap-2">
        <Link
          href="/topup"
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          ← Ringkasan
        </Link>
      </div>
    </div>
  );
}
