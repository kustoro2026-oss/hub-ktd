"use client";

// Tambah satu kontak baru — boleh langsung dimasukkan ke satu grup.
// "Tanpa grup" menyimpan ke daftar umum; grup tetap bisa diatur
// belakangan lewat tabel di bawah.
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ContactGroup } from "@/lib/db";

export default function ContactForm({ groups }: { groups: ContactGroup[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [groupId, setGroupId] = useState(0);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    const target = groups.find((g) => g.id === groupId);
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          phone,
          groupId: groupId > 0 ? groupId : undefined,
        }),
      });
      if (res.ok) {
        setName("");
        setPhone("");
        setSuccess(
          target
            ? `Kontak ditambahkan dan dimasukkan ke grup "${target.name}"`
            : "Kontak ditambahkan ke daftar umum",
        );
        router.refresh();
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Gagal menambah kontak");
      }
    } catch {
      setError("Tidak dapat terhubung ke server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">Nama</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Budi Santoso"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">
          Nomor WhatsApp
        </span>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="0821xxxxxxxx"
          required
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
      </label>
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
        disabled={busy}
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        {busy ? "Menyimpan…" : "Tambah"}
      </button>
      {success && <p className="w-full text-sm text-emerald-700">{success}</p>}
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
    </form>
  );
}
