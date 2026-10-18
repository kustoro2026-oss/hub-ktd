// Halaman Pesanan TikTok Shop — daftar pesanan ditarik langsung dari API
// resmi. Filter tanggal (dari/sampai, WIB) di sisi server karena memengaruhi
// data yang diminta ke API; filter cepat (cari/status/urutan) di komponen
// klien. Tanpa filter tanggal, ditampilkan 7 hari terakhir.
// Bagian dari grup menu Marketplace → TikTok Shop.
import {
  pullTiktokShopOrders,
  type TiktokShopOrders,
} from "@/lib/tiktok-orders";
import TiktokOrdersClient from "@/components/tiktok-orders-client";
import RefreshButton from "@/components/refresh-button";
import ResiCheckButton from "@/components/resi-check-button";
import PageHeader from "@/components/page-header";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pesanan TikTok Shop" };

const HARI_DETIK = 86400;
/** Batas maksimal rentang filter tanggal (hari) — keamanan API. */
const MAKS_RENTANG_HARI = 90;

const p = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" → awal hari itu dalam WIB sebagai epoch detik UTC. */
function awalHariWib(s: string | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(utc)) return null;
  return Math.floor(utc / 1000) - 7 * 3600;
}

/** Epoch detik (UTC) → "DD/MM/YYYY" WIB. */
function tanggalWib(ts: number): string {
  const w = new Date((ts + 7 * 3600) * 1000);
  return `${p(w.getUTCDate())}/${p(w.getUTCMonth() + 1)}/${w.getUTCFullYear()}`;
}

type Rentang = {
  filter: { createTimeGe?: number; createTimeLt?: number };
  label: string;
  catatan?: string;
};

/** Ubah param query dari/sampai (YYYY-MM-DD) jadi rentang create_time. */
function rentangDariSearchParams(dari?: string, sampai?: string): Rentang {
  const now = Math.floor(Date.now() / 1000);
  const geHari = awalHariWib(dari);
  const ltHari = awalHariWib(sampai);

  // Tanpa tanggal → perilaku lama: 7 hari terakhir (pembaruan status).
  if (geHari === null && ltHari === null) {
    return { filter: {}, label: "7 hari terakhir" };
  }

  const ge = geHari ?? now - 7 * HARI_DETIK;
  const lt = ltHari !== null ? ltHari + HARI_DETIK : now;

  if (lt <= ge) {
    return {
      filter: {},
      label: "7 hari terakhir",
      catatan:
        "Rentang tanggal tidak valid (sampai sebelum dari) — dipakai 7 hari terakhir.",
    };
  }
  if (lt - ge > MAKS_RENTANG_HARI * HARI_DETIK) {
    const geBaru = lt - MAKS_RENTANG_HARI * HARI_DETIK;
    return {
      filter: { createTimeGe: geBaru, createTimeLt: lt },
      label: `${tanggalWib(geBaru)} – ${tanggalWib(lt - 1)}`,
      catatan: `Rentang dibatasi maksimal ${MAKS_RENTANG_HARI} hari.`,
    };
  }
  return {
    filter: { createTimeGe: ge, createTimeLt: lt },
    label: `${tanggalWib(ge)} – ${tanggalWib(lt - 1)}`,
  };
}

export default async function PesananTikTokPage({
  searchParams,
}: {
  searchParams: Promise<{ dari?: string; sampai?: string }>;
}) {
  const sp = await searchParams;
  const rentang = rentangDariSearchParams(sp.dari, sp.sampai);
  const results = await pullTiktokShopOrders({
    ...rentang.filter,
    pageSize: 50,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Marketplace · TikTok Shop"
        title="Pesanan"
        subtitle={`Ditarik langsung dari API Seller — ${rentang.label}`}
        actions={
          <>
            <RefreshButton />
            <ResiCheckButton />
          </>
        }
      />

      <form
        method="GET"
        action="/marketplace/tiktok/pesanan"
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
          href="/marketplace/tiktok/pesanan"
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
          Belum ada toko TikTok Shop yang terotorisasi. Buka kembali tautan
          otorisasi TikTok Shop lalu selesaikan izin aksesnya, kemudian
          segarkan halaman ini.
        </div>
      ) : (
        results.map((shop: TiktokShopOrders) => (
          <section key={shop.shop_id} className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-sm font-semibold text-slate-900">
                {shop.shop_name}
              </h2>
              {shop.ok && typeof shop.count === "number" ? (
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
                  {shop.count} pesanan
                </span>
              ) : null}
            </div>

            {shop.ok ? (
              <TiktokOrdersClient
                shop={shop}
                rentangLabel={rentang.label}
              />
            ) : (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900">
                Gagal mengambil pesanan: {shop.detail}
              </div>
            )}
          </section>
        ))
      )}

      {results.length > 0 ? (
        <p className="text-xs text-slate-400">
          Menampilkan maksimal 50 pesanan per toko ({rentang.label}).
        </p>
      ) : null}
    </div>
  );
}
