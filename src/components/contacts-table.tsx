"use client";

// Tabel kontak dengan fitur: tandai (pilih banyak), filter per grup,
// masukkan ke grup, hapus satu atau banyak sekaligus (permanen).
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  Trash2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Tags,
  X,
} from "lucide-react";
import type { Contact, ContactGroup } from "@/lib/db";

type GroupRef = { id: number; name: string };

export default function ContactsTable({
  contacts,
  groups,
  groupMap,
}: {
  contacts: Contact[];
  groups: ContactGroup[];
  groupMap: Record<number, GroupRef[]>;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [filterGroup, setFilterGroup] = useState(0); // 0 = semua
  const [editFor, setEditFor] = useState<number | null>(null); // popover grup
  const [editSel, setEditSel] = useState<Set<number>>(new Set());
  const [bulkGroup, setBulkGroup] = useState(0);
  const [bulkBusy, setBulkBusy] = useState(false);

  const filtered = useMemo(
    () =>
      filterGroup === 0
        ? contacts
        : contacts.filter((c) =>
            (groupMap[c.id] ?? []).some((g) => g.id === filterGroup),
          ),
    [contacts, filterGroup, groupMap],
  );

  const allSelected =
    filtered.length > 0 && filtered.every((c) => selected.has(c.id));

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((c) => c.id)));
    }
  }

  async function removeMany(ids: number[]) {
    if (
      !confirm(
        `Hapus ${ids.length} kontak secara permanen? Riwayat broadcast tetap tersimpan.`,
      )
    )
      return;
    setBulkBusy(true);
    try {
      const res = await fetch("/api/contacts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (res.ok) {
        setSelected(new Set());
        router.refresh();
      }
    } finally {
      setBulkBusy(false);
    }
  }

  async function removeOne(id: number) {
    if (!confirm("Hapus kontak ini secara permanen?")) return;
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

  async function addToBulkGroup() {
    if (bulkGroup === 0 || selected.size === 0) return;
    setBulkBusy(true);
    try {
      const res = await fetch("/api/contacts/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactIds: [...selected], groupId: bulkGroup }),
      });
      if (res.ok) {
        setSelected(new Set());
        setBulkGroup(0);
        router.refresh();
      }
    } finally {
      setBulkBusy(false);
    }
  }

  function openEditor(c: Contact) {
    setEditFor(c.id);
    setEditSel(new Set((groupMap[c.id] ?? []).map((g) => g.id)));
  }

  async function toggleEditGroup(gid: number) {
    if (editFor == null) return;
    const next = new Set(editSel);
    if (next.has(gid)) next.delete(gid);
    else next.add(gid);
    setEditSel(next);
    await fetch("/api/contacts/groups", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId: editFor, groupIds: [...next] }),
    });
    router.refresh();
  }

  function chipClass(active: boolean) {
    return `rounded-full px-3 py-1 font-medium ${
      active
        ? "bg-slate-900 text-white"
        : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
    }`;
  }

  if (contacts.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-slate-500">
        Belum ada kontak. Tambahkan lewat form di atas.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {/* Filter grup */}
      <div className="flex flex-wrap gap-2 text-xs">
        <button onClick={() => setFilterGroup(0)} className={chipClass(filterGroup === 0)}>
          Semua ({contacts.length})
        </button>
        {groups.map((g) => (
          <button
            key={g.id}
            onClick={() => setFilterGroup(g.id)}
            className={chipClass(filterGroup === g.id)}
          >
            {g.name} ({g.member_count})
          </button>
        ))}
      </div>

      {/* Bilah aksi massal */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
          <span className="font-medium text-emerald-800">
            {selected.size} terpilih
          </span>
          <select
            value={bulkGroup}
            onChange={(e) => setBulkGroup(Number(e.target.value))}
            className="rounded-lg border border-emerald-300 bg-white px-2 py-1 text-xs text-slate-700 outline-none"
          >
            <option value={0}>Masukkan ke grup…</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <button
            onClick={addToBulkGroup}
            disabled={bulkGroup === 0 || bulkBusy}
            className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            {bulkBusy ? "Menyimpan…" : "Masukkan"}
          </button>
          <button
            onClick={() => removeMany([...selected])}
            disabled={bulkBusy}
            className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-40"
          >
            Hapus terpilih
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto text-xs text-slate-500 underline hover:text-slate-700"
          >
            Batal pilihan
          </button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
              <th className="py-2 pr-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Tandai semua"
                />
              </th>
              <th className="py-2 pr-4 font-medium">Nama</th>
              <th className="py-2 pr-4 font-medium">Nomor</th>
              <th className="py-2 pr-4 font-medium">Grup</th>
              <th className="py-2 pr-4 font-medium">WhatsApp</th>
              <th className="py-2 pr-4 font-medium">Ditambahkan</th>
              <th className="py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((c) => {
              const cg = groupMap[c.id] ?? [];
              return (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="py-2 pr-2">
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggleSelect(c.id)}
                      aria-label={`Tandai ${c.name || c.phone}`}
                    />
                  </td>
                  <td className="py-2 pr-4 text-slate-900">
                    {c.name || <span className="text-slate-400">—</span>}
                  </td>
                  <td className="py-2 pr-4 font-mono text-slate-600">{c.phone}</td>
                  <td className="py-2 pr-4">
                    <span className="flex flex-wrap items-center gap-1">
                      {cg.map((g) => (
                        <span
                          key={g.id}
                          className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                        >
                          {g.name}
                        </span>
                      ))}
                      <button
                        onClick={() =>
                          editFor === c.id ? setEditFor(null) : openEditor(c)
                        }
                        className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        aria-label="Atur grup"
                        title="Atur grup"
                      >
                        <Tags className="h-3.5 w-3.5" />
                      </button>
                      {editFor === c.id && (
                        <span className="relative">
                          <span className="absolute left-0 top-full z-10 mt-1 w-44 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
                            <span className="mb-1 flex items-center justify-between">
                              <span className="text-xs font-semibold text-slate-700">
                                Grup
                              </span>
                              <button
                                onClick={() => setEditFor(null)}
                                className="rounded p-0.5 text-slate-400 hover:text-slate-600"
                                aria-label="Tutup"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </span>
                            {groups.length === 0 && (
                              <span className="text-xs text-slate-400">
                                Belum ada grup — buat dulu di atas.
                              </span>
                            )}
                            {groups.map((g) => (
                              <label
                                key={g.id}
                                className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs text-slate-700 hover:bg-slate-50"
                              >
                                <input
                                  type="checkbox"
                                  checked={editSel.has(g.id)}
                                  onChange={() => toggleEditGroup(g.id)}
                                />
                                {g.name}
                              </label>
                            ))}
                          </span>
                        </span>
                      )}
                    </span>
                  </td>
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
                      onClick={() => removeOne(c.id)}
                      disabled={busyId === c.id}
                      className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                      aria-label="Hapus kontak"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="py-6 text-center text-sm text-slate-500">
            Tidak ada kontak di grup ini.
          </p>
        )}
      </div>
    </div>
  );
}
