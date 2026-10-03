// Kebijakan jeda bot: begitu admin membalas manual sebuah nomor (direction
// "out"), bot tidak ikut membalas otomatis selama BOT_HANDOVER_MINUTES menit
// (default 30) — percakapan dianggap sedang ditangani manusia. Setelah jeda
// habis, bot aktif kembali saat pelanggan mengirim pesan baru.
//
// File ini sengaja tanpa import agar mudah diuji langsung dengan node.

const DEFAULT_HANDOVER_MINUTES = 30;

/** Durasi jeda bot setelah balasan manual terakhir, dalam menit. */
export function botHandoverMinutes(): number {
  const v = Number(process.env.BOT_HANDOVER_MINUTES);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_HANDOVER_MINUTES;
}

/** "YYYY-MM-DD HH:MM:SS" (UTC, format kedua backend) → epoch ms. */
function ts(createdAt: string): number {
  return new Date(`${createdAt.replace(" ", "T")}Z`).getTime();
}

/** Pesan manual (direction = "out") terakhir dari daftar pesan. */
export function lastManualOut<
  T extends { direction: string; created_at: string },
>(msgs: T[]): T | undefined {
  let out: T | undefined;
  for (const m of msgs) {
    if (m.direction === "out" && (!out || ts(m.created_at) >= ts(out.created_at))) {
      out = m;
    }
  }
  return out;
}

/** Benar jika bot harus diam karena admin baru saja membalas manual. */
export function isBotHandoverActive(
  lastOut: { created_at: string } | undefined,
  now: Date = new Date(),
): boolean {
  if (!lastOut) return false;
  const ms = now.getTime() - ts(lastOut.created_at);
  return ms < botHandoverMinutes() * 60_000;
}

/** Epoch ms kapan jeda bot berakhir (untuk tampilan). */
export function handoverUntil(
  lastOut: { created_at: string } | undefined,
): number | undefined {
  if (!lastOut) return undefined;
  return ts(lastOut.created_at) + botHandoverMinutes() * 60_000;
}

/** Label "HH.MM WIB" kapan bot aktif lagi — hanya untuk tampilan. */
export function handoverUntilLabel(
  lastOut: { created_at: string } | undefined,
): string | undefined {
  const until = handoverUntil(lastOut);
  if (until === undefined) return undefined;
  const w = new Date(until + 7 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(w.getUTCHours())}.${p(w.getUTCMinutes())} WIB`;
}
