"use client";

// Buat kampanye broadcast: nama + penerima (semua kontak untuk MVP).
// Setelah dibuat, pengiriman dijalankan dari halaman detail kampanye.
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function BroadcastCreate({
  contactCount,
}: {
  contactCount: number;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/broadcasts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, template: "info_promo_v2" }),
      });
      if (res.ok) {
        const data = (await res.json()) as { broadcast: { id: number } };
        router.push(`/broadcast/${data.broadcast.id}`);
        router.refresh();
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Gagal membuat kampanye");
      }
    } catch {
      setError("Tidak dapat terhubung ke server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">
          Nama kampanye
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Promo 4 Oktober"
          required
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
      </label>
      <button
        type="submit"
        disabled={busy || contactCount === 0}
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        title={contactCount === 0 ? "Tambahkan kontak dulu" : undefined}
      >
        {busy ? "Membuat…" : `Buat (${contactCount} penerima)`}
      </button>
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
    </form>
  );
}
