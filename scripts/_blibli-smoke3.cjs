// Debug 401: baca CRON_SECRET dari .env.local, panggil route TikTok & Blibli.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const raw = fs.readFileSync(path.join(root, ".env.local"), "utf8");
let secret = "";
for (const line of raw.split(/\r?\n/)) {
  const m = /^\s*CRON_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) {
    secret = m[1].trim().replace(/^"|"$/g, "");
    break;
  }
}
console.log("secret len:", secret.length);
if (!secret) process.exit(1);

async function probe(name, url) {
  try {
    const r = await fetch(url);
    const body = await r.text();
    console.log(name, "->", r.status, body.slice(0, 300));
  } catch (e) {
    console.log(name, "ERROR", String(e));
  }
}

(async () => {
  await probe("tiktok", `http://localhost:3000/api/tiktok/resi/check?secret=${encodeURIComponent(secret)}`);
  await probe("blibli", `http://localhost:3000/api/blibli/resi/check?secret=${encodeURIComponent(secret)}`);
})();
