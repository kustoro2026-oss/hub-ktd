// Helper tampilan untuk halaman chat Pesan Masuk — format nomor, jam, dan
// label tanggal ala aplikasi WhatsApp.

/** Nomor tersimpan "628xxxxxxxxxx" → tampilan "+62 8xx-xxxx-xxxx". */
export function formatWa(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length < 6) return phone;
  return `+${d.slice(0, 2)} ${d.slice(2, 5)}-${d.slice(5, 9)}-${d.slice(9)}`.trim();
}

/** "YYYY-MM-DD HH:MM:SS" → "HH.MM" (format jam WhatsApp). */
export function timeHM(createdAt: string): string {
  const t = createdAt.slice(11, 16);
  return t ? t.replace(":", ".") : createdAt;
}

/** Label pembatas hari: "Hari ini" / "Kemarin" / "DD/MM/YYYY". */
export function dayLabel(createdAt: string): string {
  const datePart = createdAt.slice(0, 10);
  if (!datePart) return "";
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  if (datePart === `${y}-${m}-${d}`) return "Hari ini";
  const yesterday = new Date(today.getTime() - 24 * 3600 * 1000);
  const yy = yesterday.getFullYear();
  const mm = String(yesterday.getMonth() + 1).padStart(2, "0");
  const dd = String(yesterday.getDate()).padStart(2, "0");
  if (datePart === `${yy}-${mm}-${dd}`) return "Kemarin";
  const [yyy, mmm, ddd] = datePart.split("-");
  return `${ddd}/${mmm}/${yyy}`;
}
