"use client";

// Tick penjadwal: selama ada tab admin Hub yang terbuka, komponen ini
// memanggil endpoint penjadwal supaya kampanye terjadwal (broadcast WhatsApp
// + kampanye email) terkirim tepat waktu walau tidak ada yang membuka halaman
// Broadcast, dan endpoint pengecekan pesanan TikTok/Blibli/Lazada baru supaya
// resi PDF otomatis segera terkirim ke WA pemilik. Dua irama: endpoint ringan
// (broadcast + email) tiap menit; pengecekan pesanan + stok tiap 5 menit —
// query-nya lebih berat sehingga menekan kuota egress database. Endpointnya
// juga menolak bila sesi login sudah kedaluwarsa — aman.
import { useEffect } from "react";

const TICK_CEPAT_MS = 60_000; // broadcast + email (query ringan)
const TICK_LAMBAT_MS = 300_000; // cek resi + stok (query lebih berat)

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

    async function tickCepat() {
      await postSilently("/api/broadcasts/scheduled/run");
      await postSilently("/api/email/campaigns/scheduled/run");
    }

    async function tickLambat() {
      await postSilently("/api/tiktok/resi/check");
      await postSilently("/api/blibli/resi/check");
      await postSilently("/api/lazada/resi/check");
      // Tahap 4: order selesai → kurangi stok di semua kanal lain.
      await postSilently("/api/aneka/stok/check");
    }

    tickCepat();
    tickLambat();
    const timerCepat = setInterval(() => {
      if (!cancelled) tickCepat();
    }, TICK_CEPAT_MS);
    const timerLambat = setInterval(() => {
      if (!cancelled) tickLambat();
    }, TICK_LAMBAT_MS);

    return () => {
      cancelled = true;
      clearInterval(timerCepat);
      clearInterval(timerLambat);
    };
  }, []);

  return null;
}
