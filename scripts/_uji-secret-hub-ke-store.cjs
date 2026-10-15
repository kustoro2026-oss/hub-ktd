// Uji: apakah nilai TOPUP_ADMIN_SECRET milik Vercel HUB (encrypted → bisa
// dibaca) diterima oleh API store prod? Tidak mencetak nilai.
const fs = require("fs");
const path = require("path");

const env = {};
for (const line of fs
  .readFileSync(path.resolve(__dirname, "../../.env.local"), "utf8")
  .split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}
const TOKEN = env.VERCEL_TOKEN;
const TEAM = "team_g8llylGhpic6hXYNARE0EnNr";
const HUB = "prj_qwhJO9tIekMnbaTX8uyGLp2XCrIW";

(async () => {
  const listRes = await fetch(
    `https://api.vercel.com/v9/projects/${HUB}/env?teamId=${TEAM}`,
    { headers: { authorization: `Bearer ${TOKEN}` } },
  );
  const list = await listRes.json();
  const h = (list.envs ?? []).find((e) => e.key === "TOPUP_ADMIN_SECRET");
  if (!h) {
    console.log("TOPUP_ADMIN_SECRET tidak ada di Vercel hub");
    return;
  }
  const satu = await fetch(
    `https://api.vercel.com/v9/projects/${HUB}/env/${h.id}?teamId=${TEAM}`,
    { headers: { authorization: `Bearer ${TOKEN}` } },
  );
  const hubVal = (await satu.json()).value ?? "";
  console.log("nilai hub terisi:", hubVal.length > 0, "| panjang:", hubVal.length);

  const r = await fetch("https://toko.kustoro2026.com/api/topup/cek-saldo", {
    headers: { "x-topup-secret": hubVal },
  });
  const body = await r.text();
  console.log(
    "store prod menerima secret hub →",
    `HTTP ${r.status} | ${body.slice(0, 120)}`,
  );
})();
