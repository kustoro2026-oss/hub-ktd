// Login admin KTD Hub — bandingkan password dengan AUTH_PASSWORD, lalu set
// cookie sesi bertanda tangan HMAC (AUTH_SECRET) selama 7 hari.
import { cookies } from "next/headers";
import { buildSessionValue, SESSION_COOKIE } from "@/lib/auth";

export async function POST(request: Request) {
  let body: { password?: string } = {};
  try {
    body = (await request.json()) as { password?: string };
  } catch {
    // body kosong — lanjut ke penolakan di bawah
  }
  const expected = process.env.AUTH_PASSWORD;
  const secret = process.env.AUTH_SECRET;
  if (!expected || !secret || !body.password || body.password !== expected) {
    return Response.json({ ok: false, error: "Password salah" }, { status: 401 });
  }

  const value = buildSessionValue(secret);
  const expiry = Number(value.split(".")[0].split(":")[1]);
  const store = await cookies();
  store.set(SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiry),
  });

  return Response.json({ ok: true });
}
