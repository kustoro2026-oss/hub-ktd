"use client";

// Kartu kelola daftar blokir anti-spam di Pengaturan — daftar nomor yang
// bot-nya diam total, dengan tombol buka blokir.
import { useEffect, useState } from "react";

type Blocked = { wa_from: string; note: string; created_at: string };

export default function BlocklistCard() {
  const [items, setItems] = useState<Blocked[]>([]);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/wa/block")
      .then((r) => r.json())
      .then((d) => setItems((d as { numbers: Blocked[] }).numbers ?? []))
      .catch(() => {});
  }, []);

  async function unblock(waFrom: string, idx: number) {
    if (busy !== null) return;
    setBusy(idx);
    try {
      const res = await fetch(
        `/api/wa/block?from=${encodeURIComponent(waFrom)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        window.alert(data.error ?? "Gagal membuka blokir");
        return;
      }
      setItems((prev) => prev.filter((n) => n.wa_from !== waFrom));
    } catch {
      window.alert("Jaringan bermasalah — coba lagi");
    }
    setBusy(null);
  }

  return (
    <div className="text-sm">
      <p className="mb-3 text-slate-500">
        Nomor yang diblokir tidak pernah dibalas bot (pesan tetap dicatat di
        Pesan Masuk). Blokir juga bisa dilakukan langsung dari halaman chat
        nomor itu.
      </p>
      {items.length === 0 ? (
        <p className="text-slate-500">Belum ada nomor yang diblokir.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((n, i) => (
            <li
              key={n.wa_from}
              className="flex items-center justify-between gap-3 py-2"
            >
              <div className="min-w-0">
                <div className="font-mono text-xs text-slate-700">
                  {n.wa_from}
                </div>
                {n.note && (
                  <div className="text-xs text-slate-400">{n.note}</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => unblock(n.wa_from, i)}
                disabled={busy !== null}
                className="shrink-0 rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-emerald-300 hover:text-emerald-700 disabled:opacity-50"
              >
                {busy === i ? "Memproses..." : "Buka blokir"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
