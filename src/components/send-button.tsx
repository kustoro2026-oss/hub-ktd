"use client";

// Tombol kirim broadcast — memproses maksimal satu batch per klik
// (lihat route /api/broadcasts/[id]/send). Klik ulang melanjutkan
// sisa penerima yang masih pending.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Send } from "lucide-react";

export default function SendButton({
  broadcastId,
  pending,
  disabled,
}: {
  broadcastId: number;
  pending: number;
  disabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function send() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/broadcasts/${broadcastId}/send`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        sentNow?: number;
        failedNow?: number;
        pending?: number;
      };
      if (res.ok && data.ok) {
        setMessage(
          `Batch selesai: ${data.sentNow ?? 0} terkirim, ${data.failedNow ?? 0} gagal. Sisa menunggu: ${data.pending ?? 0}.`,
        );
      } else {
        setMessage(data.error ?? "Gagal mengirim");
      }
      router.refresh();
    } catch {
      setMessage("Tidak dapat terhubung ke server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        onClick={send}
        disabled={busy || disabled}
        className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        <Send className="h-4 w-4" />
        {busy
          ? "Mengirim batch…"
          : pending > 0
            ? `Kirim batch berikutnya (${pending} menunggu)`
            : "Kirim"}
      </button>
      {message && <p className="text-sm text-slate-600">{message}</p>}
    </div>
  );
}
