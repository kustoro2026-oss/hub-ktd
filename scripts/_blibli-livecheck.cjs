// Uji produksi: panggil /api/blibli/resi/check dengan CRON_SECRET dari
// .env.local (nilai tidak dicetak). Mode baseline = tandai pesanan lama
// tanpa kirim WA — aman dan idempoten.
const fs = require("fs");
const path = require("path");

const raw = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
let secret = "";
for (const line of raw.split(/\r?\n/)) {
  const m = /^\s*CRON_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) {
    secret = m[1].trim().replace(/^"|"$/g, "");
    break;
  }
}
if (!secret) {
  console.log("NO_CRON_SECRET");
  process.exit(1);
}

(async () => {
  const url = `https://admin.kustoro2026.com/api/blibli/resi/check?secret=${encodeURIComponent(secret)}`;
  const r = await fetch(url, { redirect: "manual" });
  const body = await r.text();
  console.log("status:", r.status);
  console.log("body:", body.slice(0, 500));
})();
