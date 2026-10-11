// Cetak URL lengkap untuk cron-job.org (CRON_SECRET dari .env.local).
const fs = require("fs");
const path = require("path");
const raw = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
let s = "";
for (const l of raw.split(/\r?\n/)) {
  const m = /^\s*CRON_SECRET\s*=\s*(.*)$/.exec(l);
  if (m) {
    s = m[1].trim().replace(/^"|"$/g, "");
    break;
  }
}
console.log("https://admin.kustoro2026.com/api/blibli/resi/check?secret=" + encodeURIComponent(s));
