// Cek status verifikasi Meta via Graph API (read-only).
// Token dibaca dari .env.local — TIDAK dicetak ke konsol.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envRaw = readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
const env = {};
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
  if (m) env[m[1]] = m[2];
}
const TOKEN = env.WA_TOKEN;
const PHONE_ID = env.WA_PHONE_NUMBER_ID;
const WABA_ID = env.WA_WABA_ID;
const V = "v24.0";

async function graph(pathname) {
  const url = `https://graph.facebook.com/${V}${pathname}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* bukan JSON */ }
  return { status: res.status, json, text };
}

const out = {};
try {
  // 1) Status nomor API (display name, tier, OBA)
  const fields = [
    "display_phone_number", "verified_name", "name_status",
    "new_display_name", "new_name_status", "quality_rating",
    "whatsapp_business_manager_messaging_limit", "is_official_business_account",
    "status", "throughput",
  ].join(",");
  const p = await graph(`/${PHONE_ID}?fields=${fields}`);
  out.phone = { http: p.status, data: p.json };

  // 2) WABA
  const w = await graph(`/${WABA_ID}?fields=id,name,timezone_id,currency`);
  out.waba = { http: w.status, data: w.json };

  // 3) Daftar bisnis yang bisa diakses token (verifikasi portofolio)
  const b = await graph(`/me/businesses?fields=id,name,verification_status`);
  out.businesses = { http: b.status, data: b.json };
} catch (e) {
  out.fatal = String(e && e.message ? e.message : e);
}
console.log(JSON.stringify(out, null, 2));
