"use client";

// Tombol kirim resi manual per pesanan: mengirim PDF resi pesanan ini ke
// WhatsApp admin (085171157938) lewat jalur yang sama dengan kirim otomatis
// (dokumen bebas → template resi_pesanan → template teks).
import { useState } from "react";

export default function ResiSendButton({ orderId }: { orderId: string }) {
  const [state, setState] = useState<"idle" | "busy" | "ok" | "fail">("idle");
  const [detail, setDetail] = useState("");

  async function send() {
    setState("busy");
    setDetail("");
    try {
      const res = await fetch("/api/tiktok/resi/send", {
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
        setDetail(data.result ?? "terkirim");
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
        Terkirim ✓
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
      onClick={send}
      disabled={state === "busy"}
      className="rounded-lg border border-emerald-300 px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-60"
    >
      {state === "busy" ? "Mengirim..." : "Kirim Resi"}
    </button>
  );
}
