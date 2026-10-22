"use client";

// Tombol kirim kampanye email — SATU klik untuk seluruh daftar penerima.
//
// Cara kerja: klien memanggil /api/email/campaigns/[id]/send berulang.
// Tiap panggilan hanya mengerjakan satu slice ±12 detik (aman serverless)
// dan mengembalikan progres + `shouldContinue` + `waitSeconds`. Klien
// menunggu sesuai jeda batch dari akun SMTP lalu melanjutkan otomatis
// sampai sisa penerima habis. Pengguna tidak perlu klik berulang.
//
// ?start=1 di halaman detail memicu loop ini otomatis setelah kampanye
// dibuat dengan mode "Kirim sekarang".
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play, Send, CheckCircle2 } from "lucide-react";
import type { EmailCampaign } from "@/lib/db";

export type SendProgress = {
  total: number;
  sent: number;
  failed: number;
  pending: number;
  queued: number;
  remaining: number;
};

type RunResult = SendProgress & {
  ok?: boolean;
  error?: string;
  notice?: string;
  status?: EmailCampaign["status"];
  pauseReason?: string;
  shouldContinue?: boolean;
  waitSeconds?: number;
  batchSent?: number;
  smtpAccount?: { id: number; name: string; batchSize: number } | null;
};

// Jeda lebih panjang dari ini (mis. kuota harian habis sampai tengah
// malam) tidak ditunggu di tab — pengiriman dilanjutkan penjadwal.
const MAX_TAB_WAIT_SECONDS = 600;

const STATUS_TEXT: Record<string, string> = {
  draft: "Siap dikirim",
  sending: "Sedang mengirim",
  paused: "Dijeda",
  done: "Selesai",
};

export default function EmailSendButton({
  campaignId,
  initialStatus,
  initialProgress,
  autoStart = false,
}: {
  campaignId: number;
  initialStatus: EmailCampaign["status"];
  initialProgress: SendProgress;
  autoStart?: boolean;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState<SendProgress>(initialProgress);
  const [status, setStatus] = useState<EmailCampaign["status"]>(initialStatus);
  const [pauseReason, setPauseReason] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [account, setAccount] = useState<{
    name: string;
    batchSize: number;
  } | null>(null);
  const [running, setRunning] = useState(false);
  const [waitLeft, setWaitLeft] = useState(0);
  const cancelRef = useRef(false);
  const runningRef = useRef(false);
  const autoStartedRef = useRef(false);
  // Ronde yang sedang berjalan bisa menyelesaikan satu request setelah
  // tombol Jeda ditekan; hasil lama itu tidak boleh mengembalikan tampilan
  // ke "sending".
  const pauseRequestedRef = useRef(false);

  const applyResult = useCallback((d: RunResult) => {
    if (typeof d.total === "number") {
      setProgress({
        total: d.total,
        sent: d.sent ?? 0,
        failed: d.failed ?? 0,
        pending: d.pending ?? 0,
        queued: d.queued ?? 0,
        remaining: d.remaining ?? 0,
      });
    }
    if (pauseRequestedRef.current) {
      setStatus("paused");
      setPauseReason("manual");
      setNotice("Kampanye dijeda. Klik Lanjutkan untuk meneruskan.");
      return;
    }
    if (d.status) setStatus(d.status);
    setPauseReason(d.pauseReason ?? "");
    setNotice(d.notice ?? "");
    if (d.error) setError(d.error);
    if (d.smtpAccount) {
      setAccount({
        name: d.smtpAccount.name,
        batchSize: d.smtpAccount.batchSize,
      });
    }
  }, []);

  const runLoop = useCallback(
    async (firstAction: "start" | "continue") => {
      if (runningRef.current) return;
      runningRef.current = true;
      cancelRef.current = false;
      pauseRequestedRef.current = false;
      setRunning(true);
      setError("");
      setNotice("");
      let action = firstAction;
      try {
        while (!cancelRef.current) {
          const res = await fetch(`/api/email/campaigns/${campaignId}/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              action === "start" ? { action: "start" } : {},
            ),
          });
          const d = (await res.json().catch(() => ({}))) as RunResult;
          if (!res.ok) {
            setError(d.error ?? "Gagal mengirim");
            break;
          }
          applyResult(d);
          if (!d.shouldContinue) break;

          const wait = Math.max(0, Math.min(Number(d.waitSeconds) || 0, 1800));
          if (wait > MAX_TAB_WAIT_SECONDS) {
            // Kuota harian / jeda sangat panjang — biarkan penjadwal yang
            // melanjutkan, tab cukup menampilkan status.
            break;
          }
          if (wait > 0) {
            for (let s = wait; s > 0; s--) {
              if (cancelRef.current) break;
              setWaitLeft(s);
              await new Promise((r) => setTimeout(r, 1000));
            }
            setWaitLeft(0);
          }
          if (cancelRef.current) break;
          action = "continue";
        }
      } catch {
        setError("Tidak dapat terhubung ke server");
      } finally {
        runningRef.current = false;
        setRunning(false);
        setWaitLeft(0);
        router.refresh();
      }
    },
    [campaignId, applyResult, router],
  );

  // Muat otomatis saat ?start=1 (setelah "Kirim sekarang").
  useEffect(() => {
    if (!autoStart || autoStartedRef.current) return;
    if (initialProgress.remaining <= 0) return;
    autoStartedRef.current = true;
    void runLoop("start");
  }, [autoStart, initialProgress.remaining, runLoop]);

  async function pause() {
    cancelRef.current = true;
    pauseRequestedRef.current = true;
    setNotice("Menghentikan setelah email yang sedang diproses…");
    try {
      await fetch(`/api/email/campaigns/${campaignId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pause" }),
      });
      setStatus("paused");
      setPauseReason("manual");
      setNotice("Kampanye dijeda. Klik Lanjutkan untuk meneruskan.");
    } catch {
      setError("Tidak dapat menghubungi server");
    }
    router.refresh();
  }

  const done = progress.remaining <= 0;
  const processed = progress.sent + progress.failed;
  const pct =
    progress.total > 0
      ? Math.min(100, Math.round((processed / progress.total) * 100))
      : 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Pengiriman {STATUS_TEXT[status] ?? status}
          </h2>
          <p className="text-xs text-slate-500">
            {account
              ? `Akun ${account.name} · aturan ${account.batchSize} email/batch · `
              : ""}
            {progress.total} penerima
            {pauseReason === "fatal" && (
              <span className="text-red-600">
                {" "}
                — dijeda karena galat SMTP
              </span>
            )}
            {pauseReason === "cooldown" && (
              <span className="text-amber-700"> — jeda antar batch</span>
            )}
            {pauseReason === "manual" && (
              <span className="text-slate-600"> — dijeda manual</span>
            )}
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            done
              ? "bg-emerald-100 text-emerald-700"
              : status === "paused"
                ? "bg-amber-100 text-amber-700"
                : "bg-sky-100 text-sky-700"
          }`}
        >
          {done ? "Selesai" : running ? "Berjalan" : STATUS_TEXT[status] ?? status}
        </span>
      </div>

      <div>
        <div className="flex justify-between text-xs text-slate-500">
          <span>
            {processed} / {progress.total} diproses
          </span>
          <span>{pct}%</span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full transition-all ${
              done ? "bg-emerald-500" : "bg-sky-500"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div className="rounded-lg bg-slate-50 px-2 py-1.5">
            <div className="text-slate-500">Terkirim</div>
            <div className="font-semibold text-emerald-700">
              {progress.sent}
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 px-2 py-1.5">
            <div className="text-slate-500">Gagal</div>
            <div className="font-semibold text-red-600">{progress.failed}</div>
          </div>
          <div className="rounded-lg bg-slate-50 px-2 py-1.5">
            <div className="text-slate-500">Menunggu</div>
            <div className="font-semibold text-slate-700">
              {progress.remaining}
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 px-2 py-1.5">
            <div className="text-slate-500">Sedang diproses</div>
            <div className="font-semibold text-slate-700">
              {progress.queued}
            </div>
          </div>
        </div>
      </div>

      {notice && (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {notice}
        </p>
      )}
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {running ? (
          <>
            <button
              type="button"
              disabled
              className="flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white opacity-80"
            >
              <Send className="h-4 w-4" />
              {waitLeft > 0
                ? `Menunggu jeda batch — ${waitLeft} dtk`
                : "Mengirim…"}
            </button>
            <button
              type="button"
              onClick={pause}
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Pause className="h-4 w-4" /> Jeda
            </button>
          </>
        ) : done ? (
          <span className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            Selesai — semua {progress.total} penerima sudah diproses
          </span>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void runLoop("start")}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              {status === "draft" ? (
                <Send className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {status === "draft"
                ? `Kirim sekarang (${progress.remaining} email)`
                : `Lanjutkan (${progress.remaining} sisa)`}
            </button>
            {pauseReason === "fatal" && (
              <span className="text-xs text-red-600">
                Periksa akun SMTP di halaman Pengaturan SMTP, lalu klik
                Lanjutkan.
              </span>
            )}
          </>
        )}
      </div>
      <p className="text-[11px] text-slate-400">
        Biarkan halaman ini terbuka — proses berjalan otomatis batch demi batch
        mengikuti aturan akun SMTP. Bila tab ditutup, penjadwal melanjutkan
        otomatis saat halaman Hub dibuka lagi.
      </p>
    </div>
  );
}
