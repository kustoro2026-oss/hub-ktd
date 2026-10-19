"use client";

// Tick penjadwal: selama ada tab admin Hub yang terbuka, komponen ini
// memanggil endpoint penjadwal setiap menit supaya kampanye terjadwal
// (broadcast WhatsApp + kampanye email) terkirim tepat waktu walau tidak
// ada yang membuka halaman Broadcast, dan endpoint pengecekan pesanan
// TikTok/Blibli/Lazada baru supaya resi PDF otomatis segera terkirim ke
// WA pemilik. Endpointnya juga menolak bila sesi login sudah kedaluwarsa —
// aman.
import { useEffect } from "react";

const TICK_MS = 60_000;

/** Panggil endpoint, abaikan kegagalan jaringan — tick berikut mencoba lagi. */
async function postSilently(url: string) {
  try {
    await fetch(url, { method: "POST" });
  } catch {
    // Jaringan sementara — tick berikutnya akan mencoba lagi.
  }
}

export default function SchedulerTick() {
  useEffect(() => {
    let cancelled = false;

    async function tick() {
      await postSilently("/api/broadcasts/scheduled/run");
      await postSilently("/api/email/campaigns/scheduled/run");
      await postSilently("/api/tiktok/resi/check");
      await postSilently("/api/blibli/resi/check");
      await postSilently("/api/lazada/resi/check");
      // Tahap 4: order selesai → kurangi stok di semua kanal lain.
      await postSilently("/api/aneka/stok/check");
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
