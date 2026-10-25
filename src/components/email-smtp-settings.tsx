"use client";

// Pengaturan multi-akun SMTP email marketing.
//
// Setiap akun punya aturan kirim sendiri: ukuran batch, jeda antar batch,
// jeda antar email, dan batas harian. Kampanye memilih satu akun dan mesin
// kirim mengikuti aturan akun tersebut. Password tidak pernah ditampilkan
// kembali — input kosong saat mengedit berarti pertahankan yang lama.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, X, PlugZap, Power } from "lucide-react";
import type { EmailSmtpAccount } from "@/lib/db";

type Account = EmailSmtpAccount & {
  sentToday?: number;
  activeCampaigns?: number;
};

type FormState = {
  name: string;
  host: string;
  port: number;
  secure: number;
  username: string;
  password: string;
  sender_email: string;
  sender_name: string;
  batch_size: number;
  batch_pause_seconds: number;
  delay_ms: number;
  daily_limit: number;
  active: number;
  imap_host: string;
  imap_port: number;
  imap_secure: number;
};

const EMPTY: FormState = {
  name: "",
  host: "",
  port: 465,
  secure: 1,
  username: "",
  password: "",
  sender_email: "",
  sender_name: "KTD Store",
  batch_size: 40,
  batch_pause_seconds: 60,
  delay_ms: 1000,
  daily_limit: 400,
  active: 1,
  imap_host: "",
  imap_port: 993,
  imap_secure: 1,
};

const PRESETS: Record<
  string,
  Pick<
    FormState,
    | "host"
    | "port"
    | "secure"
    | "batch_size"
    | "batch_pause_seconds"
    | "delay_ms"
    | "daily_limit"
    | "imap_host"
    | "imap_port"
    | "imap_secure"
  >
> = {
  Gmail: {
    host: "smtp.gmail.com",
    port: 465,
    secure: 1,
    batch_size: 40,
    batch_pause_seconds: 60,
    delay_ms: 1000,
    daily_limit: 400,
    imap_host: "imap.gmail.com",
    imap_port: 993,
    imap_secure: 1,
  },
  Outlook: {
    host: "smtp-mail.outlook.com",
    port: 587,
    secure: 0,
    batch_size: 30,
    batch_pause_seconds: 60,
    delay_ms: 1000,
    daily_limit: 300,
    imap_host: "outlook.office365.com",
    imap_port: 993,
    imap_secure: 1,
  },
  "SMTP kustom": {
    host: "",
    port: 587,
    secure: 0,
    batch_size: 40,
    batch_pause_seconds: 60,
    delay_ms: 1000,
    daily_limit: 400,
    imap_host: "",
    imap_port: 993,
    imap_secure: 1,
  },
};

const inputCls =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">
        {label}
      </span>
      {children}
      {hint && <span className="mt-0.5 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

export default function EmailSmtpSettings() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/email/smtp");
      const d = (await res.json().catch(() => ({}))) as {
        accounts?: Account[];
      };
      if (res.ok) setAccounts(d.accounts ?? []);
    } catch {
      // daftar gagal dibaca — biarkan kosong, form tetap bisa dipakai
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function patch(p: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...p }));
  }

  function openNew() {
    setEditing("new");
    setForm({ ...EMPTY });
    setResult(null);
  }

  function openEdit(a: Account) {
    setEditing(a.id);
    setForm({
      name: a.name,
      host: a.host,
      port: a.port,
      secure: a.secure,
      username: a.username,
      password: "",
      sender_email: a.sender_email,
      sender_name: a.sender_name,
      batch_size: a.batch_size,
      batch_pause_seconds: a.batch_pause_seconds,
      delay_ms: a.delay_ms,
      daily_limit: a.daily_limit,
      active: a.active,
      imap_host: a.imap_host,
      imap_port: a.imap_port,
      imap_secure: a.imap_secure,
    });
    setResult(null);
  }

  async function testConnection() {
    setTesting(true);
    setResult(null);
    try {
      const res = await fetch("/api/email/smtp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          id: editing !== "new" && editing ? editing : undefined,
        }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      setResult({
        ok: Boolean(d.ok),
        text: d.ok
          ? "Koneksi & login SMTP berhasil"
          : d.error ?? "Koneksi gagal",
      });
    } catch {
      setResult({ ok: false, text: "Tidak dapat terhubung ke server" });
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    setBusy(true);
    setResult(null);
    try {
      const isNew = editing === "new";
      const res = await fetch(
        isNew ? "/api/email/smtp" : `/api/email/smtp/${editing}`,
        {
          method: isNew ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        },
      );
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setResult({ ok: false, text: d.error ?? "Gagal menyimpan akun" });
        return;
      }
      setEditing(null);
      setForm(EMPTY);
      await load();
      router.refresh();
    } catch {
      setResult({ ok: false, text: "Tidak dapat terhubung ke server" });
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(a: Account) {
    setBusy(true);
    try {
      await fetch(`/api/email/smtp/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: a.active ? 0 : 1 }),
      });
      await load();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(a: Account) {
    if (
      !confirm(
        `Hapus akun SMTP "${a.name}"? Kredensial dihapus permanen; riwayat kampanye tetap tersimpan.`,
      )
    )
      return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`/api/email/smtp/${a.id}`, { method: "DELETE" });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setResult({ ok: false, text: d.error ?? "Gagal menghapus akun" });
        return;
      }
      await load();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="h-20 animate-pulse rounded-lg bg-slate-100" />
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Akun SMTP ({accounts.length})
          </h2>
          <p className="text-xs text-slate-500">
            Satu kampanye memakai satu akun. Aturan kirim tiap akun dipatuhi
            otomatis oleh mesin kirim.
          </p>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
        >
          <Plus className="h-4 w-4" /> Tambah akun
        </button>
      </div>

      {accounts.length === 0 ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Belum ada akun SMTP. Tambahkan minimal satu akun sebelum membuat
          kampanye.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {accounts.map((a) => {
            const limit = a.daily_limit || 0;
            const used = a.sentToday ?? 0;
            const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
            return (
              <div
                key={a.id}
                className={`rounded-lg border p-3 ${
                  a.active
                    ? "border-slate-200"
                    : "border-slate-200 bg-slate-50 opacity-75"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-slate-900">
                        {a.name}
                      </span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                          a.active
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-200 text-slate-600"
                        }`}
                      >
                        {a.active ? "Aktif" : "Nonaktif"}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate font-mono text-xs text-slate-500">
                      {a.username} · {a.host}:{a.port}
                      {a.secure ? " SSL" : " STARTTLS"}
                    </div>
                    <div className="truncate text-xs text-slate-400">
                      Pengirim: {a.sender_name} &lt;{a.sender_email || a.username}&gt;
                    </div>
                    <div className="truncate text-xs text-slate-400">
                      {a.imap_host
                        ? `IMAP: ${a.imap_host}:${a.imap_port}`
                        : "IMAP: tidak dipantau"}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => openEdit(a)}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      title="Edit akun"
                      aria-label={`Edit ${a.name}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => toggleActive(a)}
                      disabled={busy}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
                      title={a.active ? "Nonaktifkan" : "Aktifkan"}
                      aria-label={a.active ? "Nonaktifkan akun" : "Aktifkan akun"}
                    >
                      <Power className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => remove(a)}
                      disabled={busy}
                      className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                      title="Hapus akun"
                      aria-label={`Hapus ${a.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-slate-500">
                  <span>
                    Batch: <strong>{a.batch_size}</strong> email
                  </span>
                  <span>
                    Jeda batch: <strong>{a.batch_pause_seconds}s</strong>
                  </span>
                  <span>
                    Jeda antar email: <strong>{a.delay_ms}ms</strong>
                  </span>
                  <span>
                    Kampanye aktif: <strong>{a.activeCampaigns ?? 0}</strong>
                  </span>
                </div>

                <div className="mt-2">
                  <div className="flex justify-between text-[11px] text-slate-500">
                    <span>Hari ini</span>
                    <span>
                      {used}
                      {limit > 0 ? ` / ${limit}` : " (tanpa batas)"}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full ${
                        pct >= 100 ? "bg-red-500" : "bg-emerald-500"
                      }`}
                      style={{ width: `${limit > 0 ? pct : 0}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing !== null && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              {editing === "new" ? "Akun SMTP baru" : "Edit akun SMTP"}
            </h3>
            <button
              onClick={() => {
                setEditing(null);
                setResult(null);
              }}
              className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-600"
              aria-label="Tutup form"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500">Preset:</span>
            {Object.keys(PRESETS).map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => patch(PRESETS[name])}
                className="rounded-full bg-white px-2.5 py-1 font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
              >
                {name}
              </button>
            ))}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Nama akun">
              <input
                value={form.name}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder="Gmail Utama"
                className={inputCls}
              />
            </Field>
            <Field label="Host SMTP">
              <input
                value={form.host}
                onChange={(e) => patch({ host: e.target.value })}
                placeholder="smtp.gmail.com"
                className={inputCls}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Port">
                <input
                  type="number"
                  value={form.port}
                  onChange={(e) => patch({ port: Number(e.target.value) })}
                  className={inputCls}
                />
              </Field>
              <Field label="Keamanan">
                <select
                  value={form.secure}
                  onChange={(e) => patch({ secure: Number(e.target.value) })}
                  className={inputCls}
                >
                  <option value={1}>SSL (465)</option>
                  <option value={0}>STARTTLS (587)</option>
                </select>
              </Field>
            </div>
            <Field label="Username / email login">
              <input
                value={form.username}
                onChange={(e) => patch({ username: e.target.value })}
                placeholder="nama@gmail.com"
                autoComplete="username"
                className={inputCls}
              />
            </Field>
            <Field
              label="Password / App Password"
              hint={
                editing === "new"
                  ? "Gmail: buat App Password 16 karakter"
                  : "Kosongkan bila tidak diubah"
              }
            >
              <input
                type="password"
                value={form.password}
                onChange={(e) => patch({ password: e.target.value })}
                placeholder={editing === "new" ? "16 karakter" : "tersimpan"}
                autoComplete="new-password"
                className={inputCls}
              />
            </Field>
            <Field label="Email pengirim">
              <input
                type="email"
                value={form.sender_email}
                onChange={(e) => patch({ sender_email: e.target.value })}
                placeholder="default = username"
                className={inputCls}
              />
            </Field>
            <Field label="Nama pengirim">
              <input
                value={form.sender_name}
                onChange={(e) => patch({ sender_name: e.target.value })}
                placeholder="KTD Store"
                className={inputCls}
              />
            </Field>
            <Field label="Ukuran batch" hint="Email per batch sebelum jeda">
              <input
                type="number"
                min={1}
                value={form.batch_size}
                onChange={(e) => patch({ batch_size: Number(e.target.value) })}
                className={inputCls}
              />
            </Field>
            <Field label="Jeda antar batch (detik)">
              <input
                type="number"
                min={0}
                value={form.batch_pause_seconds}
                onChange={(e) =>
                  patch({ batch_pause_seconds: Number(e.target.value) })
                }
                className={inputCls}
              />
            </Field>
            <Field label="Jeda antar email (ms)">
              <input
                type="number"
                min={0}
                step={100}
                value={form.delay_ms}
                onChange={(e) => patch({ delay_ms: Number(e.target.value) })}
                className={inputCls}
              />
            </Field>
            <Field label="Batas harian" hint="0 = tanpa batas">
              <input
                type="number"
                min={0}
                value={form.daily_limit}
                onChange={(e) => patch({ daily_limit: Number(e.target.value) })}
                className={inputCls}
              />
            </Field>
            <Field
              label="IMAP host (pantau bounce)"
              hint="kosongkan = inbox tidak dipindai"
            >
              <input
                value={form.imap_host}
                onChange={(e) => patch({ imap_host: e.target.value.trim() })}
                placeholder="imap.gmail.com"
                className={inputCls}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="IMAP port">
                <input
                  type="number"
                  value={form.imap_port}
                  onChange={(e) => patch({ imap_port: Number(e.target.value) })}
                  className={inputCls}
                />
              </Field>
              <Field label="IMAP keamanan">
                <select
                  value={form.imap_secure}
                  onChange={(e) =>
                    patch({ imap_secure: Number(e.target.value) })
                  }
                  className={inputCls}
                >
                  <option value={1}>SSL (993)</option>
                  <option value={0}>STARTTLS (143)</option>
                </select>
              </Field>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={save}
              disabled={busy || !form.name || !form.host || !form.username}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {busy ? "Menyimpan…" : "Simpan akun"}
            </button>
            <button
              onClick={testConnection}
              disabled={testing || !form.host || !form.username}
              className="flex items-center gap-1.5 rounded-lg border border-emerald-600 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
            >
              <PlugZap className="h-4 w-4" />
              {testing ? "Menguji…" : "Tes koneksi"}
            </button>
            {result && (
              <span
                className={`text-xs ${
                  result.ok ? "text-emerald-700" : "text-red-600"
                }`}
              >
                {result.text}
              </span>
            )}
          </div>
        </div>
      )}

      {result && editing === null && (
        <p className={`text-xs ${result.ok ? "text-emerald-700" : "text-red-600"}`}>
          {result.text}
        </p>
      )}
    </div>
  );
}
