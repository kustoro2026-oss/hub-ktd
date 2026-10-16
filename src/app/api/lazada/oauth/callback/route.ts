import { NextRequest } from "next/server";
import { exchangeLazadaAuthCode } from "@/lib/lazada";
import { saveLazadaSellerToken } from "@/lib/db";

// Endpoint redirect OAuth aplikasi "KTD Hub" (Lazada Open Platform,
// Seller In-house APP). Dibuka oleh Lazada setelah penjual menyetujui
// akses: ?code=<auth_code> — token ditukar lalu disimpan untuk Hub.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const code = sp.get("code") ?? "";

  if (code === "") {
    const err = sp.get("error") ?? "";
    return page(
      false,
      err !== ""
        ? `Otorisasi ditolak atau dibatalkan (${err}).`
        : "URL tidak memuat kode otorisasi (code).",
    );
  }

  const res = await exchangeLazadaAuthCode(code);
  if (!res.ok) return page(false, res.detail);

  await saveLazadaSellerToken({
    seller_id: res.seller_id,
    short_code: res.short_code,
    country: res.country,
    account: res.account,
    access_token: res.access_token,
    refresh_token: res.refresh_token,
    expires_at: res.expires_at,
    refresh_expires_at: res.refresh_expires_at,
  });

  return page(
    true,
    `Token tersimpan untuk toko Lazada "${res.short_code || res.account}" (seller ${res.seller_id}). KTD Hub kini dapat membaca pesanan Lazada.`,
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function page(ok: boolean, msg: string): Response {
  return new Response(
    `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KTD Hub — Otorisasi Lazada</title></head><body style="font-family:system-ui,sans-serif;padding:24px;max-width:640px;margin:0 auto"><h2>${ok ? "Otorisasi berhasil" : "Otorisasi gagal"}</h2><p>${escapeHtml(msg)}</p><p><a href="/">Kembali ke KTD Hub</a></p></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
