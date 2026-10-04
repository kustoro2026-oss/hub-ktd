"use client";

// Tabel kontak dengan aksi hapus.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import type { Contact } from "@/lib/db";

export default function ContactsTable({ contacts }: { contacts: Contact[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<number | null>(null);

  async function remove(id: number) {
    if (!confirm("Hapus kontak ini?")) return;
    setBusyId(id);
    try {
      await fetch("/api/contacts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  if (contacts.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-slate-500">
        Belum ada kontak. Tambahkan lewat form di atas.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
            <th className="py-2 pr-4 font-medium">Nama</th>
            <th className="py-2 pr-4 font-medium">Nomor</th>
            <th className="py-2 pr-4 font-medium">WhatsApp</th>
            <th className="py-2 pr-4 font-medium">Ditambahkan</th>
            <th className="py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {contacts.map((c) => (
            <tr key={c.id} className="hover:bg-slate-50">
              <td className="py-2 pr-4 text-slate-900">
                {c.name || <span className="text-slate-400">—</span>}
              </td>
              <td className="py-2 pr-4 font-mono text-slate-600">{c.phone}</td>
              <td className="py-2 pr-4">
                {c.wa_status === "valid" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                    <CheckCircle2 className="h-3 w-3" /> Valid
                  </span>
                )}
                {c.wa_status === "invalid" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                    <XCircle className="h-3 w-3" /> Tidak valid
                  </span>
                )}
                {c.wa_status === "error" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                    <AlertCircle className="h-3 w-3" /> Gagal cek
                  </span>
                )}
                {!c.wa_status && (
                  <span className="text-xs text-slate-400">Belum dicek</span>
                )}
              </td>
              <td className="py-2 pr-4 text-xs text-slate-400">{c.created_at}</td>
              <td className="py-2 text-right">
                <button
                  onClick={() => remove(c.id)}
                  disabled={busyId === c.id}
                  className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                  aria-label="Hapus kontak"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
