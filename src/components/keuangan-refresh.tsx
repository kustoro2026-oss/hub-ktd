"use client";

// Tombol "Muat Ulang Data Aneka" di dashboard keuangan — memaksa login +
// scrape riwayat pembayaran & saldo Aneka (read-only), lalu menyegarkan
// halaman. Perlu sesi admin (route API memeriksa isAuthed).
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function KeuanganRefresh() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pesan, setPesan] = useState("");

  async function klik() {
    setBusy(true);
    setPesan("");
    try {
      const res = await fetch("/api/keuangan/refresh", { method: "POST" });
      const d = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        detail?: string;
        error?: string;
      };
      if (d.ok) {
        setPesan("Data Aneka diperbarui.");
      } else {
        setPesan(d.detail ?? d.error ?? "Gagal memperbarui.");
      }
      router.refresh();
    } catch {
      setPesan("Gagal terhubung ke server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={klik}
        disabled={busy}
        className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
      >
        {busy ? "Memuat…" : "Muat Ulang Data Aneka"}
      </button>
      {pesan ? <span className="text-xs text-slate-500">{pesan}</span> : null}
    </div>
  );
}
