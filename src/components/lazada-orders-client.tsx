"use client";

// Tabel pesanan Lazada + filter cepat (tanpa reload): cari teks (no.
// pesanan / nama pelanggan), pilih status, dan urutkan terbaru/terlama.
// Filter tanggal ada di halaman induk (server) karena memengaruhi data
// yang ditarik dari API Lazada.
import { useMemo, useState } from "react";
import type { LazadaStoreOrders } from "@/lib/lazada-orders";
import type { LazadaOrderRow } from "@/lib/lazada";
import LazadaResiSendButton from "@/components/lazada-resi-send-button";
import LazadaResiShipButton from "@/components/lazada-resi-ship-button";
import LazadaResiLabelButton from "@/components/lazada-resi-label-button";
import LazadaResiAwbStatus from "@/components/lazada-resi-awb-status";

// Label + warna badge per status pesanan resmi Lazada (statuses[] di
// /orders/get berisi sub-status pengiriman).
const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pesanan Baru", cls: "bg-sky-100 text-sky-800" },
  unpaid: { label: "Belum Bayar", cls: "bg-slate-100 text-slate-700" },
  to_pack: { label: "Perlu Dikemas", cls: "bg-amber-100 text-amber-800" },
  to_ship: { label: "Perlu Dikirim", cls: "bg-violet-100 text-violet-800" },
  packed: { label: "Dikemas", cls: "bg-sky-100 text-sky-800" },
  ready_to_ship: { label: "Siap Kirim", cls: "bg-blue-100 text-blue-800" },
  shipped: { label: "Dalam Pengiriman", cls: "bg-blue-100 text-blue-800" },
  delivered: { label: "Terkirim", cls: "bg-emerald-100 text-emerald-800" },
  canceled: { label: "Dibatalkan", cls: "bg-rose-100 text-rose-800" },
  returned: { label: "Dikembalikan", cls: "bg-rose-100 text-rose-800" },
  failed: { label: "Gagal", cls: "bg-rose-100 text-rose-800" },
  lost: { label: "Hilang", cls: "bg-rose-100 text-rose-800" },
  shipped_back: { label: "Dikirim Balik", cls: "bg-slate-100 text-slate-700" },
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

/** Waktu UTC Lazada ("YYYY-MM-DD HH:MM:SS") → "DD/MM/YYYY HH.MM" WIB. */
function wibDariLazadaTime(s: string): string {
  if (!s) return "—";
  const t = Date.parse(s.replace(" ", "T") + "Z");
  if (!Number.isFinite(t)) return s;
  const w = new Date(t + 7 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(w.getUTCDate())}/${p(w.getUTCMonth() + 1)}/${w.getUTCFullYear()} ${p(w.getUTCHours())}.${p(w.getUTCMinutes())}`;
}

/** Waktu utama baris: updated_at, jatuh ke created_at. */
function orderTime(o: LazadaOrderRow): string {
  return o.updated_at || o.created_at || "";
}

export default function LazadaOrdersClient({
  store,
  rentangLabel,
}: {
  store: LazadaStoreOrders;
  rentangLabel: string;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [urut, setUrut] = useState<"terbaru" | "terlama">("terbaru");

  const orders = store.orders ?? [];

  const tampil = useMemo(() => {
    const list = [...orders].sort((a, b) => {
      const ta = Date.parse(orderTime(a).replace(" ", "T") + "Z") || 0;
      const tb = Date.parse(orderTime(b).replace(" ", "T") + "Z") || 0;
      return urut === "terbaru" ? tb - ta : ta - tb;
    });
    const teks = q.trim().toLowerCase();
    return list.filter((o) => {
      if (status && !(o.statuses ?? []).includes(status)) return false;
      if (!teks) return true;
      const nama = [o.address_shipping?.first_name, o.address_shipping?.last_name]
        .filter(Boolean)
        .join(" ");
      const hay = `${o.order_number} ${o.order_id} ${nama}`.toLowerCase();
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
          placeholder="Cari no. pesanan / pelanggan…"
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
                <th className="px-4 py-3 font-semibold">Pesanan</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Jumlah</th>
                <th className="px-4 py-3 font-semibold">Resi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tampil.map((o) => {
                const statuses = (o.statuses ?? []).filter(Boolean);
                const nama = [
                  o.address_shipping?.first_name,
                  o.address_shipping?.last_name,
                ]
                  .filter(Boolean)
                  .join(" ");
                const masihBaru = statuses.some((s) =>
                  ["pending", "to_pack", "to_ship", "packed"].includes(s),
                );
                return (
                  <tr key={o.order_id} className="align-top hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {wibDariLazadaTime(orderTime(o))}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-slate-800">{nama || "—"}</div>
                      <div className="mt-0.5 font-mono text-[11px] text-slate-400">
                        {o.order_number}
                      </div>
                      <div className="font-mono text-[11px] text-slate-400">
                        ID {o.order_id}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex flex-col gap-1">
                        {statuses.length > 0 ? (
                          statuses.map((s) => <StatusBadge key={s} status={s} />)
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {o.items_count} item
                      <div className="text-xs text-slate-400">{o.price}</div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center gap-2">
                        {masihBaru ? (
                          <LazadaResiShipButton orderId={o.order_id} />
                        ) : null}
                        <a
                          href={`/api/lazada/resi/${o.order_id}`}
                          target="_blank"
                          rel="noopener"
                          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-500 hover:bg-slate-50"
                        >
                          Cetak Resi
                        </a>
                        <LazadaResiLabelButton orderId={o.order_id} />
                        <LazadaResiAwbStatus orderId={o.order_id} />
                        <LazadaResiSendButton orderId={o.order_id} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
