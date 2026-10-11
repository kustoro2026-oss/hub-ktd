"use client";

// Tombol blokir/buka blokir nomor pelanggan di halaman chat — proteksi
// anti-spam: nomor yang diblokir membuat bot diam total (pesan tetap
// dicatat di Pesan Masuk).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, CircleCheck } from "lucide-react";

export default function BlockButton({
  waFrom,
  blocked,
}: {
  waFrom: string;
  blocked: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/wa/block?from=${encodeURIComponent(waFrom)}`,
        { method: blocked ? "DELETE" : "POST" },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        window.alert(data.error ?? "Gagal mengubah status blokir");
        return;
      }
      router.refresh();
    } catch {
      window.alert("Jaringan bermasalah — coba lagi");
    }
    setBusy(false);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
        blocked
          ? "bg-white/15 text-white hover:bg-white/25"
          : "bg-red-600 text-white hover:bg-red-700"
      }`}
      title={
        blocked
          ? "Buka blokir nomor ini"
          : "Blokir nomor ini dari balasan bot"
      }
    >
      {blocked ? (
        <CircleCheck className="h-3.5 w-3.5" />
      ) : (
        <Ban className="h-3.5 w-3.5" />
      )}
      {blocked ? "Buka blokir" : "Blokir"}
    </button>
  );
}
