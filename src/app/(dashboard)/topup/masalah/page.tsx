// Log Masalah — order top-up bermasalah 7 hari terakhir, dikelompokkan per
// jenis: eksekusi gagal, saldo Digiflazz kurang, nominal callback tidak
// cocok, menunggu eksekusi lama, pembayaran gagal, dan kedaluwarsa.
// Klasifikasi satu order ke satu jenis ada di klasifikasiMasalah().
import Link from "next/link";
import { fmtRp, wibDariMs } from "@/lib/keuangan";
import { ambilTopupMasalah, parseUtcMs } from "@/lib/topup";

export const dynamic = "force-dynamic";
export const metadata = { title: "Top Up · Log Masalah" };

export default async function TopupMasalahPage() {
  const { groups, total } = await ambilTopupMasalah();
  const jumlahMasalah = groups.reduce((a, g) => a + g.items.length, 0);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
          Top Up · Log Masalah
        </p>
        <h1 className="text-xl font-bold text-slate-900">Log Masalah</h1>
        <p className="text-sm text-slate-500">
          Dari {total} pesanan 7 hari terakhir, {jumlahMasalah} baris butuh
          perhatian — dikelompokkan per jenis.
        </p>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center text-sm text-emerald-900">
          Tidak ada masalah pada 7 hari terakhir. Semua order sehat.
        </div>
      ) : null}

      {groups.map((g) => (
        <section key={g.jenis} className={`overflow-hidden rounded-xl border ${g.cls}`}>
          <div className="border-b border-black/5 px-4 py-3">
            <h2 className="text-sm font-semibold">
              {g.label}{" "}
              <span className="ml-1 rounded-full bg-white/70 px-2 py-0.5 text-xs font-medium">
                {g.items.length}
              </span>
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="border-b border-black/5 text-xs uppercase tracking-wide opacity-70">
                <tr>
                  <th className="px-4 py-2.5">Waktu</th>
                  <th className="px-4 py-2.5">Pesanan</th>
                  <th className="px-4 py-2.5">Produk</th>
                  <th className="px-4 py-2.5">Tujuan</th>
                  <th className="px-4 py-2.5 text-right">Nominal</th>
                  <th className="px-4 py-2.5">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5">
                {g.items.map((o) => (
                  <tr key={o.id} className="align-top hover:bg-white/40">
                    <td className="whitespace-nowrap px-4 py-2.5 opacity-80">
                      {wibDariMs(parseUtcMs(o.created_at))}
                    </td>
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/topup/pesanan/${o.id}`}
                        className="font-medium underline hover:opacity-80"
                      >
                        {o.id}
                      </Link>
                      <p className="text-xs opacity-70">{o.ref_id}</p>
                    </td>
                    <td className="px-4 py-2.5">{o.product_name || "—"}</td>
                    <td className="px-4 py-2.5">{o.customer_no || "—"}</td>
                    <td className="px-4 py-2.5 text-right font-medium">
                      {fmtRp(o.amount)}
                    </td>
                    <td className="max-w-72 px-4 py-2.5 text-xs opacity-80">
                      {o.error_message
                        ? o.error_message
                        : g.jenis === "pending_lama" && o.paid_at
                          ? `Dibayar ${wibDariMs(parseUtcMs(o.paid_at))} WIB — belum tereksekusi`
                          : g.jenis === "expired"
                            ? "Tidak dibayar sampai batas waktu"
                            : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-500">
        <p>
          Halaman ini membaca tabel <code>topup_orders</code> langsung (real
          time, tanpa cron). Order gagal karena saldo Digiflazz kosong
          otomatis masuk kategori saldo kurang; pending lebih dari 30 menit
          bisa dicek ulang lewat tombol &ldquo;Cek Ulang Pending&rdquo; di
          halaman detail atau Pengaturan.
        </p>
      </div>
    </div>
  );
}
