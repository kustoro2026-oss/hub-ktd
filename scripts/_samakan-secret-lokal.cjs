// Samakan TOPUP_ADMIN_SECRET di kedua .env.local LOKAL dengan nilai Vercel
// hub (terbukti cocok dengan store prod — HTTP 200). Hanya file lokal,
// produksi tidak disentuh. Tidak mencetak nilai.
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
  const satu = await fetch(
    `https://api.vercel.com/v9/projects/${HUB}/env/${h.id}?teamId=${TEAM}`,
    { headers: { authorization: `Bearer ${TOKEN}` } },
  );
  const prod = (await satu.json()).value;
  if (!prod) {
    console.log("nilai prod kosong — BATAL");
    process.exit(1);
  }

  for (const file of [
    path.resolve(__dirname, "../.env.local"),
    path.resolve(__dirname, "../../.env.local"),
  ]) {
    const isi = fs.readFileSync(file, "utf8");
    const lama = /^(\s*TOPUP_ADMIN_SECRET\s*=\s*)(.*)$/m.exec(isi);
    const baru = isi.replace(
      /^(\s*TOPUP_ADMIN_SECRET\s*=\s*).*$/m,
      `$1${prod}`,
    );
    const sama = lama && lama[2].replace(/^"(.*)"$/, "$1") === prod;
    if (sama) {
      console.log(`${file} — sudah cocok, dilewati`);
    } else if (baru !== isi) {
      fs.writeFileSync(file, baru);
      console.log(`${file} — diperbarui`);
    } else {
      console.log(`${file} — pola baris tidak ditemukan`);
    }
  }
})();
