"use client";

// Tombol "Atur Pengiriman" per paket pesanan Blibli: konfirmasi fulfill
// (tandai siap kirim) untuk paket berstatus FP (Pesanan Baru), persis
// seperti menu "Atur Pengiriman" di aplikasi TikTok Shop. Untuk Dropship
// Cashless, AWB sudah dibuat Blibli dan dikirim otomatis; bila kosong,
// pengguna diminta mengisi nomor AWB dari kurir.
import { useState } from "react";

export default function BlibliResiShipButton({
  packageId,
  awbNo,
}: {
  packageId: string;
  awbNo: string;
}) {
  const [state, setState] = useState<"idle" | "busy" | "ok" | "fail">("idle");
  const [detail, setDetail] = useState("");

  async function ship(awb?: string) {
    setState("busy");
    setDetail("");
    try {
      const res = await fetch("/api/blibli/ship", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package_id: packageId, awb_no: awb ?? "" }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        result?: string;
        error?: string;
        butuhAwb?: boolean;
      };
      if (data.ok) {
        setState("ok");
        setDetail(data.result ?? "dikonfirmasi");
      } else {
        // AWB wajib untuk Dropship — minta nomor dari pengguna lalu coba lagi.
        if (data.butuhAwb) {
          const input = window.prompt(
            "Isi nomor AWB (resi) dari kurir untuk paket ini:",
            "",
          );
          if (input && input.trim() !== "") {
            return ship(input.trim());
          }
          setState("idle");
          return;
        }
        setState("fail");
        setDetail(data.result ?? data.error ?? `HTTP ${res.status}`);
      }
    } catch {
      setState("fail");
      setDetail("tidak dapat menghubungi server");
    }
  }

  if (state === "ok") {
    return (
      <span className="text-xs font-medium text-emerald-700" title={detail}>
        Dikonfirmasi ✓
      </span>
    );
  }
  if (state === "fail") {
    return (
      <div className="max-w-48">
        <span className="text-xs font-medium text-rose-700">Gagal — coba lagi</span>
        {detail ? (
          <p className="mt-0.5 break-words text-xs leading-snug text-rose-600/90">
            {detail}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => ship(awbNo)}
      disabled={state === "busy"}
      className="rounded-lg border border-sky-300 px-3 py-1.5 text-xs font-medium text-sky-700 transition hover:bg-sky-50 disabled:opacity-60"
    >
      {state === "busy" ? "Mengonfirmasi..." : "Atur Pengiriman"}
    </button>
  );
}
