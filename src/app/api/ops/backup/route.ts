// Backup mingguan KTD Hub + KTD Store (dipanggil cron Vercel atau worker VPS).
// Logika penuh di @/lib/ops (runOpsWeeklyBackup) — dipakai bersama worker.
// Guard: header Authorization = Bearer CRON_SECRET (otomatis dari cron Vercel).
import { NextResponse } from "next/server";
import { runOpsWeeklyBackup } from "@/lib/ops";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "forbidden" }, { status: 401 });
  }

  const { ok, message } = await runOpsWeeklyBackup();
  if (!ok) {
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, message });
}
