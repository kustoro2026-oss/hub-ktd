// Halaman Pesanan TikTok Shop — daftar pesanan terbaru ditarik langsung
// dari API resmi (maks. 20 pesanan dalam 7 hari terakhir per toko).
// Bagian dari grup menu Marketplace → TikTok Shop.
import { pullTiktokShopOrders, type TiktokShopOrders } from "@/lib/tiktok-orders";
import RefreshButton from "@/components/refresh-button";
import ResiCheckButton from "@/components/resi-check-button";
import ResiSendButton from "@/components/resi-send-button";
import ResiShipButton from "@/components/resi-ship-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pesanan TikTok Shop" };

// Label + warna badge per status resmi TikTok Shop.
const STATUS_META: Record<string, { label: string; cls: string }> = {
  UNPAID: { label: "Belum dibayar", cls: "bg-amber-100 text-amber-800" },
  ON_HOLD: { label: "Tertahan", cls: "bg-orange-100 text-orange-800" },
  AWAITING_SHIPMENT: { label: "Menunggu kirim", cls: "bg-sky-100 text-sky-800" },
  PARTIALLY_SHIPPING: {
    label: "Sebagian terkirim",
    cls: "bg-sky-100 text-sky-800",
  },
  AWAITING_COLLECTION: {
    label: "Menunggu pickup",
    cls: "bg-violet-100 text-violet-800",
  },
  IN_TRANSIT: { label: "Dalam perjalanan", cls: "bg-blue-100 text-blue-800" },
  DELIVERED: { label: "Terkirim", cls: "bg-emerald-100 text-emerald-800" },
  COMPLETED: { label: "Selesai", cls: "bg-emerald-100 text-emerald-800" },
  CANCELLED: { label: "Dibatalkan", cls: "bg-rose-100 text-rose-800" },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? {
    label: status,
    cls: "bg-slate-100 text-slate-700",
  };
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${meta.cls}`}
    >
      {meta.label}
    </span>
  );
}

// Epoch detik (UTC) → "DD/MM/YYYY HH.MM" WIB.
function wibDariEpoch(ts: number): string {
  if (!ts) return "—";
  const w = new Date((ts + 7 * 3600) * 1000);
  if (Number.isNaN(w.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(w.getUTCDate())}/${p(w.getUTCMonth() + 1)}/${w.getUTCFullYear()} ${p(w.getUTCHours())}.${p(w.getUTCMinutes())}`;
}

function TabelPesanan({ shop }: { shop: TiktokShopOrders }) {
  const orders = shop.orders ?? [];
  if (orders.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        Tidak ada pesanan dalam 7 hari terakhir.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[820px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <th className="px-4 py-3 font-semibold">Waktu</th>
            <th className="px-4 py-3 font-semibold">Produk</th>
            <th className="px-4 py-3 font-semibold">Status</th>
            <th className="px-4 py-3 font-semibold">No. Pesanan</th>
            <th className="px-4 py-3 font-semibold">Resi</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {orders.map((o) => (
            <tr key={o.order_id} className="align-top hover:bg-slate-50">
              <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                {wibDariEpoch(o.create_time)}
              </td>
              <td className="px-4 py-3">
                <ul className="space-y-1 text-slate-800">
                  {o.items.map((it, i) => (
                    <li key={i}>
                      <span className="mr-1.5 inline-flex min-w-6 justify-center rounded bg-slate-100 px-1 text-xs font-semibold text-slate-600">
                        {it.sku_count}×
                      </span>
                      {it.product_name}
                    </li>
                  ))}
                </ul>
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                <StatusBadge status={o.order_status} />
              </td>
              <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-500">
                {o.order_id}
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                <div className="flex items-center gap-2">
                  {o.order_status === "AWAITING_SHIPMENT" ? (
                    <ResiShipButton orderId={o.order_id} />
                  ) : null}
                  <a
                    href={`/api/tiktok/resi/${o.order_id}`}
                    target="_blank"
                    rel="noopener"
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-500 hover:bg-slate-50"
                  >
                    Cetak Resi
                  </a>
                  <ResiSendButton orderId={o.order_id} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function PesananTikTokPage() {
  const results = await pullTiktokShopOrders();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
            Marketplace · TikTok Shop
          </p>
          <h1 className="text-xl font-bold text-slate-900">Pesanan</h1>
          <p className="text-sm text-slate-500">
            Pesanan terbaru ditarik langsung dari API Seller
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <RefreshButton />
          <ResiCheckButton />
        </div>
      </div>

      {results.length === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          Belum ada toko TikTok Shop yang terotorisasi. Buka kembali tautan
          otorisasi TikTok Shop lalu selesaikan izin aksesnya, kemudian
          segarkan halaman ini.
        </div>
      ) : (
        results.map((shop) => (
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
              <TabelPesanan shop={shop} />
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
          Menampilkan maksimal 20 pesanan terbaru (7 hari terakhir) per toko.
          Tekan &quot;Segarkan&quot; untuk menarik data ulang, atau
          &quot;Cek Pesanan Baru&quot; untuk mengirim resi PDF otomatis ke
          WhatsApp (085171157938) bila ada pesanan yang belum diproses.
        </p>
      ) : null}
    </div>
  );
}
