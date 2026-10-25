"use client";

// Tombol "hapus email gagal dari kontak" di halaman detail kampanye.
// Mengirim daftar alamat yang gagal terkirim ke /api/email/contacts/bulk-delete
// supaya kontak bersangkutan tidak dikirimi lagi (terutama pada kampanye loop).
import { useState } from "react";
import { Trash2 } from "lucide-react";

export default function EmailFailedCleaner({ emails }: { emails: string[] }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");

  async function run() {
    if (emails.length === 0) return;
    if (
      !window.confirm(
        `Hapus ${emails.length} alamat gagal dari daftar kontak? Email tidak aktif tidak akan dikirimi lagi.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setResult("");
    try {
      const res = await fetch("/api/email/contacts/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        deleted?: number;
        error?: string;
      };
      if (res.ok && typeof d.deleted === "number") {
        setResult(`Berhasil menghapus ${d.deleted} kontak tidak aktif.`);
      } else {
        setResult(d.error ?? "Gagal menghapus kontak.");
      }
    } catch {
      setResult("Tidak dapat terhubung ke server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={run}
        disabled={busy || emails.length === 0}
        className="flex items-center gap-2 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
      >
        <Trash2 className="h-3.5 w-3.5" />
        {busy ? "Menghapus…" : "Hapus email gagal dari kontak"}
      </button>
      {result && <span className="text-xs text-slate-600">{result}</span>}
    </div>
  );
}
