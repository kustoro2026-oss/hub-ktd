// Helper tampilan untuk halaman chat Pesan Masuk — format nomor, jam, dan
// label tanggal ala aplikasi WhatsApp. Timestamp di database adalah UTC
// ("YYYY-MM-DD HH:MM:SS") — semua tampilan dikonversi ke WIB (UTC+7).

/** Nomor tersimpan "628xxxxxxxxxx" → tampilan "+62 8xx-xxxx-xxxx". */
export function formatWa(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length < 6) return phone;
  return `+${d.slice(0, 2)} ${d.slice(2, 5)}-${d.slice(5, 9)}-${d.slice(9)}`.trim();
}

/** "YYYY-MM-DD HH:MM:SS" (UTC) → string yang sama dalam WIB (UTC+7). */
export function toWib(createdAt: string): string {
  const t = new Date(`${createdAt.replace(" ", "T")}Z`);
  if (Number.isNaN(t.getTime())) return createdAt;
  const w = new Date(t.getTime() + 7 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${w.getUTCFullYear()}-${p(w.getUTCMonth() + 1)}-${p(w.getUTCDate())} ${p(w.getUTCHours())}:${p(w.getUTCMinutes())}:${p(w.getUTCSeconds())}`;
}

/** "YYYY-MM-DD HH:MM:SS" → "HH.MM" WIB (format jam WhatsApp). */
export function timeHM(createdAt: string): string {
  const t = toWib(createdAt).slice(11, 16);
  return t ? t.replace(":", ".") : createdAt;
}

/** Label pembatas hari: "Hari ini" / "Kemarin" / "DD/MM/YYYY" (WIB). */
export function dayLabel(createdAt: string): string {
  const datePart = toWib(createdAt).slice(0, 10);
  if (!datePart) return "";
  const wibNow = new Date(Date.now() + 7 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  const today = `${wibNow.getUTCFullYear()}-${p(wibNow.getUTCMonth() + 1)}-${p(wibNow.getUTCDate())}`;
  if (datePart === today) return "Hari ini";
  const yest = new Date(wibNow.getTime() - 24 * 3600 * 1000);
  const yesterday = `${yest.getUTCFullYear()}-${p(yest.getUTCMonth() + 1)}-${p(yest.getUTCDate())}`;
  if (datePart === yesterday) return "Kemarin";
  const [y, m, d] = datePart.split("-");
  return `${d}/${m}/${y}`;
}
