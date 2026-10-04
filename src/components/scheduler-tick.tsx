"use client";

// Tick penjadwal: selama ada tab admin Hub yang terbuka, komponen ini
// memanggil endpoint penjadwal setiap menit supaya kampanye terjadwal
// terkirim tepat waktu walau tidak ada yang membuka halaman Broadcast.
// Endpointnya juga menolak bila sesi login sudah kedaluwarsa — aman.
import { useEffect } from "react";

const TICK_MS = 60_000;

export default function SchedulerTick() {
  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        await fetch("/api/broadcasts/scheduled/run", { method: "POST" });
      } catch {
        // Jaringan sementara — tick berikutnya akan mencoba lagi.
      }
    }

    tick();
    const timer = setInterval(() => {
      if (!cancelled) tick();
    }, TICK_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return null;
}
