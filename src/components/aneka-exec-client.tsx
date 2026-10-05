"use client";

// Daftar eksekusi pesanan TikTok → Aneka: per baris status + tombol Setuju
// (jalankan checkout Aneka penuh) / Batalkan (hentikan antrean). Setelah
// aksi berhasil, daftar dimuat ulang dari server.
import { useRouter } from "next/navigation";
import { useState } from "react";

export type ExecRow = {
  order_id: string;
  status: string;
  shop_name: string;
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
};

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  menunggu: { text: "Menunggu persetujuan", cls: "bg-amber-100 text-amber-800" },
  berjalan: { text: "Sedang dieksekusi", cls: "bg-sky-100 text-sky-800" },
  selesai: { text: "Selesai", cls: "bg-emerald-100 text-emerald-800" },
  batal: { text: "Dibatalkan", cls: "bg-slate-200 text-slate-600" },
  gagal: { text: "Gagal — bisa dicoba lagi", cls: "bg-rose-100 text-rose-800" },
};

function ExecActions({ row }: { row: ExecRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"" | "setuju" | "batalkan">("");
  const [error, setError] = useState("");

  async function act(action: "setuju" | "batalkan") {
    // Konfirmasi eksplisit sebelum memindahkan saldo Aneka — mencegah
    // salah klik baris yang salah terbayar.
    if (
      action === "setuju" &&
      !window.confirm(
        `Yakin jalankan checkout Aneka untuk pesanan ${row.order_id}?\nSaldo Aneka akan terpotong sekitar ${row.total_estimate} (modal ${row.total_modal} + ongkos pengemasan Rp3.000).\nTekan OK untuk melanjutkan, Batal untuk mundur.`,
      )
    ) {
      return;
    }
    setBusy(action);
    setError("");
    try {
      const res = await fetch("/api/tiktok/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: row.order_id, action }),
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

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => act("setuju")}
        disabled={busy !== ""}
        className="rounded-lg bg-emerald-700 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-800 disabled:opacity-60"
      >
        {busy === "setuju"
          ? "Mengeksekusi..."
          : row.status === "menunggu"
            ? "Setuju"
            : "Coba lagi"}
      </button>
      <button
        type="button"
        onClick={() => act("batalkan")}
        disabled={busy !== ""}
        className="rounded-lg border border-rose-300 px-4 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
      >
        {busy === "batalkan" ? "Membatalkan..." : "Batalkan"}
      </button>
      {error ? (
        <p className="w-full break-words text-xs leading-snug text-rose-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default function AnekaExecClient({
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
            id={`order-${row.order_id}`}
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
                {row.shop_name ? (
                  <span className="text-xs text-slate-500">
                    {row.shop_name}
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
