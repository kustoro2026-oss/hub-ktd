"use client";

// Tombol matikan loop harian di halaman detail kampanye. Loop harian dulu
// hanya bisa diatur saat membuat kampanye — kampanye yang terlanjur loop
// tidak bisa dihentikan dari UI, jadi email terus terkirim tiap hari.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Ban } from "lucide-react";

export default function EmailLoopToggle({ campaignId }: { campaignId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");

  async function turnOff() {
    if (
      !window.confirm(
        "Matikan loop harian? Kampanye tidak akan dikirim ulang otomatis " +
          "tiap hari. Siklus yang sedang berjalan tetap mengikuti tombol " +
          "kirim/jeda di bawah.",
      )
    ) {
      return;
    }
    setBusy(true);
    setResult("");
    try {
      const res = await fetch(`/api/email/campaigns/${campaignId}/loop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repeat_daily: 0 }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setResult(d.error ?? "Gagal mematikan loop harian.");
        return;
      }
      router.refresh();
    } catch {
      setResult("Tidak dapat terhubung ke server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={turnOff}
        disabled={busy}
        className="flex items-center gap-1.5 rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-50 disabled:opacity-60"
      >
        <Ban className="h-3.5 w-3.5" />
        {busy ? "Mematikan…" : "Matikan loop harian"}
      </button>
      {result && <span className="text-xs text-violet-700">{result}</span>}
    </div>
  );
}
