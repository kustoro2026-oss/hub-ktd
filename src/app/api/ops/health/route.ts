// Pemantau kesehatan DB harian (dipanggil cron Vercel atau worker VPS).
// Logika penuh di @/lib/ops (runOpsHealthCheck) — dipakai bersama worker.
// Notif WA ke pemilik HANYA saat ada yang sakit — sehat = senyap.
import { NextResponse } from "next/server";
import { runOpsHealthCheck } from "@/lib/ops";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "forbidden" }, { status: 401 });
  }

  const { ok, issues } = await runOpsHealthCheck();
  if (!ok) {
    return NextResponse.json({ ok: false, issues }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
