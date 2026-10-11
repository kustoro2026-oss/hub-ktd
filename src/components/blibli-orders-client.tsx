"use client";

// Tabel pesanan Blibli + filter cepat (tanpa reload): cari teks (produk /
// no. pesanan / SKU), pilih status, dan urutkan terbaru/terlama. Filter
// tanggal ada di halaman induk (server) karena memengaruhi data yang
// ditarik dari API Blibli.
import { useMemo, useState } from "react";
import type { BlibliStoreOrders } from "@/lib/blibli-orders";
import type { BlibliOrderPackage } from "@/lib/blibli";
import BlibliResiSendButton from "@/components/blibli-resi-send-button";
import BlibliResiShipButton from "@/components/blibli-resi-ship-button";

// Label + warna badge per status item resmi Blibli.
const STATUS_META: Record<string, { label: string; cls: string }> = {
  C: { label: "Dibuat", cls: "bg-amber-100 text-amber-800" },
  FP: { label: "Pesanan Baru", cls: "bg-sky-100 text-sky-800" },
  PU: { label: "Menunggu Kurir", cls: "bg-violet-100 text-violet-800" },
  PF: { label: "Sebagian Terpenuhi", cls: "bg-sky-100 text-sky-800" },
  CR: { label: "Minta Pembatalan", cls: "bg-orange-100 text-orange-800" },
  CX: { label: "Dalam Pengiriman", cls: "bg-blue-100 text-blue-800" },
  OS: { label: "Stok Habis", cls: "bg-rose-100 text-rose-800" },
  BP: { label: "Siap Diambil (BOPIS)", cls: "bg-emerald-100 text-emerald-800" },
  D: { label: "Terkirim", cls: "bg-emerald-100 text-emerald-800" },
  X: { label: "Dibatalkan", cls: "bg-rose-100 text-rose-800" },
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

// Epoch milidetik (UTC) → "DD/MM/YYYY HH.MM" WIB.
function wibDariEpochMs(ts: number): string {
  if (!ts) return "—";
  const w = new Date(ts + 7 * 3600 * 1000);
  if (Number.isNaN(w.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(w.getUTCDate())}/${p(w.getUTCMonth() + 1)}/${w.getUTCFullYear()} ${p(w.getUTCHours())}.${p(w.getUTCMinutes())}`;
}

export default function BlibliOrdersClient({
  store,
  rentangLabel,
}: {
  store: BlibliStoreOrders;
  rentangLabel: string;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [urut, setUrut] = useState<"terbaru" | "terlama">("terbaru");

  const packages = store.packages ?? [];

  const tampil = useMemo(() => {
    const list = [...packages].sort((a, b) => {
      const ta = paketTime(a);
      const tb = paketTime(b);
      return urut === "terbaru" ? tb - ta : ta - tb;
    });
    const teks = q.trim().toLowerCase();
    return list.filter((pkg) => {
      if (status && !pkg.orderItems.some((i) => i.order.itemStatus === status)) {
        return false;
      }
      if (!teks) return true;
      const hay = `${pkg.packageId} ${pkg.orderItems
        .map(
          (i) =>
            `${i.order.id} ${i.product.itemName} ${i.product.sellerSku}`,
        )
        .join(" ")}`.toLowerCase();
      return hay.includes(teks);
    });
  }, [packages, q, status, urut]);

  if (packages.length === 0) {
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
          {tampil.length} dari {packages.length} pesanan
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
              {tampil.map((pkg) => {
                const statuses = Array.from(
                  new Set(
                    pkg.orderItems.map((i) => i.order.itemStatus).filter(Boolean),
                  ),
                );
                const punyaPaket = pkg.orderItems.every((i) => i.flag?.packageCreated);
                const masihFP = pkg.orderItems.some(
                  (i) => i.order.itemStatus === "FP",
                );
                const item = pkg.orderItems[0];
                return (
                  <tr key={pkg.packageId} className="align-top hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {wibDariEpochMs(paketTime(pkg))}
                    </td>
                    <td className="px-4 py-3">
                      <ul className="space-y-1 text-slate-800">
                        {pkg.orderItems.map((it, i) => (
                          <li key={i}>
                            <span className="mr-1.5 inline-flex min-w-6 justify-center rounded bg-slate-100 px-1 text-xs font-semibold text-slate-600">
                              {it.order.quantity > 0
                                ? `${it.order.quantity}×`
                                : "—"}
                            </span>
                            {it.product.itemName}
                            {it.product.sellerSku ? (
                              <span
                                title="SKU penjual (dipakai pemetaan ke Aneka)"
                                className="block font-mono text-[11px] text-slate-400"
                              >
                                SKU {it.product.sellerSku}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex flex-col gap-1">
                        {statuses.map((s) => (
                          <StatusBadge key={s} status={s} />
                        ))}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-500">
                      <div>PKG {pkg.packageId}</div>
                      {pkg.orderItems.map((it) => (
                        <div key={it.order.id} className="text-slate-400">
                          ITM {it.order.id}
                        </div>
                      ))}
                      {item?.order.autoCancelTimestamp ? (
                        <div className="mt-1 font-sans text-[11px] text-amber-700">
                          Batal otomatis {wibDariEpochMs(item.order.autoCancelTimestamp)}
                        </div>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center gap-2">
                        {masihFP && punyaPaket ? (
                          <BlibliResiShipButton
                            packageId={pkg.packageId}
                            awbNo={item?.logistic?.awbNumber ?? ""}
                          />
                        ) : null}
                        <a
                          href={`/api/blibli/resi/${pkg.packageId}`}
                          target="_blank"
                          rel="noopener"
                          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-500 hover:bg-slate-50"
                        >
                          Cetak Resi
                        </a>
                        <BlibliResiSendButton packageId={pkg.packageId} />
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

/** Waktu utama paket: statusFPUpdatedTimestamp terbaru dari item-nya,
 *  jatuh ke tanggal pembuatan item. */
function paketTime(pkg: BlibliOrderPackage): number {
  const times = pkg.orderItems
    .map((i) => i.order.statusFPUpdatedTimestamp ?? i.order.date ?? i.createdDate ?? 0)
    .filter(Boolean);
  return times.length > 0 ? Math.max(...times) : 0;
}
