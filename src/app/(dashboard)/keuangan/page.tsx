// Dashboard Keuangan / Laba Rugi KTD Hub — khusus uang: omset TikTok Shop,
// pembayaran Aneka, laba kotor, dan saldo wallet Aneka. Default "hari ini"
// (WIB); rentang tanggal bisa dipilih (dari/sampai). Data Aneka di-scrape
// read-only lalu di-cache 15 menit (tombol Muat Ulang / cron harian).
// Laba kotor = omset − total bayar Aneka (total Aneka sudah termasuk ongkos
// pengemasan Rp3.000). Komisi TikTok belum ikut (laba bersih menyusul).
import { ambilDataKeuangan, fmtRp, wibDariMs } from "@/lib/keuangan";
import KeuanganRefresh from "@/components/keuangan-refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const metadata = { title: "Keuangan" };

const HARI_MS = 86400000;
/** Batas maksimal rentang tanggal (hari) — keamanan scrape & API. */
const MAKS_RENTANG_HARI = 31;

const p = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" → awal hari itu dalam WIB sebagai epoch ms UTC. */
function awalHariWibMs(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return 0;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - 7 * 3600 * 1000;
}

/** Hari ini dalam WIB sebagai "YYYY-MM-DD". */
function hariIniWib(): string {
  const w = new Date(Date.now() + 7 * 3600 * 1000);
  return `${w.getUTCFullYear()}-${p(w.getUTCMonth() + 1)}-${p(w.getUTCDate())}`;
}

function tanggalLabel(ms: number): string {
  const w = new Date(ms + 7 * 3600 * 1000);
  return `${p(w.getUTCDate())}/${p(w.getUTCMonth() + 1)}/${w.getUTCFullYear()}`;
}

type Rentang = {
  dariMs: number;
  sampaiMs: number;
  dari: string;
  sampai: string;
  label: string;
  catatan: string;
};

/** Param query dari/sampai (YYYY-MM-DD) → rentang epoch ms. Default hari
 *  ini; rentang maksimal 31 hari; sampai sebelum dari → dipakai satu hari. */
function rentangDariSearchParams(dari?: string, sampai?: string): Rentang {
  const hariIni = hariIniWib();
  const d0 = /^\d{4}-\d{2}-\d{2}$/.test(dari ?? "") ? (dari as string) : hariIni;
  const s0 = /^\d{4}-\d{2}-\d{2}$/.test(sampai ?? "")
    ? (sampai as string)
    : hariIni;
  let ge = awalHariWibMs(d0);
  let lt = awalHariWibMs(s0) + HARI_MS;
  let catatan = "";
  if (lt <= ge) {
    lt = ge + HARI_MS;
    catatan =
      "Rentang tidak valid (sampai sebelum dari) — dipakai satu hari 'dari'.";
  }
  if (lt - ge > MAKS_RENTANG_HARI * HARI_MS) {
    ge = lt - MAKS_RENTANG_HARI * HARI_MS;
    catatan = `Rentang dibatasi maksimal ${MAKS_RENTANG_HARI} hari.`;
  }
  return {
    dariMs: ge,
    sampaiMs: lt,
    dari: d0,
    sampai: s0,
    label: `${tanggalLabel(ge)} – ${tanggalLabel(lt - 1)}`,
    catatan,
  };
}

// ---------- label & warna ----------

const STATUS_TIKTOK: Record<string, string> = {
  UNPAID: "Belum bayar",
  ON_HOLD: "Ditahan",
  PARTIALLY_SHIPPING: "Sebagian dikirim",
  AWAITING_SHIPMENT: "Menunggu kirim",
  AWAITING_COLLECTION: "Menunggu pickup",
  IN_TRANSIT: "Dalam perjalanan",
  DELIVERED: "Terkirim",
  COMPLETED: "Selesai",
  CANCELLED: "Dibatalkan",
  PARTIALLY_CANCELLED: "Sebagian batal",
};

const STATUS_EXEC: Record<string, { label: string; cls: string }> = {
  "": { label: "Belum diproses", cls: "bg-slate-100 text-slate-600" },
  menunggu: { label: "Menunggu setuju", cls: "bg-amber-100 text-amber-800" },
  berjalan: { label: "Berjalan", cls: "bg-blue-100 text-blue-800" },
  gagal: { label: "Gagal", cls: "bg-rose-100 text-rose-800" },
  selesai: { label: "Selesai", cls: "bg-emerald-100 text-emerald-800" },
  batal: { label: "Dibatalkan", cls: "bg-slate-100 text-slate-600" },
};

function clsStatusBayar(status: string): string {
  if (status === "Success") return "bg-emerald-100 text-emerald-800";
  if (status === "Pending") return "bg-amber-100 text-amber-800";
  if (status === "Failed") return "bg-rose-100 text-rose-800";
  return "bg-slate-100 text-slate-600";
}

/** Kartu ringkasan angka besar. */
function Kartu({
  judul,
  nilai,
  sub,
  cls,
}: {
  judul: string;
  nilai: string;
  sub?: string;
  cls?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {judul}
      </p>
      <p className={`mt-1 text-2xl font-bold ${cls ?? "text-slate-900"}`}>
        {nilai}
      </p>
      {sub ? <p className="mt-1 text-xs text-slate-500">{sub}</p> : null}
    </div>
  );
}

function KartuPeringatan({ judul, isi }: { judul: string; isi: string[] }) {
  if (isi.length === 0) return null;
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
      <p className="font-semibold">{judul}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {isi.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

export default async function KeuanganPage({
  searchParams,
}: {
  searchParams: Promise<{ dari?: string; sampai?: string }>;
}) {
  const sp = await searchParams;
  const rentang = rentangDariSearchParams(sp.dari, sp.sampai);
  const data = await ambilDataKeuangan(rentang.dariMs, rentang.sampaiMs);

  const resiDobelSet = new Set(data.resiDobel.map((r) => r.resi));
  const manualIdSet = new Set(data.pembayaranManualIds);
  const totalManual = data.bayarManual.reduce((a, m) => a + m.row.total, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
            Keuangan · Laba Rugi
          </p>
          <h1 className="text-xl font-bold text-slate-900">
            Dashboard Keuangan
          </h1>
          <p className="text-sm text-slate-500">
            Omset TikTok − pembayaran Aneka = laba kotor · {rentang.label}
          </p>
        </div>
        <KeuanganRefresh />
      </div>

      <form
        method="GET"
        action="/keuangan"
        className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4"
      >
        <div>
          <label
            htmlFor="dari"
            className="block text-xs font-medium text-slate-500"
          >
            Dari tanggal
          </label>
          <input
            id="dari"
            type="date"
            name="dari"
            defaultValue={rentang.dari}
            className="mt-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
          />
        </div>
        <div>
          <label
            htmlFor="sampai"
            className="block text-xs font-medium text-slate-500"
          >
            Sampai tanggal
          </label>
          <input
            id="sampai"
            type="date"
            name="sampai"
            defaultValue={rentang.sampai}
            className="mt-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-800"
        >
          Terapkan
        </button>
        <a
          href="/keuangan"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
        >
          Hari ini
        </a>
        {rentang.catatan ? (
          <p className="w-full text-xs text-amber-700">{rentang.catatan}</p>
        ) : null}
      </form>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {data.segar ? (
          <span className="rounded-full bg-emerald-100 px-2.5 py-1 font-medium text-emerald-800">
            Data Aneka segar
            {data.saldoWaktuMs ? ` (${wibDariMs(data.saldoWaktuMs)} WIB)` : ""}
          </span>
        ) : (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 font-medium text-amber-800">
            Data Aneka belum diperbarui — {data.anekaError || "memakai cache lama"}
          </span>
        )}
        <span className="text-slate-400">
          Omset hanya menghitung pesanan berbayar (tanpa UNPAID/Dibatalkan).
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kartu
          judul="Omset TikTok"
          nilai={fmtRp(data.omset)}
          sub={`${data.jumlahOrder} pesanan masuk`}
          cls="text-emerald-700"
        />
        <Kartu
          judul="Pembayaran Aneka"
          nilai={fmtRp(data.bayarAneka)}
          sub={`${data.jumlahBayar} sukses · ${data.bayarManual.length} manual`}
          cls="text-rose-700"
        />
        <Kartu
          judul="Laba Kotor"
          nilai={fmtRp(data.labaKotor)}
          sub="belum dipotong komisi TikTok"
          cls={data.labaKotor >= 0 ? "text-emerald-700" : "text-rose-700"}
        />
        <Kartu
          judul="Saldo Aneka"
          nilai={fmtRp(data.saldo)}
          sub={
            data.saldoWaktuMs
              ? `per ${wibDariMs(data.saldoWaktuMs)} WIB`
              : data.anekaError || "belum tersedia"
          }
        />
      </div>

      <KartuPeringatan
        judul="PERHATIAN — nomor resi sama di lebih dari satu pembayaran (kemungkinan bayar dobel):"
        isi={data.resiDobel.map(
          (r) => `${r.resi} — ${r.jumlah} pembayaran Success`,
        )}
      />
      <KartuPeringatan
        judul="PERHATIAN — pesanan TikTok dibatalkan padahal sudah dibayar ke Aneka:"
        isi={data.orderBatalTerbayar.map(
          (b) => `${b.orderId} (${b.produk}) — terbayar ${fmtRp(b.bayarAneka)}`,
        )}
      />

      {data.bayarTanpaOrder.length > 0 ? (
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
          <p className="font-semibold">
            Pembayaran via KTD Hub tanpa pasangan order TikTok pada rentang ini:
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {data.bayarTanpaOrder.map((r) => (
              <li key={r.paymentId}>
                {r.orderCode || `payment ${r.paymentId}`} — {fmtRp(r.total)}
                {r.resi ? ` (resi ${r.resi})` : " (tanpa resi)"} —{" "}
                {wibDariMs(r.tanggalMs)}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-sky-700">
            Wajar bila order TikTok-nya dibuat di hari sebelumnya — pilih
            rentang yang lebih luas untuk melihat pasangannya.
          </p>
        </div>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">
            Orderan Manual — di luar KTD Hub ({data.bayarManual.length})
          </h2>
          <p className="text-xs text-slate-500">
            Dibuat langsung di situs Aneka, bukan lewat KTD Hub — biasanya
            order marketplace lain atau pesanan WhatsApp.
          </p>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Waktu</th>
                <th className="px-4 py-2.5">Kode / Payment</th>
                <th className="px-4 py-2.5 text-right">Total</th>
                <th className="px-4 py-2.5">Resi</th>
                <th className="px-4 py-2.5">Pasangan Order TikTok</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.bayarManual.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-6 text-center text-slate-400"
                  >
                    Tidak ada orderan manual pada rentang ini.
                  </td>
                </tr>
              ) : (
                data.bayarManual.map(({ row, orderId }) => (
                  <tr key={row.paymentId}>
                    <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">
                      {wibDariMs(row.tanggalMs)}
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-900">
                        {row.orderCode || "—"}
                      </p>
                      <p className="text-xs text-slate-500">
                        payment {row.paymentId}
                      </p>
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-slate-900">
                      {fmtRp(row.total)}
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">
                      {row.resi || (
                        <span className="text-slate-400">tanpa resi</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {orderId ? (
                        <span className="font-medium text-emerald-700">
                          {orderId}
                        </span>
                      ) : (
                        <span className="text-slate-400">
                          — (marketplace lain / WA?)
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {data.bayarManual.length > 0 ? (
              <tfoot className="border-t border-slate-200 bg-slate-50">
                <tr>
                  <td
                    colSpan={2}
                    className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500"
                  >
                    Total {data.bayarManual.length} pembayaran manual
                  </td>
                  <td className="px-4 py-2.5 text-right text-sm font-bold text-slate-900">
                    {fmtRp(totalManual)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </section>

      {typeof data.perkiraanTopup === "number" ? (
        <p className="text-xs text-slate-500">
          Perkiraan top-up saldo pada rentang ini:{" "}
          <span className="font-medium text-slate-700">
            {fmtRp(data.perkiraanTopup)}
          </span>{" "}
          (saldo awal vs saldo akhir dikurangi pengeluaran — perkiraan kasar,
          belum memperhitungkan refund).
        </p>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">
          Rincian pesanan TikTok ({data.baris.length})
        </h2>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Waktu</th>
                <th className="px-4 py-2.5">Pesanan / Produk</th>
                <th className="px-4 py-2.5 text-right">Qty</th>
                <th className="px-4 py-2.5 text-right">Omset</th>
                <th className="px-4 py-2.5 text-right">Bayar Aneka</th>
                <th className="px-4 py-2.5 text-right">Laba</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Eksekusi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.baris.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-6 text-center text-slate-400"
                  >
                    Belum ada pesanan TikTok pada rentang ini (atau belum ada
                    toko terotorisasi).
                  </td>
                </tr>
              ) : (
                data.baris.map((b) => {
                  const se = STATUS_EXEC[b.statusExec] ?? STATUS_EXEC[""];
                  return (
                    <tr
                      key={b.orderId}
                      className={
                        b.statusOrder === "CANCELLED" ? "bg-rose-50/60" : ""
                      }
                    >
                      <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">
                        {wibDariMs(b.waktuMs)}
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-slate-900">
                          {b.orderId}
                        </p>
                        <p className="text-xs text-slate-500">
                          {b.produk}
                          {b.resi ? ` · resi ${b.resi}` : ""}
                        </p>
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-600">
                        {b.qty}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium text-slate-900">
                        {fmtRp(b.omset)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-600">
                        {b.bayarAneka > 0 ? (
                          <span>
                            {fmtRp(b.bayarAneka)}
                            <span className="block text-[10px] text-slate-400">
                              {b.bayarIds.join(", ")}
                            </span>
                            {b.bayarManualAneka > 0 ? (
                              <span className="block text-[10px] font-medium text-violet-600">
                                manual {fmtRp(b.bayarManualAneka)}
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="text-slate-400">
                            {b.statusExec === ""
                              ? "belum keluar"
                              : "menunggu bayar"}
                          </span>
                        )}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right font-semibold ${
                          b.laba >= 0 ? "text-emerald-700" : "text-rose-700"
                        }`}
                      >
                        {fmtRp(b.laba)}
                        {b.labaRealisasi ? (
                          ""
                        ) : (
                          <span className="block text-[10px] font-normal text-slate-400">
                            proyeksi
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                          {STATUS_TIKTOK[b.statusOrder] ?? b.statusOrder}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${se.cls}`}
                        >
                          {se.label}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">
          Pembayaran Aneka pada rentang ini ({data.pembayaran.length})
        </h2>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Waktu</th>
                <th className="px-4 py-2.5">Kode / Payment</th>
                <th className="px-4 py-2.5 text-right">Total</th>
                <th className="px-4 py-2.5">Sumber</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Resi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.pembayaran.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-6 text-center text-slate-400"
                  >
                    Belum ada pembayaran Aneka pada rentang ini.
                  </td>
                </tr>
              ) : (
                data.pembayaran.map((r) => {
                  const dobel = r.resi && resiDobelSet.has(r.resi);
                  return (
                    <tr key={r.paymentId} className={dobel ? "bg-rose-50" : ""}>
                      <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">
                        {wibDariMs(r.tanggalMs)}
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-slate-900">
                          {r.orderCode || "—"}
                        </p>
                        <p className="text-xs text-slate-500">
                          payment {r.paymentId}
                        </p>
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium text-slate-900">
                        {fmtRp(r.total)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            manualIdSet.has(r.paymentId)
                              ? "bg-violet-100 text-violet-800"
                              : "bg-sky-100 text-sky-800"
                          }`}
                        >
                          {manualIdSet.has(r.paymentId) ? "Manual" : "Hub"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${clsStatusBayar(r.status)}`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {r.resi ? (
                          <span
                            className={
                              dobel
                                ? "font-semibold text-rose-700"
                                : "text-slate-700"
                            }
                          >
                            {r.resi}
                            {dobel ? " (dobel!)" : ""}
                          </span>
                        ) : (
                          <span className="text-slate-400">tanpa resi</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs text-slate-400">
        Laba kotor = omset − total bayar Aneka (sudah termasuk ongkos
        pengemasan Rp3.000 per resi). Belum termasuk komisi TikTok (±8%
        dinamis per kategori sejak 18 Mei 2026 + biaya transaksi) dan komisi
        afiliasi. Order yang belum dibayar ke Aneka memakai laba
        &quot;proyeksi&quot; berdasarkan harga modal katalog. Pembayaran
        bertanda &quot;Manual&quot; dibuat langsung di situs Aneka (bukan
        lewat KTD Hub) — tetap ikut dihitung sebagai biaya. Data Aneka
        diperbarui otomatis maksimal setiap 15 menit saat halaman dibuka —
        tekan &quot;Muat Ulang Data Aneka&quot; untuk memaksa pembaruan
        sekarang.
      </p>
    </div>
  );
}
