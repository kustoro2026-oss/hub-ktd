"use client";

// Kelola template pesan Meta langsung dari Hub: daftar status review,
// buat template baru, hapus, dan ajukan ulang template yang ditolak.
import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Trash2, RotateCcw } from "lucide-react";
import type { WaTemplate } from "@/lib/wa";

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  APPROVED: { label: "Disetujui", cls: "bg-emerald-100 text-emerald-700" },
  PENDING: { label: "Menunggu review", cls: "bg-amber-100 text-amber-700" },
  REJECTED: { label: "Ditolak", cls: "bg-red-100 text-red-700" },
  PAUSED: { label: "Dijeda", cls: "bg-slate-100 text-slate-600" },
  DISABLED: { label: "Nonaktif", cls: "bg-slate-100 text-slate-600" },
};

const CATEGORY_LABEL: Record<string, string> = {
  MARKETING: "Marketing",
  UTILITY: "Utility",
  AUTHENTICATION: "Autentikasi",
};

export default function TemplateClient() {
  const [templates, setTemplates] = useState<WaTemplate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  // Form buat baru
  const [name, setName] = useState("");
  const [category, setCategory] = useState("MARKETING");
  const [body, setBody] = useState("");
  const [example, setExample] = useState("");
  const [creating, setCreating] = useState(false);

  // Form ajukan ulang (per baris yang DITOLAK)
  const [editId, setEditId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [editExample, setEditExample] = useState("");
  const [editing, setEditing] = useState(false);

  const check = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/wa/templates");
      const d = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        templates?: WaTemplate[];
        detail?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(d.error ?? "Gagal membaca template");
        setTemplates(null);
        return;
      }
      setTemplates(d.templates ?? []);
    } catch {
      setError("Jaringan bermasalah — coba lagi");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError("");
    setMsg("");
    try {
      const res = await fetch("/api/wa/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          category,
          language: "id",
          body,
          example: example.split(",").map((s) => s.trim()).filter(Boolean),
        }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        detail?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(d.error ?? "Gagal membuat template");
        return;
      }
      if (d.ok) {
        setMsg("Template dibuat — menunggu review Meta (bisa beberapa menit).");
        setName("");
        setBody("");
        setExample("");
        await check();
      } else {
        setError(d.detail ?? "Gagal membuat template");
      }
    } catch {
      setError("Jaringan bermasalah — coba lagi");
    } finally {
      setCreating(false);
    }
  }

  async function remove(t: WaTemplate) {
    if (!confirm(`Hapus template "${t.name}" dari Meta?`)) return;
    setError("");
    setMsg("");
    try {
      const res = await fetch("/api/wa/templates", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: t.name }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        detail?: string;
      };
      if (d.ok) {
        setMsg(`Template "${t.name}" dihapus.`);
        await check();
      } else {
        setError(d.detail ?? "Gagal menghapus template");
      }
    } catch {
      setError("Jaringan bermasalah — coba lagi");
    }
  }

  async function resubmit(id: string) {
    const text = editBody.trim();
    if (text.length < 1) {
      setError("Isi pesan tidak boleh kosong");
      return;
    }
    setEditing(true);
    setError("");
    setMsg("");
    try {
      const res = await fetch(`/api/wa/templates/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: text,
          example: editExample.split(",").map((s) => s.trim()).filter(Boolean),
        }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        detail?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(d.error ?? "Gagal mengajukan ulang");
        return;
      }
      if (d.ok) {
        setMsg("Template diajukan ulang — menunggu review Meta.");
        setEditId(null);
        await check();
      } else {
        setError(d.detail ?? "Gagal mengajukan ulang");
      }
    } catch {
      setError("Jaringan bermasalah — coba lagi");
    } finally {
      setEditing(false);
    }
  }

  const inputCls =
    "rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-emerald-500";

  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-slate-500">
          Daftar template dibaca langsung dari API Meta. Template berstatus{" "}
          <strong>Disetujui</strong> siap dipakai broadcast; yang ditolak bisa
          diperbaiki dan diajukan ulang di sini.
        </p>
        <button
          onClick={check}
          disabled={loading}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Membaca…" : "Cek ulang"}
        </button>
      </div>

      {msg && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          {msg}
        </p>
      )}
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      )}

      {/* Buat template baru */}
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Buat template baru
        </h3>
        <form onSubmit={create} className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nama (mis. promo_oktober)"
              maxLength={60}
              required
              className={`${inputCls} w-56`}
            />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={inputCls}
            >
              <option value="MARKETING">Marketing</option>
              <option value="UTILITY">Utility</option>
            </select>
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={'Isi pesan. Untuk data dinamis pakai {{1}}, contoh: "Halo {{1}}, ada promo untuk Anda."'}
            rows={3}
            required
            className={`${inputCls} w-full resize-y`}
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={example}
              onChange={(e) => setExample(e.target.value)}
              placeholder="Contoh nilai variabel (pisahkan koma)"
              className={`${inputCls} w-72`}
            />
            <button
              type="submit"
              disabled={creating}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              {creating ? "Membuat…" : "Buat template"}
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Nama: huruf kecil, angka, garis bawah — tanpa spasi. Template baru
            masuk antrean review Meta (biasanya beberapa menit).
          </p>
        </form>
      </div>

      {/* Daftar template */}
      {templates === null && !error && (
        <p className="text-sm text-slate-500">Membaca template…</p>
      )}
      {templates !== null && templates.length === 0 && (
        <p className="text-sm text-slate-500">Belum ada template di akun ini.</p>
      )}
      {templates !== null && templates.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-400">
                <th className="px-3 py-2.5 font-medium">Nama</th>
                <th className="px-3 py-2.5 font-medium">Kategori</th>
                <th className="px-3 py-2.5 font-medium">Bahasa</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {templates.map((t) => (
                <TableRows
                  key={t.id}
                  t={t}
                  editId={editId}
                  setEditId={setEditId}
                  editBody={editBody}
                  setEditBody={setEditBody}
                  editExample={editExample}
                  setEditExample={setEditExample}
                  editing={editing}
                  resubmit={resubmit}
                  remove={remove}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TableRows(props: {
  t: WaTemplate;
  editId: string | null;
  setEditId: (v: string | null) => void;
  editBody: string;
  setEditBody: (v: string) => void;
  editExample: string;
  setEditExample: (v: string) => void;
  editing: boolean;
  resubmit: (id: string) => Promise<void>;
  remove: (t: WaTemplate) => Promise<void>;
}) {
  const { t, editId, setEditId } = props;
  const badge = STATUS_BADGE[t.status] ?? {
    label: t.status,
    cls: "bg-slate-100 text-slate-600",
  };
  const open = editId === t.id;
  const inputCls =
    "rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-emerald-500";

  return (
    <>
      <tr className="align-top hover:bg-slate-50">
        <td className="px-3 py-2 font-mono text-slate-800">{t.name}</td>
        <td className="px-3 py-2 text-slate-600">
          {CATEGORY_LABEL[t.category] ?? t.category}
        </td>
        <td className="px-3 py-2 text-slate-600">{t.language}</td>
        <td className="px-3 py-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}>
            {badge.label}
          </span>
          {t.rejected_reason && (
            <p className="mt-1 text-xs text-red-500">{t.rejected_reason}</p>
          )}
        </td>
        <td className="px-3 py-2 text-right">
          <span className="flex items-center justify-end gap-1">
            {t.status === "REJECTED" && (
              <button
                onClick={() => {
                  if (open) setEditId(null);
                  else {
                    props.setEditBody("");
                    props.setEditExample("");
                    setEditId(t.id);
                  }
                }}
                className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
              >
                <RotateCcw className="h-3 w-3" />
                Ajukan ulang
              </button>
            )}
            <button
              onClick={() => props.remove(t)}
              className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
              aria-label={`Hapus template ${t.name}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </span>
        </td>
      </tr>
      {open && (
        <tr className="bg-slate-50">
          <td colSpan={5} className="px-3 py-2">
            <div className="space-y-2">
              <textarea
                value={props.editBody}
                onChange={(e) => props.setEditBody(e.target.value)}
                placeholder="Isi pesan yang diperbaiki (pakai {{1}} untuk variabel)"
                rows={3}
                className={`${inputCls} w-full resize-y`}
              />
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={props.editExample}
                  onChange={(e) => props.setEditExample(e.target.value)}
                  placeholder="Contoh nilai variabel (pisahkan koma)"
                  className={`${inputCls} w-72`}
                />
                <button
                  onClick={() => props.resubmit(t.id)}
                  disabled={props.editing}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
                >
                  {props.editing ? "Mengirim…" : "Kirim ke review"}
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
