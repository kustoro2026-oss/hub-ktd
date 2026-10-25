"use client";

// Import banyak kontak email ke SATU grup. Grup wajib dipilih — tidak ada
// daftar umum. Laporan hasil import memecah angka supaya bisa direkonsiliasi
// dengan isi grup: total baris → valid → unik → baru / diperbarui / dipindah,
// plus duplikat & tidak valid (bisa diunduh).
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { EmailGroup } from "@/lib/db";

const EMAIL_FIND = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ImportResult = {
  ok?: boolean;
  error?: string;
  groupName?: string;
  totalLines?: number;
  validLines?: number;
  uniqueEmails?: number;
  added?: number;
  updated?: number;
  moved?: number;
  duplicates?: number;
  invalid?: string[];
  invalidCount?: number;
  memberCount?: number;
};

export default function EmailImportForm({
  groups,
}: {
  groups: EmailGroup[];
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [groupId, setGroupId] = useState(groups[0]?.id ?? 0);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileNote, setFileNote] = useState("");

  useEffect(() => {
    if (!groups.some((g) => g.id === groupId)) {
      setGroupId(groups[0]?.id ?? 0);
    }
  }, [groups, groupId]);

  // Baca file .txt (satu alamat per baris) atau Excel/CSV → daftar
  // "Nama, email" di textarea. Bisa pilih lebih dari satu file sekaligus
  // (mis. email_dipisah_per_400). Kolom nama & email dikenali dari baris
  // judul; tanpa judul, alamat dicari di seluruh kolom. Baris tanpa email
  // tetap dimasukkan supaya dihitung "tidak valid" oleh server.
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    try {
      const allLines: string[] = [];
      for (const file of files) {
        if (/\.txt$/i.test(file.name)) {
          const raw = await file.text();
          for (const line of raw.split(/\r?\n/)) {
            const s = line.trim();
            if (!s) continue;
            const found = s.match(EMAIL_FIND)?.[0] ?? "";
            allLines.push(
              EMAIL_RE.test(found) ? found.toLowerCase() : s.replace(/[,;\n]/g, " "),
            );
          }
          continue;
        }
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
        for (let r = start; r < rows.length; r++) {
          const row = (rows[r] ?? []).map((c) => String(c ?? "").trim());
          if (row.every((c) => c === "")) continue;
          let name = nameCol >= 0 ? (row[nameCol] ?? "") : "";
          let email = emailCol >= 0 ? (row[emailCol] ?? "") : "";
          if (emailCol < 0) {
            const found = row.find((c) => EMAIL_FIND.test(c));
            if (found) email = found.match(EMAIL_FIND)?.[0] ?? "";
          }
          email = email.toLowerCase();
          if (!EMAIL_RE.test(email)) {
            // Tanpa email valid — biarkan server menghitung sebagai invalid.
            allLines.push(row.join(", "));
            continue;
          }
          if (!name) {
            const idx = row.findIndex((c) => EMAIL_FIND.test(c));
            name = row.find((c, i) => i !== idx && c !== "") ?? "";
          }
          allLines.push(
            name ? `${name.replace(/[,;\n]/g, " ").trim()}, ${email}` : email,
          );
        }
      }
      if (allLines.length === 0) {
        setFileNote("Tidak ada baris yang terbaca dari file");
        return;
      }
      setText(allLines.join("\n"));
      setFileNote(
        `Terbaca ${allLines.length} baris dari ${files.length} file — periksa lalu klik Import`,
      );
    } catch {
      setFileNote("Gagal membaca file — pastikan format .txt, .xlsx, atau .csv");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!groupId) {
      setResult({ error: "Buat grup dulu di Langkah 1" });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/email/contacts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, groupId }),
      });
      const data = (await res.json().catch(() => ({}))) as ImportResult;
      setResult(data);
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

  function downloadInvalid() {
    const rows = result?.invalid ?? [];
    if (rows.length === 0) return;
    const blob = new Blob([rows.join("\n")], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "baris-tidak-valid.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">
          Atau unggah file .txt / Excel / CSV (bisa pilih beberapa file
          sekaligus)
        </span>
        <input
          type="file"
          accept=".txt,.xlsx,.xls,.csv"
          multiple
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
        Alamat email dikenali di mana pun dalam baris — pemisah koma, titik
        koma, atau format <code>Nama &lt;email&gt;</code> semuanya diterima.
        Alamat yang sudah ada di grup lain akan <strong>dipindahkan</strong> ke
        grup tujuan (satu kontak = satu grup).
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            Grup tujuan (wajib)
          </span>
          <select
            value={groupId}
            onChange={(e) => setGroupId(Number(e.target.value))}
            disabled={groups.length === 0}
            required
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 disabled:bg-slate-50"
          >
            {groups.length === 0 && (
              <option value={0}>Belum ada grup — buat di Langkah 1</option>
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
          disabled={busy || !text.trim() || groups.length === 0}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {busy ? "Mengimpor…" : "Import"}
        </button>
      </div>

      {result?.ok && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          <p className="font-medium">
            Import selesai ke grup &quot;{result.groupName}&quot; — grup kini
            berisi {result.memberCount} kontak.
          </p>
          <ul className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-4">
            <li>Total baris: {result.totalLines}</li>
            <li>Email valid: {result.validLines}</li>
            <li>Unik: {result.uniqueEmails}</li>
            <li>Baru: {result.added}</li>
            <li>Diperbarui: {result.updated}</li>
            <li>Dipindah dari grup lain: {result.moved}</li>
            <li>Duplikat di file: {result.duplicates}</li>
            <li>Tidak valid: {result.invalidCount}</li>
          </ul>
          {(result.invalid?.length ?? 0) > 0 && (
            <div className="mt-1">
              <button
                type="button"
                onClick={downloadInvalid}
                className="underline hover:text-emerald-700"
              >
                Unduh baris tidak valid
              </button>
              <span className="ml-2 text-emerald-700/80">
                contoh: {result.invalid?.slice(0, 3).join(" | ")}
              </span>
            </div>
          )}
        </div>
      )}
      {result?.error && <p className="text-sm text-red-600">{result.error}</p>}
    </form>
  );
}
