"use client";

// Import banyak kontak sekaligus — tempel daftar nomor (dengan/tanpa nama).
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ImportForm() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [result, setResult] = useState<{
    added?: number;
    skipped?: string[];
    error?: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/contacts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        added?: number;
        skipped?: string[];
        error?: string;
      };
      setResult(data);
      if (res.ok) {
        setText("");
        router.refresh();
      }
    } catch {
      setResult({ error: "Tidak dapat terhubung ke server" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">
          Daftar nomor — satu per baris: <code>Nama, 0821xxxxxxx</code> atau
          cukup nomornya
        </span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder={"Budi, 0812xxxxxxx\n0821-7342-7249\nSiti, +62 812-xxxx-xxxx"}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
      </label>
      <button
        type="submit"
        disabled={busy || !text.trim()}
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        {busy ? "Mengimpor…" : "Import"}
      </button>
      {result?.added !== undefined && (
        <p className="text-sm text-emerald-700">
          Berhasil: {result.added} kontak
          {result.skipped && result.skipped.length > 0 && (
            <span className="text-slate-500">
              {" "}
              — dilewati {result.skipped.length}: {result.skipped.slice(0, 5).join(", ")}
              {result.skipped.length > 5 ? "…" : ""}
            </span>
          )}
        </p>
      )}
      {result?.error && <p className="text-sm text-red-600">{result.error}</p>}
    </form>
  );
}
