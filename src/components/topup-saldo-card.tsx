"use client";

// Kartu Saldo Digiflazz live — memanggil POST /api/topup/saldo (proxy aman
// ke API toko) saat mount, lalu tombol muat ulang. Perlu sesi admin.
// Menampilkan galat wajar bila rahasia/env belum terpasang.
import { useEffect, useState } from "react";

function fmtRp(n: number): string {
  return "Rp" + Math.round(n).toLocaleString("id-ID");
}

function jamWib(ms: number): string {
  const w = new Date(ms + 7 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(w.getUTCDate())}/${p(w.getUTCMonth() + 1)} ${p(w.getUTCHours())}:${p(
    w.getUTCMinutes(),
  )} WIB`;
}

type Hasil = {
  ok?: boolean;
  balance?: number;
  detail?: string;
  error?: string;
  at?: number;
  sumber?: string;
};

/** Panggil proxy saldo — galat jaringan dikembalikan sebagai hasil, bukan
 *  dilempar, supaya pemanggil (mount & tombol) cukup memakai hasilnya. */
async function ambilSaldo(): Promise<Hasil> {
  try {
    const res = await fetch("/api/topup/saldo", { method: "POST" });
    return (await res.json().catch(() => ({}))) as Hasil;
  } catch {
    return { ok: false, detail: "Gagal terhubung ke server." };
  }
}

export default function TopupSaldoCard({
  threshold,
  rataHarian,
}: {
  threshold: number;
  /** Rata-rata modal harian (7 hari) — dipakai untuk estimasi ketahanan. */
  rataHarian?: number;
}) {
  const [data, setData] = useState<Hasil | null>(null);
  const [busy, setBusy] = useState(false);

  async function muat() {
    setBusy(true);
    try {
      setData(await ambilSaldo());
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void ambilSaldo().then(setData);
  }, []);

  const rendah =
    typeof data?.balance === "number" && data.balance < threshold;
  const ketahanan =
    typeof data?.balance === "number" && rataHarian && rataHarian > 0
      ? Math.floor(data.balance / rataHarian)
      : null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Saldo Digiflazz
        </p>
        <button
          onClick={() => void muat()}
          disabled={busy}
          className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
        >
          {busy ? "Mengecek…" : "Cek Sekarang"}
        </button>
      </div>

      {data === null ? (
        <p className="mt-1 text-2xl font-bold text-slate-300">Memuat…</p>
      ) : typeof data.balance === "number" ? (
        <p
          className={`mt-1 text-2xl font-bold ${
            rendah ? "text-rose-700" : "text-emerald-700"
          }`}
        >
          {fmtRp(data.balance)}
        </p>
      ) : (
        <p className="mt-1 text-2xl font-bold text-slate-400">—</p>
      )}

      {data && typeof data.balance === "number" ? (
        <p className="mt-1 text-xs text-slate-500">
          {data.at ? `per ${jamWib(data.at)}` : ""}
          {ketahanan !== null
            ? ` · ±${ketahanan} hari ketahanan (rata-rata modal ${fmtRp(rataHarian!)}/hari)`
            : ""}
          {rendah
            ? ` · DI BAWAH ambang ${fmtRp(threshold)} — segera deposit!`
            : ""}
        </p>
      ) : null}
      {data && !data.ok ? (
        <p className="mt-1 text-xs text-rose-600">
          {data.detail ?? data.error ?? "Tidak bisa cek saldo."}
        </p>
      ) : null}
    </div>
  );
}
