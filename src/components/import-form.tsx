"use client";

// Import banyak kontak sekaligus — tempel daftar nomor (dengan/tanpa nama),
// boleh langsung dimasukkan ke satu grup. "Tanpa grup" menyimpan ke
// daftar umum; grup tetap bisa diatur belakangan lewat tabel di bawah.
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ContactGroup } from "@/lib/db";

export default function ImportForm({ groups }: { groups: ContactGroup[] }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [groupId, setGroupId] = useState(0);
  const [result, setResult] = useState<{
    added?: number;
    skipped?: string[];
    error?: string;
    groupName?: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    const target = groups.find((g) => g.id === groupId);
    try {
      const res = await fetch("/api/contacts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          groupId: groupId > 0 ? groupId : undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        added?: number;
        skipped?: string[];
        error?: string;
      };
      setResult({ ...data, groupName: target?.name });
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
      <p className="text-xs text-slate-400">
        Contoh benar: <code>Budi, 08123456789</code> atau{" "}
        <code>0812-3456-789</code>. Nama harus dipisah koma dari nomornya —
        tanpa koma baris dianggap nomor saja.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            Grup tujuan
          </span>
          <select
            value={groupId}
            onChange={(e) => setGroupId(Number(e.target.value))}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          >
            <option value={0}>Tanpa grup (daftar umum)</option>
            {groups.length === 0 && (
              <option value={-1} disabled>
                Belum ada grup — buat di Langkah 1
              </option>
            )}
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {busy ? "Mengimpor…" : "Import"}
        </button>
      </div>
      {result?.added !== undefined && (
        <p className="text-sm text-emerald-700">
          Berhasil: {result.added} kontak
          {result.groupName ? ` — dimasukkan ke grup "${result.groupName}"` : ""}
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
