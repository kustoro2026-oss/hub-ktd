// Verifikasi rute produksi pasca-fix Bearer + kesehatan DB (tanpa mencetak secret).
const fs = require("fs");
const path = require("path");

function bacaEnv(file) {
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return env;
}
const hubEnv = bacaEnv(path.resolve(__dirname, "../.env.local"));
const storeEnv = bacaEnv(path.resolve(__dirname, "../../.env.local"));

async function cek(label, url, headers) {
  try {
    const r = await fetch(url, { headers });
    const body = await r.text();
    console.log(
      `${label}\n  HTTP ${r.status} | ${body.slice(0, 180).replace(/\s+/g, " ")}`,
    );
  } catch (e) {
    console.log(`${label}\n  ERROR ${e.message}`);
  }
}

(async () => {
  // 1) Hub: cron broadcasts dengan Authorization Bearer (sebelumnya pasti 403).
  await cek(
    "[hub broadcasts + Bearer (fix baru)]",
    "https://admin.kustoro2026.com/api/cron/broadcasts",
    { authorization: `Bearer ${hubEnv.CRON_SECRET}` },
  );
  // 2) Hub: guard tetap menolak secret salah.
  await cek(
    "[hub broadcasts + secret salah → harus 403]",
    "https://admin.kustoro2026.com/api/cron/broadcasts",
    { authorization: "Bearer salah123" },
  );
  // 3) Hub: kesehatan DB hub + store.
  await cek(
    "[hub ops/health (SELECT 1 hub + store)]",
    "https://admin.kustoro2026.com/api/ops/health",
    { authorization: `Bearer ${hubEnv.CRON_SECRET}` },
  );
  // 4) Store: cron pending dengan Bearer — CRON_SECRET store produksi kini
  //    disamakan dengan hub (dipasang via _set-store-cron-secret.cjs).
  await cek(
    "[store cron/pending + Bearer]",
    "https://toko.kustoro2026.com/api/topup/cron/pending",
    { authorization: `Bearer ${hubEnv.CRON_SECRET}` },
  );
  // 5) Store: guard cron/cek-saldo tetap menolak secret salah.
  await cek(
    "[store cron/cek-saldo + secret salah → harus 403]",
    "https://toko.kustoro2026.com/api/topup/cron/cek-saldo",
    { authorization: "Bearer salah123" },
  );
})();
