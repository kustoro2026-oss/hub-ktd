"use client";

// Pembersih email tidak aktif di halaman Kontak Email.
// Dua cara:
//   1. Tempel teks notifikasi Gmail ("Delivery incomplete ...") → alamat
//      diekstrak lalu kontaknya dihapus dari daftar.
//   2. Pindai inbox via IMAP otomatis — hard bounce langsung dihapus,
//      soft bounce diberi strike (dihapus setelah 2 strike).
import { useState } from "react";
import { MailSearch, Trash2 } from "lucide-react";

type ScanResult = {
  ok: boolean;
  accounts: number;
  scanned: number;
  hardDeleted: number;
  softStrikes: number;
  softDeleted: number;
  errors: string[];
  error?: string;
};

const textareaCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs outline-none focus:border-emerald-500";

export default function EmailBounceCleaner() {
  const [text, setText] = useState("");
  const [busyDel, setBusyDel] = useState(false);
  const [busyScan, setBusyScan] = useState(false);
  const [msg, setMsg] = useState("");
  const [scanMsg, setScanMsg] = useState("");

  // Ekstrak alamat email dari teks bebas (notifikasi Gmail memakai
  // kalimat lengkap, bukan daftar bersih).
  const emails = [
    ...new Set(
      text
        .split(/[\s,;]+/)
        .map((s) =>
          s.trim().toLowerCase().replace(/[.,;:'"<>()[\]\u201c\u201d]+$/, ""),
        )
        .filter((s) => s.includes("@") && s.includes(".")),
    ),
  ];

  async function runDelete() {
    if (emails.length === 0) {
      setMsg("Tidak ada alamat email valid di teks.");
      return;
    }
    if (
      !window.confirm(
        `Hapus ${emails.length} alamat dari daftar kontak? Email tidak aktif tidak akan dikirimi lagi.`,
      )
    ) {
      return;
    }
    setBusyDel(true);
    setMsg("");
    try {
      const res = await fetch("/api/email/contacts/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        deleted?: number;
        error?: string;
      };
      if (res.ok && typeof d.deleted === "number") {
        setMsg(
          `Berhasil menghapus ${d.deleted} kontak tidak aktif${
            emails.length - d.deleted > 0
              ? ` (${emails.length - d.deleted} tidak ditemukan di kontak)`
              : ""
          }.`,
        );
        setText("");
      } else {
        setMsg(d.error ?? "Gagal menghapus kontak.");
      }
    } catch {
      setMsg("Tidak dapat terhubung ke server.");
    } finally {
      setBusyDel(false);
    }
  }

  async function runScan() {
    if (
      !window.confirm(
        "Pindai inbox semua akun SMTP yang sudah dikonfigurasi IMAP sekarang?",
      )
    ) {
      return;
    }
    setBusyScan(true);
    setScanMsg("");
    try {
      const res = await fetch("/api/email/bounce-scan", { method: "POST" });
      const d = (await res.json().catch(() => ({}))) as ScanResult;
      if (res.ok) {
        setScanMsg(
          `Selesai: ${d.accounts} akun dipindai, ${d.scanned} pesan gagal ditemukan, ` +
            `${d.hardDeleted} email tidak aktif dihapus, ${d.softStrikes} strike sementara, ` +
            `${d.softDeleted} dihapus setelah 2 strike.` +
            (d.errors.length > 0 ? ` Kendala: ${d.errors.join("; ")}` : ""),
        );
      } else {
        setScanMsg(d.error ?? "Gagal memindai inbox.");
      }
    } catch {
      setScanMsg("Tidak dapat terhubung ke server.");
    } finally {
      setBusyScan(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <p className="text-xs text-slate-500">
            Tempel teks notifikasi Gmail (mis. &quot;Delivery incomplete…&quot;)
            — alamat email akan dikenali otomatis lalu dihapus dari kontak.
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder={"Contoh:\nDelivery incomplete\nThere was a temporary problem delivering your message to rekrutmen05@gmail.com."}
            className={textareaCls}
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={runDelete}
              disabled={busyDel || emails.length === 0}
              className="flex items-center gap-2 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {busyDel
                ? "Menghapus…"
                : `Hapus ${emails.length > 0 ? `${emails.length} ` : ""}email tidak aktif`}
            </button>
            {msg && <span className="text-xs text-slate-600">{msg}</span>}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs text-slate-500">
            Pindai inbox otomatis (IMAP): pesan balasan gagal kirim dari
            Gmail/Mailer-Daemon diperiksa. Email alamat tidak ditemukan
            (hard bounce) langsung dihapus; masalah sementara (soft bounce,
            mis. &quot;Gmail will retry…&quot;) dihapus setelah 2 kali
            terdeteksi. Worker menjalankan pemindaian ini otomatis tiap 5
            menit.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={runScan}
              disabled={busyScan}
              className="flex items-center gap-2 rounded-lg border border-emerald-600 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
            >
              <MailSearch className="h-3.5 w-3.5" />
              {busyScan ? "Memindai…" : "Pindai inbox sekarang"}
            </button>
            {scanMsg && (
              <span className="text-xs text-slate-600">{scanMsg}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

