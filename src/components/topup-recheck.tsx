"use client";

// Tombol "Cek Ulang Pending" + panel hasil — memanggil POST /api/topup/recheck
// (proxy aman ke cron pending toko, idempoten). Perlu sesi admin.
import { useState } from "react";

type Hasil = {
  ok?: boolean;
  expired?: number;
  rechecked?: number;
  results?: { id?: string; ref_id?: string; status?: string; detail?: string }[];
  detail?: string;
  error?: string;
};

export default function TopupRecheck({ label = "Cek Ulang Pending" }: { label?: string }) {
  const [busy, setBusy] = useState(false);
  const [hasil, setHasil] = useState<Hasil | null>(null);

  async function klik() {
    setBusy(true);
    setHasil(null);
    try {
      const res = await fetch("/api/topup/recheck", { method: "POST" });
      const d = (await res.json().catch(() => ({}))) as Hasil;
      setHasil(d);
    } catch {
      setHasil({ ok: false, detail: "Gagal terhubung ke server." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        onClick={() => void klik()}
        disabled={busy}
        className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-800 disabled:opacity-60"
      >
        {busy ? "Menjalankan…" : label}
      </button>

      {hasil && !hasil.ok ? (
        <p className="text-sm text-rose-700">
          {hasil.detail ?? hasil.error ?? "Gagal menjalankan cek ulang."}
        </p>
      ) : null}

      {hasil && hasil.ok ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
          <p className="font-medium text-slate-900">
            Selesai — {hasil.expired ?? 0} kedaluwarsa ditandai ·{" "}
            {hasil.rechecked ?? 0} pending dicek ulang.
          </p>
          {(hasil.results?.length ?? 0) > 0 ? (
            <ul className="mt-2 space-y-1">
              {hasil.results!.map((r, i) => (
                <li key={i} className="text-xs text-slate-600">
                  <span className="font-medium text-slate-800">
                    {r.ref_id ?? r.id ?? `#${i + 1}`}
                  </span>{" "}
                  — {r.status ?? "?"}
                  {r.detail ? ` · ${r.detail}` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-slate-500">
              Tidak ada transaksi pending yang perlu dicek.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
