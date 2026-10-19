"use client";

// Panel Pengaturan SMTP Gmail — kredensial disimpan di database (bukan
// env) supaya akun Gmail bisa diganti-ganti langsung dari sini. Password
// tidak pernah ditampilkan kembali: input kosong = pertahankan yang lama.
import { useEffect, useState } from "react";

export default function EmailSmtpSettings() {
  const [loaded, setLoaded] = useState(false);
  const [hasPass, setHasPass] = useState(false);
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/email/settings");
        const d = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          user?: string;
          senderEmail?: string;
          hasPass?: boolean;
        };
        if (res.ok) {
          setUser(d.user ?? "");
          setSenderEmail(d.senderEmail ?? "");
          setHasPass(Boolean(d.hasPass));
        }
      } catch {
        // Gagal baca — form tetap tampil kosong.
      }
      setLoaded(true);
    })();
  }, []);

  async function save() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/email/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user, pass, senderEmail }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        detail?: string;
        error?: string;
      };
      if (res.ok) {
        setResult({ ok: true, text: d.detail ?? "Tersimpan" });
        setPass("");
        setHasPass(true);
      } else {
        setResult({ ok: false, text: d.error ?? "Gagal menyimpan" });
      }
    } catch {
      setResult({ ok: false, text: "Tidak dapat terhubung ke server" });
    }
    setBusy(false);
  }

  if (!loaded) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="h-20 animate-pulse rounded-lg bg-slate-100" />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">
          Pengaturan SMTP Gmail
        </h2>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            hasPass
              ? "bg-emerald-100 text-emerald-700"
              : "bg-amber-100 text-amber-700"
          }`}
        >
          {hasPass ? "Akun tersimpan" : "Belum diatur"}
        </span>
      </div>

      <p className="mb-3 text-xs text-slate-400">
        Kredensial disimpan di database, bukan env — ganti akun kapan saja
        tanpa redeploy. App Password dibuat di myaccount.google.com →
        Security → App passwords.
      </p>

      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <span className="mb-1 block text-xs font-medium text-slate-600">
            Alamat Gmail (SMTP)
          </span>
          <input
            type="email"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="nama@gmail.com"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium text-slate-600">
            App Password
          </span>
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder={
              hasPass ? "tersimpan — kosongkan bila tetap" : "16 karakter"
            }
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium text-slate-600">
            Alamat Pengirim (opsional)
          </span>
          <input
            type="email"
            value={senderEmail}
            onChange={(e) => setSenderEmail(e.target.value)}
            placeholder="default = alamat Gmail"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={save}
          disabled={busy || !user}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Menyimpan…" : "Simpan Pengaturan SMTP"}
        </button>
        {result && (
          <span
            className={`text-xs ${result.ok ? "text-emerald-700" : "text-red-600"}`}
          >
            {result.text}
          </span>
        )}
      </div>
    </div>
  );
}
