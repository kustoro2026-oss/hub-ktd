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

const LANG_LABEL: Record<string, string> = {
  id: "Indonesia",
  en: "Inggris",
  en_US: "Inggris (AS)",
  en_GB: "Inggris (Inggris)",
  ms: "Melayu",
  ar: "Arab",
  zh_CN: "Mandarin",
};

const LANG_OPTIONS = Object.keys(LANG_LABEL);

export default function TemplateClient() {
  const [templates, setTemplates] = useState<WaTemplate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  // Form buat baru
  const [name, setName] = useState("");
  const [category, setCategory] = useState("MARKETING");
  const [language, setLanguage] = useState("id");
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
          language,
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

  // Variabel {{1}}, {{2}} … yang dipakai di isi pesan (untuk hint).
  const varNumbers = [
    ...new Set(
      [...body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1])),
    ),
  ].sort((a, b) => a - b);

  const exampleCount = example
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean).length;

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

        <details className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          <summary className="cursor-pointer font-medium text-slate-700">
            Panduan singkat — cara membuat & arti tiap kolom
          </summary>
          <ol className="mt-2 list-decimal space-y-1.5 pl-4">
            <li>
              <strong>Apa itu template?</strong> Pesan standar yang harus
              disetujui Meta dulu sebelum bisa dikirim ke banyak nomor
              (broadcast). Tanpa template, nomor bot tidak boleh mengirim pesan
              promosi ke pelanggan yang belum pernah chat.
            </li>
            <li>
              <strong>Alur:</strong> isi form → Buat template → status{" "}
              <em>Menunggu review</em> → <em>Disetujui</em> (langsung bisa
              dipakai broadcast) atau <em>Ditolak</em> (lihat alasan, perbaiki,
              klik Ajukan ulang).
            </li>
            <li>
              <strong>Nama:</strong> identitas internal, tidak terlihat
              pelanggan. Huruf kecil, angka, garis bawah — tanpa spasi (mis.{" "}
              <code>promo_oktober</code>).
            </li>
            <li>
              <strong>Kategori:</strong> <em>Marketing</em> untuk promosi /
              penawaran; <em>Utility</em> untuk notifikasi transaksi (konfirmasi
              pesanan, resi, dsb).
            </li>
            <li>
              <strong>Bahasa:</strong> bahasa isi pesan — review Meta mengikuti
              bahasa ini (default Indonesia).
            </li>
            <li>
              <strong>Variabel {"{{1}}"}:</strong> penanda data dinamis
              yang diganti saat pesan dikirim, mis. nama penerima ({" "}
              <code>Halo {"{{1}}"}, ada promo untuk Anda.</code>). Untuk
              sekarang broadcast di Hub mengirim template apa adanya tanpa
              mengisi nilai variabel, jadi pakai teks tetap tanpa{" "}
              <code>{"{{1}}"}</code> dulu — template bervariabel akan
              gagal dikirim dari broadcast.
            </li>
            <li>
              <strong>Contoh nilai variabel:</strong> Meta wajib melihat contoh
              saat template memakai variabel — isi sesuai urutan{" "}
              <code>{"{{1}}"}</code>, <code>{"{{2}}"}</code>{" "}
              dipisah koma (mis. <code>Budi, Diskon 20%</code>). Kosongkan
              kalau pesan tidak memakai variabel.
            </li>
          </ol>
        </details>

        <form onSubmit={create} className="space-y-2.5">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              Nama template (internal — tidak terlihat pelanggan)
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="promo_oktober"
              maxLength={60}
              required
              className={`${inputCls} w-64`}
            />
            <span className="mt-1 block text-xs text-slate-400">
              Huruf kecil, angka, garis bawah — tanpa spasi.
            </span>
          </label>

          <div className="flex flex-wrap gap-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                Kategori
              </span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={inputCls}
              >
                <option value="MARKETING">Marketing — promosi / penawaran</option>
                <option value="UTILITY">Utility — notifikasi transaksi</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                Bahasa
              </span>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className={inputCls}
              >
                {LANG_OPTIONS.map((code) => (
                  <option key={code} value={code}>
                    {LANG_LABEL[code]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              Isi pesan
            </span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={'Contoh: "Halo, ada promo terbaru dari KTD Store. Klik untuk lihat katalog."'}
              rows={3}
              required
              className={`${inputCls} w-full resize-y`}
            />
            {varNumbers.length > 0 ? (
              <span className="mt-1 block text-xs text-amber-700">
                Variabel terdeteksi:{" "}
                {varNumbers.map((n) => `{{${n}}}`).join(", ")} — isi contoh
                nilainya di bawah, atau hapus variabelnya (lihat panduan).
              </span>
            ) : (
              <span className="mt-1 block text-xs text-slate-400">
                Tanpa variabel — teks tetap seperti ini yang disarankan untuk
                broadcast.
              </span>
            )}
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              Contoh nilai variabel (hanya kalau pesan memakai variabel)
            </span>
            <input
              value={example}
              onChange={(e) => setExample(e.target.value)}
              placeholder="Budi, Diskon 20% — urut sesuai {{1}}, {{2}}, pisahkan koma"
              className={`${inputCls} w-full max-w-md`}
            />
            {varNumbers.length > 0 && exampleCount < Math.max(...varNumbers) && (
              <span className="mt-1 block text-xs text-red-600">
                Kurang — butuh minimal {Math.max(...varNumbers)} nilai (terdeteksi{" "}
                {varNumbers.length} variabel).
              </span>
            )}
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={creating}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              {creating ? "Membuat…" : "Buat template"}
            </button>
            <p className="text-xs text-slate-500">
              Template baru masuk antrean review Meta (biasanya beberapa menit).
            </p>
          </div>
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
        <td className="px-3 py-2 text-slate-600">
          {LANG_LABEL[t.language] ?? t.language}
        </td>
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
