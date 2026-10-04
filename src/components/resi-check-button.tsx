"use client";

// Tombol "Cek Pesanan Baru": menjalankan satu ronde pengecekan pesanan
// TikTok baru — pesanan yang belum pernah diproses resinya dibuatkan PDF
// dan dikirim ke WhatsApp pemilik toko. Hasil (jumlah terkirim/gagal)
// ditampilkan inline; pengecekan pertama berjalan mode baseline (tandai
// pesanan lama tanpa kirim resi).
import { useState } from "react";

type CheckResult = {
  ok?: boolean;
  baseline?: boolean;
  newOrders?: number;
  sent?: string[];
  errors?: string[];
  detail?: string;
};

export default function ResiCheckButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);

  async function check() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/tiktok/resi/check", { method: "POST" });
      const data = (await res.json()) as CheckResult;
      setResult(data);
    } catch {
      setResult({ ok: false, detail: "Gagal menghubungi server" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={check}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? (
          <>
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            Mengecek...
          </>
        ) : (
          "Cek Pesanan Baru"
        )}
      </button>

      {result ? (
        <div
          className={`max-w-sm rounded-lg border p-3 text-xs leading-relaxed ${
            result.ok === false
              ? "border-rose-200 bg-rose-50 text-rose-900"
              : result.errors && result.errors.length > 0
                ? "border-amber-200 bg-amber-50 text-amber-900"
                : "border-emerald-200 bg-emerald-50 text-emerald-900"
          }`}
        >
          {result.ok === false ? (
            <p>{result.detail ?? "Gagal mengecek pesanan"}</p>
          ) : (
            <>
              {result.baseline ? (
                <p>
                  Mode baseline: {result.newOrders ?? 0} pesanan lama ditandai
                  tanpa kirim resi. Resi otomatis berlaku mulai pesanan baru
                  berikutnya.
                </p>
              ) : result.newOrders ? (
                <p>
                  {result.sent?.length ?? 0} resi terkirim,{" "}
                  {result.errors?.length ?? 0} gagal.
                </p>
              ) : (
                <p>Tidak ada pesanan baru — semua resi sudah terkirim.</p>
              )}
              {result.errors && result.errors.length > 0 ? (
                <ul className="mt-1 list-inside list-disc">
                  {result.errors.slice(0, 5).map((e, i) => (
                    <li key={i} className="break-words">
                      {e}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
