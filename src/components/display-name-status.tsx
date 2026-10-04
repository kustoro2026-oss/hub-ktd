"use client";

// Status nama tampilan nomor API dibaca langsung dari Graph Meta — berguna
// saat UI WhatsApp Manager tidak sinkron (nama lama tetap tampil padahal
// pengajuan sudah masuk review). Tampil di halaman Pengaturan.
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

type StatusData = {
  ok: boolean;
  verifiedName?: string;
  nameStatus?: string;
  newDisplayName?: string;
  newNameStatus?: string;
  qualityRating?: string;
  messagingLimit?: string;
  detail?: string;
};

const NAME_LABELS: Record<string, { label: string; cls: string }> = {
  APPROVED: { label: "Disetujui", cls: "bg-emerald-100 text-emerald-700" },
  PENDING_REVIEW: { label: "Sedang ditinjau", cls: "bg-amber-100 text-amber-700" },
  PENDING: { label: "Menunggu", cls: "bg-amber-100 text-amber-700" },
  DECLINED: { label: "Ditolak", cls: "bg-red-100 text-red-700" },
  REJECTED: { label: "Ditolak", cls: "bg-red-100 text-red-700" },
  EXPIRED: { label: "Kedaluwarsa", cls: "bg-slate-100 text-slate-600" },
  AVAILABLE_WITHOUT_REVIEW: {
    label: "Tersedia tanpa review",
    cls: "bg-emerald-100 text-emerald-700",
  },
  NONE: { label: "Belum ada", cls: "bg-slate-100 text-slate-600" },
};

const QUALITY_LABELS: Record<string, { label: string; cls: string }> = {
  GREEN: { label: "Baik", cls: "bg-emerald-100 text-emerald-700" },
  YELLOW: { label: "Menurun", cls: "bg-amber-100 text-amber-700" },
  RED: { label: "Buruk", cls: "bg-red-100 text-red-700" },
};

function nameBadge(status?: string) {
  if (!status) return null;
  const m = NAME_LABELS[status] ?? { label: status, cls: "bg-slate-100 text-slate-600" };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${m.cls}`}>
      {m.label}
    </span>
  );
}

function row(label: string, value: React.ReactNode) {
  return (
    <li className="flex items-center justify-between gap-4 border-b border-slate-100 py-2.5 text-sm last:border-0">
      <span className="text-slate-700">{label}</span>
      <span className="flex items-center gap-2 font-medium text-slate-900">
        {value}
      </span>
    </li>
  );
}

export default function DisplayNameStatus() {
  const [data, setData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const check = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/wa/display-name-status");
      const d = (await res.json().catch(() => ({}))) as StatusData & {
        error?: string;
      };
      if (!res.ok) {
        setError(d.error ?? "Gagal membaca status");
        setData(null);
        return;
      }
      setData(d);
    } catch {
      setError("Jaringan bermasalah — coba lagi");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          Dibaca langsung dari Graph API Meta — status asli review nama tampilan.
        </p>
        <button
          onClick={check}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Membaca…" : "Cek ulang"}
        </button>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      )}

      {!error && !data && (
        <p className="text-sm text-slate-500">Membaca status…</p>
      )}

      {data && !data.ok && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {data.detail ?? "Gagal membaca status dari Meta"}
        </p>
      )}

      {data && data.ok && (
        <ul>
          {row(
            "Nama tampilan sekarang",
            <span className="flex items-center gap-2">
              {data.verifiedName || "—"}
              {nameBadge(data.nameStatus)}
            </span>,
          )}
          {row(
            "Pengajuan nama baru",
            data.newDisplayName ? (
              <span className="flex items-center gap-2">
                {data.newDisplayName}
                {nameBadge(data.newNameStatus)}
              </span>
            ) : (
              <span className="text-slate-400">Tidak ada</span>
            ),
          )}
          {row(
            "Kualitas nomor",
            data.qualityRating ? (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  QUALITY_LABELS[data.qualityRating]?.cls ??
                  "bg-slate-100 text-slate-600"
                }`}
              >
                {QUALITY_LABELS[data.qualityRating]?.label ?? data.qualityRating}
              </span>
            ) : (
              <span className="text-slate-400">—</span>
            ),
          )}
          {row(
            "Batas kirim",
            data.messagingLimit ? (
              <span className="font-mono text-xs">{data.messagingLimit}</span>
            ) : (
              <span className="text-slate-400">—</span>
            ),
          )}
        </ul>
      )}

      <p className="text-xs text-slate-500">
        Catatan Meta: setelah nama baru diproses, nomor perlu{" "}
        <strong>didaftarkan ulang (re-register)</strong> agar nama baru tampil
        di chat pelanggan — bisa lewat WhatsApp Manager atau API.
      </p>
    </div>
  );
}
