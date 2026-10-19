"use client";

// Import banyak kontak email sekaligus — tempel daftar alamat
// (dengan/tanpa nama) atau unggah file Excel/CSV, boleh langsung
// dimasukkan ke satu grup. Satu baris = "Nama, email" (pemisah koma
// terakhir) atau email saja.
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { EmailGroup } from "@/lib/db";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EmailImportForm({
  groups,
}: {
  groups: EmailGroup[];
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [groupId, setGroupId] = useState(0);
  const [result, setResult] = useState<{
    added?: number;
    skipped?: number;
    invalid?: string[];
    error?: string;
    groupName?: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileNote, setFileNote] = useState("");

  // Baca file Excel/CSV → ubah jadi daftar "Nama, email" di textarea.
  // Kolom nama & email dikenali dari baris judul (nama/name/email/mail/dll);
  // tanpa judul, kolom pertama = nama dan kedua = email — kecuali kolom
  // pertama berisi "@", maka dianggap email saja.
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // biar file yang sama bisa dipilih ulang
    if (!file) return;
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<(string | number)[]>(ws, {
        header: 1,
        raw: false,
        defval: "",
      });
      let nameCol = -1;
      let emailCol = -1;
      const head = (rows[0] ?? []).map((c) => String(c ?? "").toLowerCase());
      head.forEach((h, i) => {
        if (nameCol === -1 && /nama|name|pelanggan|customer|kontak/.test(h))
          nameCol = i;
        if (emailCol === -1 && /email|e-mail|mail|alamat/.test(h))
          emailCol = i;
      });
      const start = nameCol >= 0 || emailCol >= 0 ? 1 : 0;
      const lines: string[] = [];
      for (let r = start; r < rows.length; r++) {
        const row = (rows[r] ?? []).map((c) => String(c ?? "").trim());
        if (row.every((c) => c === "")) continue;
        let name = nameCol >= 0 ? (row[nameCol] ?? "") : "";
        let email = emailCol >= 0 ? (row[emailCol] ?? "") : "";
        if (emailCol < 0 && nameCol < 0) {
          const first = row[0] ?? "";
          if (first.includes("@") && EMAIL_RE.test(first)) {
            email = first;
            name = row[1] ?? "";
          } else {
            name = first;
            email = row[1] ?? "";
          }
        }
        email = email.toLowerCase();
        if (!EMAIL_RE.test(email)) continue;
        lines.push(
          name
            ? `${name.replace(/[,;\n]/g, " ").trim()}, ${email}`
            : email,
        );
      }
      if (lines.length === 0) {
        setFileNote(
          "Tidak ada baris dengan alamat email yang terbaca dari file ini",
        );
        return;
      }
      setText(lines.join("\n"));
      setFileNote(
        `Terbaca ${lines.length} baris dari file "${file.name}" — periksa lalu klik Import`,
      );
    } catch {
      setFileNote("Gagal membaca file — pastikan format .xlsx atau .csv");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    const target = groups.find((g) => g.id === groupId);
    try {
      const res = await fetch("/api/email/contacts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          groupId: groupId > 0 ? groupId : undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        added?: number;
        skipped?: number;
        invalid?: string[];
        error?: string;
      };
      setResult({ ...data, groupName: target?.name });
      if (res.ok) {
        setText("");
        router.refresh();
      }
    } catch {
      setResult({ error: "Tidak dapat terhubung ke server" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">
          Atau unggah file Excel / CSV (kolom nama & email terbaca otomatis)
        </span>
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={onFile}
          className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-600 file:px-3 file:py-2 file:text-xs file:font-medium file:text-white hover:file:bg-emerald-700"
        />
        {fileNote && (
          <span className="mt-1 block text-[11px] text-slate-500">{fileNote}</span>
        )}
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">
          Daftar alamat — satu per baris: <code>Nama, budi@gmail.com</code>{" "}
          atau cukup alamatnya
        </span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder={"Budi, budi@gmail.com\nsiti@yahoo.com\nJoko, joko@outlook.com"}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
      </label>
      <p className="text-xs text-slate-400">
        Contoh benar: <code>Budi, budi@gmail.com</code> atau{" "}
        <code>budi@gmail.com</code>. Nama harus dipisah koma dari alamatnya —
        tanpa koma baris dianggap alamat saja. Alamat yang sudah ada tidak
        diduplikasi.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            Grup tujuan
          </span>
          <select
            value={groupId}
            onChange={(e) => setGroupId(Number(e.target.value))}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          >
            <option value={0}>Tanpa grup (daftar umum)</option>
            {groups.length === 0 && (
              <option value={-1} disabled>
                Belum ada grup — buat di Langkah 1
              </option>
            )}
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {busy ? "Mengimpor…" : "Import"}
        </button>
      </div>
      {result?.added !== undefined && (
        <p className="text-sm text-emerald-700">
          Berhasil: {result.added} kontak
          {result.groupName ? ` — dimasukkan ke grup "${result.groupName}"` : ""}
          {(result.skipped ?? 0) > 0 && (
            <span className="text-slate-500">
              {" "}
              — dilewati {result.skipped} (tidak valid / sudah ada)
              {result.invalid && result.invalid.length > 0 && (
                <span>
                  {" "}
                  — contoh tidak valid: {result.invalid.slice(0, 3).join(", ")}
                </span>
              )}
            </span>
          )}
        </p>
      )}
      {result?.error && <p className="text-sm text-red-600">{result.error}</p>}
    </form>
  );
}
