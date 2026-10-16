// Halaman Pesanan Lazada — daftar pesanan ditarik langsung dari API Open
// Platform. Filter tanggal (dari/sampai, WIB) di sisi server karena
// memengaruhi data yang diminta ke API; filter cepat (cari/status/urutan)
// di komponen klien. Tanpa filter tanggal, ditampilkan pesanan 30 hari
// terakhir (maks 100).
// Bagian dari grup menu Marketplace → Lazada.
import {
  pullLazadaOrders,
  type LazadaStoreOrders,
} from "@/lib/lazada-orders";
import LazadaOrdersClient from "@/components/lazada-orders-client";
import RefreshButton from "@/components/refresh-button";
import LazadaResiCheckButton from "@/components/lazada-resi-check-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pesanan Lazada" };

const HARI_DETIK = 86400;
/** Batas maksimal rentang filter tanggal (hari) — keamanan API. */
const MAKS_RENTANG_HARI = 90;

const p = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" → awal hari itu dalam WIB sebagai epoch milidetik UTC. */
function awalHariWib(s: string | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(utc)) return null;
  return utc - 7 * 3600 * 1000;
}

/** Epoch milidetik (UTC) → "DD/MM/YYYY" WIB. */
function tanggalWib(ts: number): string {
  const w = new Date(ts + 7 * 3600 * 1000);
  return `${p(w.getUTCDate())}/${p(w.getUTCMonth() + 1)}/${w.getUTCFullYear()}`;
}

type Rentang = {
  filter: { created_after?: string; created_before?: string };
  label: string;
  catatan?: string;
};

/** Ubah param query dari/sampai (YYYY-MM-DD) jadi rentang created_after/
 *  created_before (ISO8601). Tanpa tanggal → 30 hari terakhir. */
function rentangDariSearchParams(dari?: string, sampai?: string): Rentang {
  const now = Date.now();
  const geHari = awalHariWib(dari);
  const ltHari = awalHariWib(sampai);

  // Tanpa tanggal → pesanan 30 hari terakhir.
  if (geHari === null && ltHari === null) {
    return {
      filter: {
        created_after: new Date(now - 30 * HARI_DETIK * 1000).toISOString(),
      },
      label: "30 hari terakhir",
    };
  }

  const ge = geHari ?? now - 7 * HARI_DETIK * 1000;
  const lt = ltHari !== null ? ltHari + HARI_DETIK * 1000 : now;

  if (lt <= ge) {
    return {
      filter: {
        created_after: new Date(now - 30 * HARI_DETIK * 1000).toISOString(),
      },
      label: "30 hari terakhir",
      catatan:
        "Rentang tanggal tidak valid (sampai sebelum dari) — dipakai 30 hari terakhir.",
    };
  }
  if (lt - ge > MAKS_RENTANG_HARI * HARI_DETIK * 1000) {
    const geBaru = lt - MAKS_RENTANG_HARI * HARI_DETIK * 1000;
    return {
      filter: {
        created_after: new Date(geBaru).toISOString(),
        created_before: new Date(lt).toISOString(),
      },
      label: `${tanggalWib(geBaru)} – ${tanggalWib(lt - 1)}`,
      catatan: `Rentang dibatasi maksimal ${MAKS_RENTANG_HARI} hari.`,
    };
  }
  return {
    filter: {
      created_after: new Date(ge).toISOString(),
      created_before: new Date(lt).toISOString(),
    },
    label: `${tanggalWib(ge)} – ${tanggalWib(lt - 1)}`,
  };
}

export default async function PesananLazadaPage({
  searchParams,
}: {
  searchParams: Promise<{ dari?: string; sampai?: string }>;
}) {
  const sp = await searchParams;
  const rentang = rentangDariSearchParams(sp.dari, sp.sampai);
  const results = await pullLazadaOrders({
    ...rentang.filter,
    sort_by: "updated_at",
    sort_direction: "DESC",
    offset: 0,
    limit: 100,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
            Marketplace · Lazada
          </p>
          <h1 className="text-xl font-bold text-slate-900">Pesanan</h1>
          <p className="text-sm text-slate-500">
            Pesanan ditarik langsung dari API Open Platform — {rentang.label}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <RefreshButton />
          <LazadaResiCheckButton />
        </div>
      </div>

      <form
        method="GET"
        action="/marketplace/lazada/pesanan"
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
            defaultValue={sp.dari ?? ""}
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
            defaultValue={sp.sampai ?? ""}
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
          href="/marketplace/lazada/pesanan"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
        >
          Reset
        </a>
        {rentang.catatan ? (
          <p className="w-full text-xs text-amber-700">{rentang.catatan}</p>
        ) : null}
      </form>

      {results.length === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          Belum ada toko Lazada yang terhubung. Pastikan kredensial
          LAZADA_APP_KEY/LAZADA_APP_SECRET sudah diatur dan seller sudah
          otorisasi, kemudian segarkan halaman ini.
        </div>
      ) : (
        results.map((store: LazadaStoreOrders) => (
          <section key={store.store_code} className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-sm font-semibold text-slate-900">
                {store.store_name}
              </h2>
              {store.ok && typeof store.count === "number" ? (
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
                  {store.count} pesanan
                </span>
              ) : null}
            </div>

            {store.ok ? (
              <LazadaOrdersClient
                store={store}
                rentangLabel={rentang.label}
              />
            ) : (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900">
                Gagal mengambil pesanan: {store.detail}
              </div>
            )}
          </section>
        ))
      )}

      {results.length > 0 ? (
        <p className="text-xs text-slate-400">
          Menampilkan maksimal 100 pesanan ({rentang.label}). Bila butuh
          rentang tanggal lain, isi &quot;Dari&quot; dan &quot;Sampai&quot;
          lalu tekan &quot;Terapkan&quot;. Tekan &quot;Segarkan&quot; untuk
          menarik data ulang, atau &quot;Cek Pesanan Baru&quot; untuk
          menyiapkan eksekusi otomatis / mengirim resi PDF ke WhatsApp
          (085171157938) bila ada pesanan yang belum diproses.
        </p>
      ) : null}
    </div>
  );
}
