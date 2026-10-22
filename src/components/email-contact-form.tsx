"use client";

// Tambah satu kontak email. Grup WAJIB dipilih — tidak ada daftar umum.
// Bila alamat sudah ada di grup lain, kontak dipindahkan ke grup tujuan
// (bukan diduplikasi), dan pesan sukses menyebutkan perpindahannya.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { EmailGroup } from "@/lib/db";

export default function EmailContactForm({
  groups,
}: {
  groups: EmailGroup[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [groupId, setGroupId] = useState(groups[0]?.id ?? 0);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  // Jaga pilihan tetap valid saat daftar grup berubah (mis. grup dihapus).
  useEffect(() => {
    if (!groups.some((g) => g.id === groupId)) {
      setGroupId(groups[0]?.id ?? 0);
    }
  }, [groups, groupId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!groupId) {
      setError("Buat grup dulu di Langkah 1");
      return;
    }
    setBusy(true);
    setError("");
    setSuccess("");
    const target = groups.find((g) => g.id === groupId);
    try {
      const res = await fetch("/api/email/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, groupId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        created?: boolean;
        movedFrom?: number;
        error?: string;
      };
      if (res.ok) {
        setName("");
        setEmail("");
        const from = groups.find((g) => g.id === data.movedFrom);
        setSuccess(
          data.created === false
            ? from
              ? `Kontak sudah ada — dipindahkan dari grup "${from.name}" ke "${target?.name}"`
              : `Kontak sudah ada — diperbarui di grup "${target?.name}"`
            : `Kontak ditambahkan ke grup "${target?.name}"`,
        );
        router.refresh();
      } else {
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
          Alamat email
        </span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="budi@gmail.com"
          required
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">
          Grup tujuan (wajib)
        </span>
        <select
          value={groupId}
          onChange={(e) => setGroupId(Number(e.target.value))}
          disabled={groups.length === 0}
          required
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 disabled:bg-slate-50"
        >
          {groups.length === 0 && (
            <option value={0}>Belum ada grup — buat di Langkah 1</option>
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
        disabled={busy || groups.length === 0}
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        {busy ? "Menyimpan…" : "Tambah"}
      </button>
      {success && <p className="w-full text-sm text-emerald-700">{success}</p>}
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
    </form>
  );
}
