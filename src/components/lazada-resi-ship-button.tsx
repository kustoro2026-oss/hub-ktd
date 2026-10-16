"use client";

// Tombol "Atur Pengiriman" per pesanan Lazada: jalankan pemenuhan penuh
// (pack → rts → document) untuk pesanan berstatus baru, persis seperti
// menu "Atur Pengiriman" di aplikasi TikTok Shop. Nomor resi dibuat sistem
// (KT + order_id) — tidak ada input AWB dari pengguna.
import { useState } from "react";

export default function LazadaResiShipButton({
  orderId,
}: {
  orderId: string;
}) {
  const [state, setState] = useState<"idle" | "busy" | "ok" | "fail">("idle");
  const [detail, setDetail] = useState("");

  async function ship() {
    setState("busy");
    setDetail("");
    try {
      const res = await fetch("/api/lazada/ship", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: orderId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        tracking_number?: string;
        detail?: string;
        error?: string;
      };
      if (data.ok) {
        setState("ok");
        setDetail(
          data.tracking_number
            ? `siap kirim — resi ${data.tracking_number}`
            : "dikonfirmasi",
        );
      } else {
        setState("fail");
        setDetail(data.detail ?? data.error ?? `HTTP ${res.status}`);
      }
    } catch {
      setState("fail");
      setDetail("tidak dapat menghubungi server");
    }
  }

  if (state === "ok") {
    return (
      <span className="text-xs font-medium text-emerald-700" title={detail}>
        Dikonfirmasi ✓
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
      {state === "busy" ? "Mengonfirmasi..." : "Atur Pengiriman"}
    </button>
  );
}
