// Autentikasi admin KTD Hub — satu password (env AUTH_PASSWORD) + cookie
// sesi yang ditandatangani HMAC (env AUTH_SECRET). Sederhana dan cukup untuk
// dashboard internal; upgrade ke multi-user jika tim bertambah.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import crypto from "node:crypto";

export const SESSION_COOKIE = "ktd_hub_session";
const SESSION_DAYS = 7;

function sign(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/** Nilai cookie sesi untuk user admin (dibuat saat login sukses). */
export function buildSessionValue(secret: string): string {
  const expiry = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = `admin:${expiry}`;
  return `${payload}.${sign(payload, secret)}`;
}

export async function isAuthed(): Promise<boolean> {
  const secret = process.env.AUTH_SECRET;
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!secret || !raw) return false;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return false;
  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  if (sign(payload, secret) !== sig) return false;
  const expiry = Number(payload.split(":")[1]);
  return Number.isFinite(expiry) && expiry > Date.now();
}

/** Dipanggil di halaman server: alihkan ke /login bila belum masuk. */
export async function requireAuth(): Promise<void> {
  if (!(await isAuthed())) redirect("/login");
}
