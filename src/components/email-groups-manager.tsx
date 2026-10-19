"use client";

// Kelola grup kontak email: buat, ganti nama, dan hapus grup. Menghapus
// grup TIDAK menghapus kontak anggotanya — hanya label pengelompokannya.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil, Trash2, X } from "lucide-react";
import type { EmailGroup } from "@/lib/db";

export default function EmailGroupsManager({
  groups,
}: {
  groups: EmailGroup[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [renaming, setRenaming] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");

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
      const res = await fetch("/api/email/groups", {
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
      await fetch("/api/email/groups", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      router.refresh();
    } catch {
      setError("Jaringan bermasalah — coba lagi");
    }
  }

  async function rename(id: number) {
    const n = renameValue.trim();
    if (n.length < 2) {
      setError("Nama grup minimal 2 karakter");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/email/groups", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name: n }),
      });
      if (res.ok) {
        setRenaming(null);
        router.refresh();
      } else {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? "Gagal mengganti nama grup");
      }
    } catch {
      setError("Jaringan bermasalah — coba lagi");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <form onSubmit={create} className="flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nama grup (mis. Pelanggan Toko)"
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
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {groups.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">
          Belum ada grup. Ketik nama lalu klik &quot;Buat grup&quot; — grup ini
          nanti bisa dipilih langsung saat menambah kontak satuan maupun
          import massal, atau lewat tabel di Langkah 3.
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {groups.map((g) => (
            <span
              key={g.id}
              className="inline-flex items-center gap-2 rounded-full bg-slate-100 py-1 pl-3 pr-1 text-sm text-slate-700"
            >
              {renaming === g.id ? (
                <>
                  <input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && rename(g.id)}
                    autoFocus
                    className="w-28 rounded border border-slate-300 px-1.5 py-0.5 text-xs outline-none focus:border-emerald-500"
                  />
                  <button
                    onClick={() => rename(g.id)}
                    disabled={busy}
                    className="rounded px-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                  >
                    Simpan
                  </button>
                  <button
                    onClick={() => setRenaming(null)}
                    className="rounded-full p-1 text-slate-400 hover:bg-slate-200"
                    aria-label="Batal ganti nama"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : (
                <>
                  {g.name}
                  <span className="rounded-full bg-white px-1.5 text-xs text-slate-500">
                    {g.member_count}
                  </span>
                  <button
                    onClick={() => {
                      setRenaming(g.id);
                      setRenameValue(g.name);
                    }}
                    className="rounded-full p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                    aria-label={`Ganti nama grup ${g.name}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => remove(g.id, g.name)}
                    className="rounded-full p-1 text-slate-400 hover:bg-red-100 hover:text-red-600"
                    aria-label={`Hapus grup ${g.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
