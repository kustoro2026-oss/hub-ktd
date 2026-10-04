"use client";

// Buat kampanye broadcast: nama + template (dari daftar Meta yang sudah
// DISETUJUI) + sasaran (semua kontak atau satu grup). Setelah dibuat,
// pengiriman dijalankan dari halaman detail kampanye.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ContactGroup } from "@/lib/db";
import type { WaTemplate } from "@/lib/wa";

const STATUS_BADGE: Record<string, string> = {
  APPROVED: "Disetujui",
  PENDING: "Menunggu review",
  REJECTED: "Ditolak",
};

export default function BroadcastCreate({
  contactCount,
  groups,
}: {
  contactCount: number;
  groups: ContactGroup[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [templates, setTemplates] = useState<WaTemplate[] | null>(null);
  const [tplError, setTplError] = useState("");
  const [template, setTemplate] = useState("");
  const [target, setTarget] = useState<"all" | "group">("all");
  const [groupId, setGroupId] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/wa/templates");
        const d = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          templates?: WaTemplate[];
          detail?: string;
        };
        if (res.ok && d.ok) {
          const list = d.templates ?? [];
          setTemplates(list);
          const approved = list.filter((t) => t.status === "APPROVED");
          if (approved.length > 0) {
            const pref = approved.find((t) => t.name === "info_promo_v2");
            setTemplate((pref ?? approved[0]).name);
          }
        } else {
          setTplError(d.detail ?? "Gagal membaca template dari Meta");
        }
      } catch {
        setTplError("Tidak dapat terhubung ke server");
      }
    })();
  }, []);

  const approvedTemplates = (templates ?? []).filter(
    (t) => t.status === "APPROVED",
  );

  const selectedGroup = groups.find((g) => g.id === groupId);
  const recipients = target === "group" ? (selectedGroup?.member_count ?? 0) : contactCount;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!template) {
      setError("Belum ada template yang disetujui Meta");
      return;
    }
    if (target === "group" && groupId === 0) {
      setError("Pilih grup dulu");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/broadcasts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          template,
          groupId: target === "group" ? groupId : undefined,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { broadcast: { id: number } };
        router.push(`/broadcast/${data.broadcast.id}`);
        router.refresh();
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Gagal membuat kampanye");
      }
    } catch {
      setError("Tidak dapat terhubung ke server");
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500";

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            Nama kampanye
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Promo 4 Oktober"
            required
            className={inputCls}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            Template (disetujui Meta)
          </span>
          {templates === null && !tplError ? (
            <span className="block py-2 text-xs text-slate-400">
              Membaca template…
            </span>
          ) : (
            <select
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              required
              className={inputCls}
            >
              {approvedTemplates.length === 0 && (
                <option value="">Tidak ada template disetujui</option>
              )}
              {approvedTemplates.map((t) => (
                <option key={t.id} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </label>
      </div>

      {tplError && (
        <p className="text-xs text-red-600">{tplError}</p>
      )}
      {templates !== null && approvedTemplates.length === 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Belum ada template berstatus <strong>Disetujui</strong> — buat dulu
          di halaman Template dan tunggu review Meta.
        </p>
      )}

      <div>
        <span className="mb-1 block text-xs font-medium text-slate-600">
          Sasaran penerima
        </span>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input
              type="radio"
              checked={target === "all"}
              onChange={() => setTarget("all")}
            />
            Semua kontak ({contactCount})
          </label>
          {groups.length > 0 && (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                checked={target === "group"}
                onChange={() => setTarget("group")}
              />
              Grup
            </label>
          )}
          {target === "group" && (
            <select
              value={groupId}
              onChange={(e) => setGroupId(Number(e.target.value))}
              className={inputCls}
            >
              <option value={0}>Pilih grup…</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.member_count})
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={
            busy ||
            recipients === 0 ||
            !template ||
            (target === "group" && groupId === 0)
          }
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          title={recipients === 0 ? "Tambahkan kontak dulu" : undefined}
        >
          {busy ? "Membuat…" : `Buat (${recipients} penerima)`}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </form>
  );
}
