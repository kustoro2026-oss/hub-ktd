"use client";

// Daftar kontak + tombol cek status WhatsApp satu per satu (endpoint
// contacts Meta gratis). Dicek dari browser secara berurutan dengan jeda
// agar tidak menabrak batas waktu serverless dan rate limit Meta.
import { useRef, useState } from "react";
import Link from "next/link";
import { BadgeCheck, CheckCircle2, XCircle, AlertCircle, Play, Square } from "lucide-react";
import type { Contact } from "@/lib/db";

const DELAY_MS = 700; // jeda antar cek nomor

type WaStatus = "" | "valid" | "invalid" | "error";

function statusLabel(s: WaStatus): { label: string; cls: string } {
  switch (s) {
    case "valid":
      return { label: "Valid", cls: "bg-emerald-100 text-emerald-700" };
    case "invalid":
      return { label: "Tidak valid", cls: "bg-red-100 text-red-700" };
    case "error":
      return { label: "Gagal cek", cls: "bg-amber-100 text-amber-700" };
    default:
      return { label: "Belum dicek", cls: "bg-slate-100 text-slate-500" };
  }
}

export default function VerifikasiClient({
  contacts,
}: {
  contacts: Contact[];
}) {
  const [rows, setRows] = useState<Contact[]>(contacts);
  const [filter, setFilter] = useState<"semua" | "" | "valid" | "invalid" | "error">("semua");
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const stopRef = useRef(false);

  const counts = {
    semua: rows.length,
    "": rows.filter((c) => !c.wa_status).length,
    valid: rows.filter((c) => c.wa_status === "valid").length,
    invalid: rows.filter((c) => c.wa_status === "invalid").length,
    error: rows.filter((c) => c.wa_status === "error").length,
  };

  function updateRow(id: number, status: WaStatus) {
    setRows((prev) =>
      prev.map((c) => (c.id === id ? { ...c, wa_status: status } : c)),
    );
  }

  async function verifyOne(id: number): Promise<boolean> {
    setBusyId(id);
    try {
      const res = await fetch("/api/contacts/verify-one", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        status?: WaStatus;
        error?: string;
      };
      if (!res.ok) {
        setMsg(data.error ?? "Gagal memeriksa nomor");
        return false;
      }
      updateRow(id, data.status ?? "error");
      return true;
    } catch {
      setMsg("Jaringan bermasalah — coba lagi");
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function run(list: Contact[]) {
    if (running || list.length === 0) return;
    stopRef.current = false;
    setRunning(true);
    setMsg("");
    setDone(0);
    setTotal(list.length);
    for (const c of list) {
      if (stopRef.current) break;
      const ok = await verifyOne(c.id);
      setDone((d) => d + 1);
      if (ok) await new Promise((r) => setTimeout(r, DELAY_MS));
    }
    setRunning(false);
    setMsg(stopRef.current ? "Dihentikan." : "Selesai memeriksa.");
  }

  const filtered = filter === "semua" ? rows : rows.filter((c) => c.wa_status === filter);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Verifikasi WhatsApp</h1>
          <p className="text-sm text-slate-500">
            Cek nomor kontak terdaftar di WhatsApp sebelum broadcast massal —
            gratis, tanpa memakai kuota pesan.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {running ? (
            <button
              onClick={() => {
                stopRef.current = true;
              }}
              className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
            >
              <Square className="h-3.5 w-3.5" />
              Berhenti
            </button>
          ) : (
            <>
              <button
                onClick={() => run(rows.filter((c) => !c.wa_status))}
                disabled={counts[""] === 0}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                Cek yang Belum
              </button>
              <button
                onClick={() => run(rows)}
                disabled={rows.length === 0}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
              >
                <Play className="h-3.5 w-3.5" />
                Cek Semua
              </button>
            </>
          )}
        </div>
      </div>

      {/* Ringkasan status */}
      <div className="flex flex-wrap gap-2 text-xs">
        {(
          [
            ["semua", "Semua"],
            ["", "Belum dicek"],
            ["valid", "Valid"],
            ["invalid", "Tidak valid"],
            ["error", "Gagal cek"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={label}
            onClick={() => setFilter(key)}
            className={`rounded-full px-3 py-1 font-medium ${
              filter === key
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
            }`}
          >
            {label} ({counts[key]})
          </button>
        ))}
      </div>

      {running && (
        <p className="text-sm text-slate-600">
          Memeriksa… {done}/{total} (berhenti kapan saja)
        </p>
      )}
      {msg && !running && <p className="text-sm text-slate-600">{msg}</p>}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          Belum ada kontak.{" "}
          <Link href="/kontak" className="font-medium text-emerald-700 underline">
            Tambahkan kontak dulu
          </Link>{" "}
          di halaman Kontak.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-400">
                <th className="px-4 py-2.5 font-medium">Nama</th>
                <th className="px-4 py-2.5 font-medium">Nomor</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((c) => {
                const st = statusLabel(c.wa_status as WaStatus);
                return (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 text-slate-900">
                      {c.name || <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-2 font-mono text-slate-600">{c.phone}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}
                      >
                        {c.wa_status === "valid" && <CheckCircle2 className="h-3 w-3" />}
                        {c.wa_status === "invalid" && <XCircle className="h-3 w-3" />}
                        {c.wa_status === "error" && <AlertCircle className="h-3 w-3" />}
                        {!c.wa_status && <BadgeCheck className="h-3 w-3 opacity-50" />}
                        {st.label}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => verifyOne(c.id)}
                        disabled={running || busyId === c.id}
                        className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                      >
                        {busyId === c.id ? "Mengecek…" : "Cek"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
