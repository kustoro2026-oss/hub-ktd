"use client";

// Tabel pesanan TikTok Shop + filter cepat (tanpa reload): cari teks
// (produk / no. pesanan), pilih status, dan urutkan terbaru/terlama.
// Filter tanggal ada di halaman induk (server) karena memengaruhi data
// yang ditarik dari API TikTok.
import { useMemo, useState } from "react";
import type { TiktokShopOrders } from "@/lib/tiktok-orders";
import ResiSendButton from "@/components/resi-send-button";
import ResiShipButton from "@/components/resi-ship-button";

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

export default function TiktokOrdersClient({
  shop,
  rentangLabel,
}: {
  shop: TiktokShopOrders;
  rentangLabel: string;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [urut, setUrut] = useState<"terbaru" | "terlama">("terbaru");

  const orders = shop.orders ?? [];

  const tampil = useMemo(() => {
    const list = [...orders].sort((a, b) =>
      urut === "terbaru"
        ? b.create_time - a.create_time
        : a.create_time - b.create_time,
    );
    const teks = q.trim().toLowerCase();
    return list.filter((o) => {
      if (status && o.order_status !== status) return false;
      if (!teks) return true;
      const hay = `${o.order_id} ${o.items
        .map((i) => i.product_name)
        .join(" ")}`.toLowerCase();
      return hay.includes(teks);
    });
  }, [orders, q, status, urut]);

  if (orders.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        Tidak ada pesanan dalam {rentangLabel}.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cari produk / no. pesanan…"
          className="w-64 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 outline-none focus:border-emerald-600"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700"
        >
          <option value="">Semua status</option>
          {Object.entries(STATUS_META).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <select
          value={urut}
          onChange={(e) => setUrut(e.target.value as "terbaru" | "terlama")}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700"
        >
          <option value="terbaru">Terbaru dulu</option>
          <option value="terlama">Terlama dulu</option>
        </select>
        <span className="ml-auto text-xs text-slate-500">
          {tampil.length} dari {orders.length} pesanan
        </span>
      </div>

      {tampil.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Tidak ada pesanan yang cocok dengan filter.
        </div>
      ) : (
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
              {tampil.map((o) => (
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
      )}
    </div>
  );
}
