"use client";

// Tombol "Segarkan" untuk halaman server — meminta Next.js memuat ulang
// komponen server lalu menampilkan ikon berputar sesaat.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { RefreshCw } from "lucide-react";

export default function RefreshButton({
  label = "Segarkan",
}: {
  label?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function refresh() {
    if (busy) return;
    setBusy(true);
    router.refresh();
    // Beri jeda singkat agar ikon berputar terlihat; konten server
    // otomatis diperbarui oleh router.refresh().
    setTimeout(() => setBusy(false), 900);
  }

  return (
    <button
      onClick={refresh}
      disabled={busy}
      className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
    >
      <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
      {label}
    </button>
  );
}
