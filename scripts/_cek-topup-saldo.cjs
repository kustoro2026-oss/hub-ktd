// Verifikasi keamanan top-up (KTD Store) + saldo Aneka (KTD Hub) di produksi.
// Tanpa mencetak secret. Menggunakan rahasia dari .env.local (TOPUP_ADMIN_SECRET
// hub terbukti cocok dengan produksi store; CRON_SECRET store disamakan hub).
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

async function cek(label, url, headers, potong = 400) {
  try {
    const r = await fetch(url, { headers });
    const body = await r.text();
    const bersih = body.replace(/\s+/g, " ").slice(0, potong);
    console.log(`${label}\n  HTTP ${r.status} | ${bersih}`);
  } catch (e) {
    console.log(`${label}\n  ERROR ${e.message}`);
  }
}

(async () => {
  // 1) Daftar order top-up store (bukti pembayaran + eksekusi tercatat di DB).
  await cek(
    "[store] daftar order top-up",
    "https://toko.kustoro2026.com/api/topup/orders",
    { "x-topup-secret": hubEnv.TOPUP_ADMIN_SECRET },
  );
  // 2) Saldo Digiflazz live (API Digiflazz produksi, kunci terkonfigurasi).
  await cek(
    "[store] saldo Digiflazz live",
    "https://toko.kustoro2026.com/api/topup/cek-saldo",
    { "x-topup-secret": hubEnv.TOPUP_ADMIN_SECRET },
  );
  // 3) Cron cek-saldo store (job harian: saldo + peringatan + snapshot kesehatan).
  await cek(
    "[store] cron cek-saldo (job harian)",
    "https://toko.kustoro2026.com/api/topup/cron/cek-saldo",
    { authorization: `Bearer ${hubEnv.CRON_SECRET}` },
  );
  // 4) Refresh snapshot keuangan Aneka (saldo wallet Aneka untuk eksekusi otomatis).
  console.log("[hub] refresh keuangan Aneka — bisa memakan waktu ~30 detik...");
  await cek(
    "[hub] snapshot saldo Aneka",
    "https://admin.kustoro2026.com/api/keuangan/refresh",
    { authorization: `Bearer ${hubEnv.CRON_SECRET}` },
    600,
  );
})();
