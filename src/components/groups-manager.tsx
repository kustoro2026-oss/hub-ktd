"use client";

// Kelola grup kontak: buat dan hapus grup. Menghapus grup TIDAK
// menghapus kontak anggotanya — hanya label pengelompokannya saja.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { ContactGroup } from "@/lib/db";

export default function GroupsManager({ groups }: { groups: ContactGroup[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (n.length < 2) {
      setError("Nama grup minimal 2 karakter");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: n }),
      });
      if (res.ok) {
        setName("");
        router.refresh();
      } else {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? "Gagal membuat grup");
      }
    } catch {
      setError("Jaringan bermasalah — coba lagi");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number, gname: string) {
    if (
      !confirm(
        `Hapus grup "${gname}"? Kontak di dalamnya TIDAK ikut terhapus — hanya pengelompokannya.`,
      )
    )
      return;
    try {
      await fetch("/api/groups", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      router.refresh();
    } catch {
      setError("Jaringan bermasalah — coba lagi");
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">Grup kontak</h2>
        <form onSubmit={create} className="flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nama grup (mis. Bisnis A)"
            maxLength={40}
            className="w-52 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-emerald-500"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            {busy ? "Menyimpan…" : "Buat grup"}
          </button>
        </form>
      </div>
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      {groups.length === 0 ? (
        <p className="text-sm text-slate-500">
          Belum ada grup. Buat grup untuk mengelompokkan kontak — misalnya
          &quot;Bisnis A&quot; atau &quot;Pelanggan Herbal&quot; — lalu tandai
          kontak dan masukkan ke grup lewat tabel di bawah.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {groups.map((g) => (
            <span
              key={g.id}
              className="inline-flex items-center gap-2 rounded-full bg-slate-100 py-1 pl-3 pr-1 text-sm text-slate-700"
            >
              {g.name}
              <span className="rounded-full bg-white px-1.5 text-xs text-slate-500">
                {g.member_count}
              </span>
              <button
                onClick={() => remove(g.id, g.name)}
                className="rounded-full p-1 text-slate-400 hover:bg-red-100 hover:text-red-600"
                aria-label={`Hapus grup ${g.name}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
