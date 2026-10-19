"use client";

// Kelola template email marketing — disimpan di database KTD Hub sendiri
// (bukan dashboard Brevo) supaya variabel dan pratinjau konsisten dengan
// pola template WhatsApp. Satu template = nama + subjek + isi HTML.
// Variabel {{...}} di subjek/isi diisi saat kampanye dibuat; {{nama}} dan
// {{email}} otomatis terisi per penerima saat pengiriman.
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Pencil, Trash2, X } from "lucide-react";
import type { EmailTemplate } from "@/lib/db";

// Nilai contoh untuk pratinjau — {{nama}}/{{email}} diganti otomatis
// per penerima saat pengiriman, variabel lain diisi saat kampanye dibuat.
const SAMPLE: Record<string, string> = {
  nama: "Budi Santoso",
  email: "budi@gmail.com",
};

function detectedVars(text: string): string[] {
  return [
    ...new Set(
      [...text.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map(
        (m) => m[1],
      ),
    ),
  ];
}

function previewText(text: string): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k: string) => {
    const v = SAMPLE[k];
    return v ?? `(${k})`;
  });
}

export default function EmailTemplateClient() {
  const router = useRouter();
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  // Form buat baru
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [htmlBody, setHtmlBody] = useState("");
  const [creating, setCreating] = useState(false);

  // Form edit (per baris)
  const [editId, setEditId] = useState<number | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/email/templates");
      const d = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        templates?: EmailTemplate[];
        error?: string;
      };
      if (!res.ok) {
        setError(d.error ?? "Gagal membaca template");
        setTemplates([]);
        return;
      }
      setTemplates(d.templates ?? []);
    } catch {
      setError("Jaringan bermasalah — coba lagi");
    } finally {
      setLoading(false);
    }
  }, []);

  // Muat daftar saat pertama dibuka — komponen ini client-side murni
  // (pola template-client WA) sehingga daftar bisa direfresh tanpa pindah.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const newVars = detectedVars(`${subject} ${htmlBody}`);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError("");
    setMsg("");
    try {
      const res = await fetch("/api/email/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, subject, html_body: htmlBody }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setError(d.error ?? "Gagal membuat template");
        return;
      }
      setMsg(`Template "${name.trim()}" tersimpan — siap dipakai kampanye.`);
      setName("");
      setSubject("");
      setHtmlBody("");
      await refresh();
    } catch {
      setError("Jaringan bermasalah — coba lagi");
    } finally {
      setCreating(false);
    }
  }

  async function saveEdit(id: number) {
    if (!editSubject.trim() || !editBody.trim()) {
      setError("Subjek dan isi email wajib diisi");
      return;
    }
    setSaving(true);
    setError("");
    setMsg("");
    try {
      const res = await fetch("/api/email/templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, subject: editSubject, html_body: editBody }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(d.error ?? "Gagal menyimpan perubahan");
        return;
      }
      setEditId(null);
      await refresh();
    } catch {
      setError("Jaringan bermasalah — coba lagi");
    } finally {
      setSaving(false);
    }
  }

  async function remove(t: EmailTemplate) {
    if (!confirm(`Hapus template "${t.name}"? Kampanye yang sudah dibuat tetap menyimpan salinannya.`))
      return;
    setError("");
    setMsg("");
    try {
      const res = await fetch("/api/email/templates", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: t.id }),
      });
      if (res.ok) {
        setMsg(`Template "${t.name}" dihapus.`);
        await refresh();
      } else {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? "Gagal menghapus template");
      }
    } catch {
      setError("Jaringan bermasalah — coba lagi");
    }
  }

  const inputCls =
    "rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-emerald-500";

  return (
    <div className="space-y-4 text-sm">
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
            Panduan singkat — variabel & pratinjau
          </summary>
          <ul className="mt-2 list-disc space-y-1.5 pl-4">
            <li>
              <strong>Variabel:</strong> tulis <code>{"{{namaVariabel}}"}</code>{" "}
              di subjek atau isi — mis. <code>{"{{link}}"}</code> untuk link
              produk. Nilainya diisi saat membuat kampanye.
            </li>
            <li>
              <strong>Variabel khusus:</strong> <code>{"{{nama}}"}</code> dan{" "}
              <code>{"{{email}}"}</code> otomatis terisi per penerima saat
              pengiriman — tidak perlu diisi manual.
            </li>
            <li>
              <strong>Isi HTML:</strong> bisa memakai tag sederhana seperti{" "}
              <code>&lt;b&gt;</code>, <code>&lt;p&gt;</code>, <code>&lt;a&gt;</code>,
              atau teks polos. Footer berhenti berlangganan otomatis
              ditambahkan di bawah isi setiap email.
            </li>
          </ul>
        </details>

        <form onSubmit={create} className="space-y-2.5">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                Nama template (internal)
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="promo_november"
                maxLength={60}
                required
                className={`${inputCls} w-64`}
              />
            </label>
            <label className="block min-w-64 flex-1">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                Subjek email
              </span>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Promo Spesial KTD Store — Diskon 20%"
                maxLength={300}
                required
                className={`${inputCls} w-full`}
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              Isi email (HTML)
            </span>
            <textarea
              value={htmlBody}
              onChange={(e) => setHtmlBody(e.target.value)}
              placeholder={
                'Halo {{nama}},\n\nAda promo terbaru dari KTD Store!\nLihat di sini: {{link}}'
              }
              rows={6}
              required
              className={`${inputCls} w-full resize-y font-mono`}
            />
            {newVars.length > 0 ? (
              <span className="mt-1 block text-xs text-emerald-700">
                Variabel terdeteksi: {newVars.map((v) => `{{${v}}}`).join(", ")}{" "}
                — nilainya diisi saat membuat kampanye.
              </span>
            ) : (
              <span className="mt-1 block text-xs text-slate-400">
                Tanpa variabel — email dikirim persis seperti ini. Untuk link
                yang bisa diganti tiap kampanye, pakai variabel (lihat
                panduan).
              </span>
            )}
          </label>

          {htmlBody.trim() && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="mb-1 text-xs font-medium text-slate-600">
                Pratinjau (variabel diganti contoh)
              </p>
              <p className="whitespace-pre-wrap text-sm text-slate-800">
                {previewText(htmlBody)}
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={creating}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            {creating ? "Menyimpan…" : "Buat template"}
          </button>
        </form>
      </div>

      {/* Daftar template */}
      {loading ? (
        <p className="text-sm text-slate-500">Membaca template…</p>
      ) : templates.length === 0 ? (
        <p className="text-sm text-slate-500">
          Belum ada template — buat dulu di atas.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-400">
                <th className="px-3 py-2.5 font-medium">Nama</th>
                <th className="px-3 py-2.5 font-medium">Subjek</th>
                <th className="px-3 py-2.5 font-medium">Variabel</th>
                <th className="px-3 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {templates.map((t) => {
                const vars = detectedVars(`${t.subject} ${t.html_body}`);
                const open = editId === t.id;
                return (
                  <TemplateRow
                    key={t.id}
                    t={t}
                    vars={vars}
                    open={open}
                    editSubject={editSubject}
                    setEditSubject={setEditSubject}
                    editBody={editBody}
                    setEditBody={setEditBody}
                    saving={saving}
                    onOpen={() => {
                      setEditId(open ? null : t.id);
                      setEditSubject(t.subject);
                      setEditBody(t.html_body);
                    }}
                    onSave={() => saveEdit(t.id)}
                    onRemove={() => remove(t)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TemplateRow(props: {
  t: EmailTemplate;
  vars: string[];
  open: boolean;
  editSubject: string;
  setEditSubject: (v: string) => void;
  editBody: string;
  setEditBody: (v: string) => void;
  saving: boolean;
  onOpen: () => void;
  onSave: () => void;
  onRemove: () => void;
}) {
  const { t, vars, open } = props;
  const inputCls =
    "rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-emerald-500";

  return (
    <>
      <tr className="align-top hover:bg-slate-50">
        <td className="px-3 py-2 font-medium text-slate-800">{t.name}</td>
        <td className="px-3 py-2 text-slate-600">{t.subject}</td>
        <td className="px-3 py-2">
          {vars.length > 0 ? (
            <span className="flex flex-wrap gap-1">
              {vars.map((v) => (
                <span
                  key={v}
                  className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600"
                >
                  {`{{${v}}}`}
                </span>
              ))}
            </span>
          ) : (
            <span className="text-xs text-slate-400">—</span>
          )}
        </td>
        <td className="px-3 py-2 text-right">
          <span className="flex items-center justify-end gap-1">
            <button
              onClick={props.onOpen}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label={`Edit template ${t.name}`}
            >
              {open ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
            </button>
            <button
              onClick={props.onRemove}
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
          <td colSpan={4} className="px-3 py-2">
            <div className="space-y-2">
              <input
                value={props.editSubject}
                onChange={(e) => props.setEditSubject(e.target.value)}
                placeholder="Subjek email"
                maxLength={300}
                className={`${inputCls} w-full`}
              />
              <textarea
                value={props.editBody}
                onChange={(e) => props.setEditBody(e.target.value)}
                placeholder="Isi email (HTML)"
                rows={5}
                className={`${inputCls} w-full resize-y font-mono`}
              />
              <button
                onClick={props.onSave}
                disabled={props.saving}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
              >
                {props.saving ? "Menyimpan…" : "Simpan perubahan"}
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
