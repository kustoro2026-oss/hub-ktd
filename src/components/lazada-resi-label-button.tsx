"use client";

// Tombol "Unggah Label" per pesanan Lazada: pemilik memilih PDF label resmi
// yang diunduh dari Seller Center (Cetak AWB / Cetak Label) dan dokumen itu
// menjadi label yang disajikan tombol Cetak Resi dan Kirim Resi — karena
// label resmi pesanan kurir terintegrasi tidak bisa diambil lewat Open
// Platform.
import { useRef, useState } from "react";

export default function LazadaResiLabelButton({
  orderId,
}: {
  orderId: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "busy" | "ok" | "fail">("idle");
  const [detail, setDetail] = useState("");

  async function pilih(file: File) {
    setState("busy");
    setDetail("");
    try {
      const res = await fetch(`/api/lazada/resi/${orderId}/label`, {
        method: "POST",
        body: file,
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        catatan?: string;
        error?: string;
      };
      if (res.ok && data.ok) {
        setState("ok");
        setDetail(data.catatan ?? "tersimpan");
      } else {
        setState("fail");
        setDetail(data.error ?? `HTTP ${res.status}`);
      }
    } catch {
      setState("fail");
      setDetail("tidak dapat menghubungi server");
    }
  }

  if (state === "ok") {
    return (
      <span className="text-xs font-medium text-emerald-700" title={detail}>
        Label tersimpan
      </span>
    );
  }
  if (state === "fail") {
    return (
      <div className="max-w-48">
        <span className="text-xs font-medium text-rose-700">
          Gagal — coba lagi
        </span>
        {detail ? (
          <p className="mt-0.5 break-words text-xs leading-snug text-rose-600/90">
            {detail}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          if (f) void pilih(f);
          e.currentTarget.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={state === "busy"}
        title="Unggah PDF label resmi yang diunduh dari Lazada Seller Center"
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-500 hover:bg-slate-50 disabled:opacity-60"
      >
        {state === "busy" ? "Menyimpan..." : "Unggah Label"}
      </button>
    </>
  );
}
