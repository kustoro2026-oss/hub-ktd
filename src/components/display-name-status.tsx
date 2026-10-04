"use client";

// Kartu status nama tampilan WhatsApp di halaman Pengaturan — baca status
// review dari Graph API Meta, ajukan nama baru, dan terapkan nama baru ke
// WhatsApp (re-register dengan PIN 2 langkah). PIN dikirim sekali dari
// browser dan tidak disimpan di server.
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

function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-slate-600">{label}</span>
      <span className="flex items-center gap-2 font-medium text-slate-900">
        {children}
      </span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
      {children}
    </h3>
  );
}

export default function DisplayNameStatus() {
  const [data, setData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [pin, setPin] = useState("");
  const [applying, setApplying] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState(false);

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

  async function submitName() {
    const name = newName.trim();
    if (name.length < 3) {
      setError("Nama baru minimal 3 karakter");
      return;
    }
    setRenaming(true);
    setError("");
    setMsg("");
    try {
      const res = await fetch("/api/wa/display-name-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        detail?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(d.error ?? "Gagal mengajukan nama baru");
        return;
      }
      setNewName("");
      setMsg(
        d.ok
          ? "Nama baru diajukan — statusnya muncul di bagian Status nama."
          : (d.detail ?? "Gagal mengajukan nama baru"),
      );
      await check();
    } catch {
      setError("Jaringan bermasalah — coba lagi");
    } finally {
      setRenaming(false);
    }
  }

  async function applyName() {
    if (!/^\d{6,8}$/.test(pin)) {
      setError("PIN harus 6–8 digit angka");
      return;
    }
    setApplying(true);
    setError("");
    setMsg("");
    try {
      const res = await fetch("/api/wa/register-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        detail?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(d.error ?? "Gagal menerapkan nama");
        return;
      }
      setPin("");
      setMsg(
        d.ok
          ? "Nama baru berhasil diterapkan — status di atas diperbarui."
          : (d.detail ?? "Gagal menerapkan nama"),
      );
      await check();
    } catch {
      setError("Jaringan bermasalah — coba lagi");
    } finally {
      setApplying(false);
    }
  }

  useEffect(() => {
    void check();
  }, [check]);

  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-slate-500">
          Dibaca langsung dari Graph API Meta — status asli review nama tampilan.
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

      {!error && !data && (
        <p className="text-sm text-slate-500">Membaca status…</p>
      )}

      {data && !data.ok && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {data.detail ?? "Gagal membaca status dari Meta"}
        </p>
      )}

      {data && data.ok && (
        <div>
          <SectionTitle>Status nama</SectionTitle>
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white px-3">
            <InfoRow label="Nama tampilan sekarang">
              <span className="flex items-center gap-2">
                {data.verifiedName || "—"}
                {nameBadge(data.nameStatus)}
              </span>
            </InfoRow>
            <InfoRow label="Pengajuan nama baru">
              {data.newDisplayName ? (
                <span className="flex items-center gap-2">
                  {data.newDisplayName}
                  {nameBadge(data.newNameStatus)}
                </span>
              ) : (
                <span className="text-slate-400">Tidak ada</span>
              )}
            </InfoRow>
            <InfoRow label="Kualitas nomor">
              {data.qualityRating ? (
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
              )}
            </InfoRow>
            <InfoRow label="Batas kirim">
              {data.messagingLimit ? (
                <span className="font-mono text-xs">{data.messagingLimit}</span>
              ) : (
                <span className="text-slate-400">—</span>
              )}
            </InfoRow>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <SectionTitle>Ganti nama tampilan</SectionTitle>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            autoComplete="off"
            maxLength={25}
            placeholder="Nama baru (mis. KTD Store)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-56 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none"
          />
          <button
            onClick={submitName}
            disabled={renaming || newName.trim().length < 3}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40"
          >
            {renaming ? "Mengirim…" : "Ganti nama"}
          </button>
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          Nama baru masuk antrean verifikasi Meta (maks 10 perubahan per 30
          hari), lalu diterapkan dengan PIN di bawah.
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <SectionTitle>Terapkan nama baru</SectionTitle>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            placeholder="PIN 2 langkah (6 digit)"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            className="w-44 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none"
          />
          <button
            onClick={applyName}
            disabled={applying}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            {applying ? "Menerapkan…" : "Terapkan nama baru"}
          </button>
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          Daftarkan ulang nomor agar nama baru tampil ke pelanggan. Kalau nomor
          ini belum pernah menyetel PIN 2 langkah, angka yang dimasukkan akan
          menjadi PIN-nya. PIN hanya diteruskan sekali ke Meta — tidak disimpan.
        </p>
      </div>

      <p className="text-xs text-slate-500">
        Catatan Meta: setelah nama baru diproses, nomor perlu{" "}
        <strong>didaftarkan ulang (re-register)</strong> agar nama baru tampil
        di chat pelanggan — bisa lewat WhatsApp Manager atau API.
      </p>
    </div>
  );
}
