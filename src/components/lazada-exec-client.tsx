"use client";

// Daftar eksekusi pesanan Lazada → Aneka: per baris status + tombol Setuju
// (jalankan checkout Aneka penuh) / Batalkan (hentikan antrean). Setelah
// aksi berhasil, daftar dimuat ulang dari server.
import { useRouter } from "next/navigation";
import { useState } from "react";

export type ExecRow = {
  order_id: string;
  status: string;
  store_name: string;
  total_modal: string;
  /** Perkiraan potong saldo sebenarnya (modal + ongkos pengemasan Rp3.000). */
  total_estimate: string;
  items: { qty: number; name: string; subtotal: string }[];
  tracking_number: string;
  aneka_payment_id: string;
  aneka_order_id: string;
  detail: string;
  /** Jejak langkah eksekusi checkout Aneka (satu baris per langkah). */
  log: string;
  created_at: string;
  executed_at: string;
  /** Hasil audit kesiapan terakhir (payload.audit) — gerbang tombol
   *  Setuju: selama ada blocker (ok=false), Setuju dinonaktifkan. */
  audit: {
    at: number;
    ok: boolean;
    blockers: { kode: string; teks: string }[];
    saldo?: number;
  } | null;
  /** true bila label PDF resmi sudah tersimpan di payload. */
  label_siap: boolean;
};

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  menunggu: { text: "Menunggu persetujuan", cls: "bg-amber-100 text-amber-800" },
  berjalan: { text: "Sedang dieksekusi", cls: "bg-sky-100 text-sky-800" },
  selesai: { text: "Selesai", cls: "bg-emerald-100 text-emerald-800" },
  batal: { text: "Dibatalkan", cls: "bg-slate-200 text-slate-600" },
  gagal: { text: "Gagal — bisa dicoba lagi", cls: "bg-rose-100 text-rose-800" },
};

/** Chip hasil audit kesiapan (Varian/Label/Saldo) + rincian blocker.
 *  Merah = blocker (menonaktifkan Setuju), hijau = lolos, kuning = belum
 *  diperiksa/tidak diketahui (tidak memblokir). */
function AuditBar({ row }: { row: ExecRow }) {
  const a = row.audit;
  const b = (kode: string) => a?.blockers.find((x) => x.kode === kode);
  const chip = (cls: string, teks: string) => (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}
    >
      {teks}
    </span>
  );
  return (
    <div className="mt-2 space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {b("varian")
          ? chip("bg-rose-100 text-rose-800", "Varian bermasalah")
          : a
            ? chip("bg-emerald-100 text-emerald-800", "Varian cocok")
            : chip("bg-amber-100 text-amber-800", "Varian belum diaudit")}
        {b("label")
          ? chip("bg-rose-100 text-rose-800", "Label bermasalah")
          : row.label_siap
            ? chip("bg-emerald-100 text-emerald-800", "Label siap")
            : chip("bg-amber-100 text-amber-800", "Label belum diisi")}
        {b("saldo")
          ? chip("bg-rose-100 text-rose-800", "Saldo kurang")
          : a && typeof a.saldo === "number"
            ? chip(
                "bg-emerald-100 text-emerald-800",
                `Saldo Rp${a.saldo.toLocaleString("id-ID")}`,
              )
            : chip("bg-amber-100 text-amber-800", "Saldo belum dicek")}
      </div>
      {a && a.blockers.length > 0 ? (
        <ul className="space-y-0.5">
          {a.blockers.map((x, i) => (
            <li
              key={i}
              className="break-words text-xs leading-snug text-rose-700"
            >
              [{x.kode}] {x.teks}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ExecActions({ row }: { row: ExecRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"" | "setuju" | "batalkan" | "audit">("");
  const [error, setError] = useState("");

  async function act(action: "setuju" | "batalkan", force = false) {
    // Konfirmasi eksplisit sebelum memindahkan saldo Aneka — mencegah
    // salah klik baris yang salah terbayar. Force (bayar ulang setelah
    // dicek manual) memakai peringatan yang jauh lebih keras.
    if (action === "setuju") {
      const pesan = force
        ? `PERINGATAN: paksa bayar ulang pesanan ${row.order_id}.\nHanya lanjutkan bila Anda SUDAH memeriksa riwayat pembayaran Aneka dan YAKIN pesanan ini BELUM dibayar.\nSaldo Aneka akan terpotong sekitar ${row.total_estimate} (modal ${row.total_modal} + ongkos pengemasan Rp3.000).\nTekan OK bila yakin, Batal untuk mundur.`
        : `Yakin jalankan checkout Aneka untuk pesanan ${row.order_id}?\nSaldo Aneka akan terpotong sekitar ${row.total_estimate} (modal ${row.total_modal} + ongkos pengemasan Rp3.000).\nTekan OK untuk melanjutkan, Batal untuk mundur.`;
      if (!window.confirm(pesan)) {
        return;
      }
    }
    setBusy(action);
    setError("");
    try {
      const res = await fetch("/api/lazada/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: row.order_id, action, force }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        detail?: string;
        error?: string;
      };
      if (data.ok) {
        router.refresh();
      } else {
        setError(data.detail ?? data.error ?? `HTTP ${res.status}`);
      }
    } catch {
      setError("tidak dapat menghubungi server");
    } finally {
      setBusy("");
    }
  }

  async function audit() {
    setBusy("audit");
    setError("");
    try {
      const res = await fetch("/api/lazada/exec/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: row.order_id }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        detail?: string;
        error?: string;
      };
      if (data.ok) {
        router.refresh();
      } else {
        setError(data.detail ?? data.error ?? `HTTP ${res.status}`);
      }
    } catch {
      setError("tidak dapat menghubungi server");
    } finally {
      setBusy("");
    }
  }

  // Gerbang audit: selama ada blocker kesiapan, Setuju nonaktif — kegagalan
  // eksekusi (varian tidak cocok / label belum bisa dicetak / saldo kurang)
  // harus beres DULUAN, bukan ketahuan setelah saldo terpotong.
  const terblokir = row.audit ? !row.audit.ok : false;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={audit}
        disabled={busy !== ""}
        className="rounded-lg border border-sky-300 px-4 py-1.5 text-xs font-medium text-sky-800 transition hover:bg-sky-50 disabled:opacity-60"
      >
        {busy === "audit" ? "Memeriksa..." : "Periksa Kesiapan"}
      </button>
      <button
        type="button"
        onClick={() => act("setuju")}
        disabled={busy !== "" || terblokir}
        className="rounded-lg bg-emerald-700 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-800 disabled:opacity-60"
      >
        {busy === "setuju"
          ? "Mengeksekusi..."
          : row.status === "menunggu"
            ? "Setuju"
            : "Coba lagi"}
      </button>
      {row.detail.includes("[PERLU CEK MANUAL]") ? (
        <button
          type="button"
          onClick={() => act("setuju", true)}
          disabled={busy !== ""}
          className="rounded-lg border border-amber-400 bg-amber-50 px-4 py-1.5 text-xs font-medium text-amber-800 transition hover:bg-amber-100 disabled:opacity-60"
        >
          {busy === "setuju" ? "Mengeksekusi..." : "Sudah dicek manual — bayar ulang"}
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => act("batalkan")}
        disabled={busy !== ""}
        className="rounded-lg border border-rose-300 px-4 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
      >
        {busy === "batalkan" ? "Membatalkan..." : "Batalkan"}
      </button>
      {terblokir ? (
        <p className="w-full break-words text-xs leading-snug text-rose-700">
          Tombol Setuju dinonaktifkan karena audit kesiapan menemukan blocker
          — bereskan masalah di atas, lalu tekan Periksa Kesiapan.
        </p>
      ) : null}
      {error ? (
        <p className="w-full break-words text-xs leading-snug text-rose-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default function LazadaExecClient({
  rows,
  focusOrder,
}: {
  rows: ExecRow[];
  focusOrder: string;
}) {
  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const st = STATUS_LABEL[row.status] ?? {
          text: row.status,
          cls: "bg-slate-200 text-slate-600",
        };
        const focused = focusOrder === row.order_id;
        return (
          <div
            key={row.order_id}
            id={`ord-${row.order_id}`}
            className={`rounded-xl border bg-white p-4 ${
              focused
                ? "border-emerald-500 ring-2 ring-emerald-200"
                : "border-slate-200"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-slate-900">
                  {row.order_id}
                </span>
                {row.store_name ? (
                  <span className="text-xs text-slate-500">
                    {row.store_name}
                  </span>
                ) : null}
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${st.cls}`}
                >
                  {st.text}
                </span>
              </div>
              <span className="text-xs text-slate-400">
                Dibuat {row.created_at}
              </span>
            </div>

            {row.items.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {row.items.map((it, i) => (
                  <li key={i} className="text-sm text-slate-700">
                    {it.qty}x {it.name}{" "}
                    <span className="text-xs text-slate-400">
                      ({it.subtotal})
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-1 text-xs text-slate-500">
              Total modal: <span className="font-medium">{row.total_modal}</span>
              {" · "}Potong saldo ±{" "}
              <span className="font-medium">{row.total_estimate}</span>{" "}
              (termasuk ongkos pengemasan)
              {row.tracking_number
                ? ` · No resi: ${row.tracking_number}`
                : ""}
            </p>

            <AuditBar row={row} />

            {row.aneka_payment_id || row.aneka_order_id ? (
              <p className="mt-2 text-sm text-emerald-800">
                ID pembayaran Aneka:{" "}
                {row.aneka_payment_id ? (
                  <a
                    href={`https://anekadropship.id/payment-history/finish?payment_id=${row.aneka_payment_id}&status=success`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold underline"
                  >
                    {row.aneka_payment_id}
                  </a>
                ) : (
                  <span className="font-semibold">—</span>
                )}
                {row.aneka_order_id
                  ? ` (kode pesanan ${row.aneka_order_id})`
                  : ""}
                {row.executed_at ? ` — ${row.executed_at}` : ""}
              </p>
            ) : null}
            {row.detail ? (
              <p className="mt-2 break-words text-xs leading-snug text-rose-700">
                {row.detail}
              </p>
            ) : null}

            {row.log ? (
              <details
                className="mt-3 rounded-lg border border-slate-200 bg-slate-50"
                open={row.status === "gagal" || row.status === "berjalan"}
              >
                <summary className="cursor-pointer select-none px-3 py-1.5 text-xs font-medium text-slate-600">
                  Jejak langkah eksekusi
                </summary>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words px-3 pb-3 text-[11px] leading-snug text-slate-700">
                  {row.log.trim()}
                </pre>
              </details>
            ) : null}

            {row.status === "menunggu" ||
            row.status === "gagal" ||
            row.status === "berjalan" ? (
              <div className="mt-3">
                <ExecActions row={row} />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
