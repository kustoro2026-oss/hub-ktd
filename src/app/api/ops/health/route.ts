// Pemantau kesehatan DB harian (dipanggil cron Vercel):
//  - SELECT 1 di DB hub
//  - SELECT 1 di DB toko lewat STORE_DATABASE_URL
//  - probe endpoint orders toko (lapisan aplikasi + CDN)
// Notif WA ke pemilik HANYA saat ada yang sakit — sehat = senyap.
import { NextResponse } from "next/server";
import { opsHealthCheck } from "@/lib/db";
import { ownerNumber, sendText, nowWib } from "@/lib/wa";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "forbidden" }, { status: 401 });
  }

  const issues: string[] = [];

  try {
    await opsHealthCheck();
  } catch (e) {
    issues.push(`DB hub: ${e instanceof Error ? e.message : "SELECT 1 gagal"}`);
  }

  const storeUrl = (process.env.STORE_DATABASE_URL ?? "").trim();
  if (!storeUrl) {
    issues.push("STORE_DATABASE_URL belum diatur");
  } else {
    try {
      const { Pool } = await import("pg");
      const pool = new Pool({
        connectionString: storeUrl,
        ssl: { rejectUnauthorized: false },
      });
      try {
        await pool.query("SELECT 1");
      } finally {
        await pool.end();
      }
    } catch (e) {
      issues.push(
        `DB toko: ${e instanceof Error ? e.message : "SELECT 1 gagal"}`,
      );
    }
  }

  try {
    const res = await fetch("https://toko.kustoro2026.com/api/topup/orders", {
      headers: { "x-topup-secret": process.env.TOPUP_ADMIN_SECRET ?? "" },
      cache: "no-store",
    });
    const j = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    if (!res.ok || !j || j.ok !== true) {
      issues.push(`API toko /orders: HTTP ${res.status} tanpa ok:true`);
    }
  } catch (e) {
    issues.push(
      `API toko /orders: ${
        e instanceof Error ? e.message : "tidak terjangkau"
      }`,
    );
  }

  if (issues.length) {
    const owner = ownerNumber();
    if (owner) {
      await sendText(
        owner,
        `[Pemantau DB] ${nowWib()}\n${issues.map((i) => `- ${i}`).join("\n")}`,
      );
    }
    return NextResponse.json({ ok: false, issues }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
