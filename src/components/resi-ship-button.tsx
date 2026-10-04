"use client";

// Tombol "Atur Pengiriman" per pesanan: jadwalkan penjemputan kurir untuk
// pesanan berstatus AWAITING_SHIPMENT (Menunggu kirim), persis seperti menu
// "Atur Pengiriman" di aplikasi TikTok Shop. Setelah berhasil, label kirim
// resmi bisa dibuka lewat tombol "Cetak Resi".
import { useState } from "react";

export default function ResiShipButton({ orderId }: { orderId: string }) {
  const [state, setState] = useState<"idle" | "busy" | "ok" | "fail">("idle");
  const [detail, setDetail] = useState("");

  async function ship() {
    setState("busy");
    setDetail("");
    try {
      const res = await fetch("/api/tiktok/ship", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: orderId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        result?: string;
        error?: string;
      };
      if (data.ok) {
        setState("ok");
        setDetail(data.result ?? "dijadwalkan");
      } else {
        setState("fail");
        setDetail(data.result ?? data.error ?? `HTTP ${res.status}`);
      }
    } catch {
      setState("fail");
      setDetail("tidak dapat menghubungi server");
    }
  }

  if (state === "ok") {
    return (
      <span className="text-xs font-medium text-emerald-700" title={detail}>
        Dijadwalkan ✓
      </span>
    );
  }
  if (state === "fail") {
    return (
      <div className="max-w-48">
        <span className="text-xs font-medium text-rose-700">Gagal — coba lagi</span>
        {detail ? (
          <p className="mt-0.5 break-words text-xs leading-snug text-rose-600/90">
            {detail}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={ship}
      disabled={state === "busy"}
      className="rounded-lg border border-sky-300 px-3 py-1.5 text-xs font-medium text-sky-700 transition hover:bg-sky-50 disabled:opacity-60"
    >
      {state === "busy" ? "Menjadwalkan..." : "Atur Pengiriman"}
    </button>
  );
}
