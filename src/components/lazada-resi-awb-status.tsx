"use client";

// Status cetak AWB otomatis per pesanan Lazada — pekerjaan dikerjakan
// engine jembatan yang berjalan di dalam browser Seller Center yang login
// (sesi web terikat sidik-jari browser sehingga tidak bisa dicetak dari
// server). Menampilkan status pekerjaan + detak engine, plus tombol pemicu
// cetak bila belum antre / gagal.
import { useCallback, useEffect, useState } from "react";

type AwbStatus = {
  job: {
    status: string;
    attempts: number;
    error: string;
    updated_at: string;
  } | null;
  bridge: { online: boolean; heartbeat_at: string; status: string };
  ada_label: boolean;
};

export default function LazadaResiAwbStatus({
  orderId,
}: {
  orderId: string;
}) {
  const [st, setSt] = useState<AwbStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState("");

  const muat = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/lazada/awb/status?order_id=${encodeURIComponent(orderId)}`,
        { cache: "no-store" },
      );
      if (res.ok) {
        const data = (await res.json()) as AwbStatus;
        setSt(data);
      }
    } catch {
      // status tidak kritis — abaikan kegagalan jaringan.
    }
  }, [orderId]);

  useEffect(() => {
    void muat();
    const id = setInterval(() => void muat(), 15000);
    return () => clearInterval(id);
  }, [muat]);

  async function pinta() {
    setBusy(true);
    setDetail("");
    try {
      const res = await fetch("/api/lazada/awb/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: orderId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        detail?: string;
        error?: string;
      };
      if (res.ok && data.ok) {
        setDetail(data.detail ?? "diantrekan");
        await muat();
      } else {
        setDetail(data.error ?? data.detail ?? `HTTP ${res.status}`);
      }
    } catch {
      setDetail("tidak dapat menghubungi server");
    } finally {
      setBusy(false);
    }
  }

  const jobStatus = st?.job?.status ?? null;

  // Label resmi sudah ada (unggahan/API/AWB) — tidak perlu tombol.
  if (st?.ada_label) {
    return (
      <span
        className="text-xs font-medium text-emerald-700"
        title="Label resmi sudah tersimpan — Cetak Resi memakai dokumen asli"
      >
        Label resmi ✓
      </span>
    );
  }

  if (jobStatus === "pending") {
    return (
      <div className="max-w-48">
        <span
          className="text-xs font-medium text-amber-700"
          title={
            st?.bridge.online
              ? "Menunggu engine browser mencetak AWB (dicek tiap ±20 detik)"
              : "Browser Seller Center sedang offline — buka halaman Seller Center agar AWB dicetak otomatis"
          }
        >
          {st?.bridge.online ? "AWB: menunggu browser…" : "AWB: browser offline!"}
        </span>
        {detail ? (
          <p className="mt-0.5 break-words text-xs leading-snug text-amber-700/90">
            {detail}
          </p>
        ) : null}
      </div>
    );
  }

  if (jobStatus === "gagal") {
    return (
      <div className="max-w-48">
        <span className="text-xs font-medium text-rose-700">
          AWB gagal ({st?.job?.attempts ?? 0}x)
        </span>
        {st?.job?.error ? (
          <p
            className="mt-0.5 break-words text-xs leading-snug text-rose-600/90"
            title={st.job.error}
          >
            {st.job.error.slice(0, 110)}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => void pinta()}
          disabled={busy}
          className="mt-1 rounded-lg border border-rose-300 px-2 py-1 text-xs font-medium text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
        >
          {busy ? "Mengantrekan..." : "Cetak Ulang"}
        </button>
        {detail ? (
          <p className="mt-0.5 break-words text-xs leading-snug text-slate-600">
            {detail}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void pinta()}
      disabled={busy}
      title="Cetak AWB resmi otomatis lewat browser Seller Center yang login"
      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-500 hover:bg-slate-50 disabled:opacity-60"
    >
      {busy ? "Mengantrekan..." : "Cetak AWB"}
    </button>
  );
}
