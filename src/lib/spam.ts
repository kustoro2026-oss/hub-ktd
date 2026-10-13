// Kebijakan anti-spam bot WA — modul murni tanpa import agar bisa diuji
// langsung dengan node (seperti handover.ts).

/** Jendela pengamatan (menit): jumlah pesan masuk per nomor dihitung dalam
 *  rentang waktu ini. */
export const SPAM_WINDOW_MINUTES = 3;

/** Batas pesan masuk per nomor dalam satu jendela. Nomor yang mencapai
 *  batas ini dianggap spam: bot berhenti membalas dan AI tidak dipanggil
 *  sampai jumlah pesan di jendela turun kembali. Pembatasan bersifat
 *  stateless (dihitung dari tabel messages), jadi tidak perlu menyimpan
 *  status jeda per nomor. */
export const SPAM_MAX_MESSAGES = 8;

/** Keputusan pembatasan untuk satu pesan masuk — murni tanpa DB supaya
 *  mudah diuji:
 *  - "blocked": nomor diblokir admin → bot diam total (pesan tetap dicatat).
 *  - "spam"   : nomor membanjiri pesan → bot tidak membalas, AI tidak
 *               dipanggil (menghemat kredit).
 *  - null     : jawab normal.
 *  Pesanan (kind "order") dan cek status top-up (kind "topup") selalu
 *  lolos supaya orderan asli tidak pernah terlewat. */
export function spamDecision(
  kind: string,
  blocked: boolean,
  recentCount: number,
): "blocked" | "spam" | null {
  if (blocked) return "blocked";
  if (kind !== "order" && kind !== "topup" && recentCount >= SPAM_MAX_MESSAGES)
    return "spam";
  return null;
}
