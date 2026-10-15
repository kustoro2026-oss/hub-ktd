// Pasang CRON_SECRET di project Vercel STORE (sebelumnya tidak ada →
// cron Vercel store selalu 403). Nilai disamakan dengan CRON_SECRET hub
// (praktik berbagi secret antar project milik sendiri, sama seperti
// TOPUP_ADMIN_SECRET). Perubahan env otomatis memicu redeploy Vercel.
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
const parentEnv = bacaEnv(path.resolve(__dirname, "../../.env.local"));

const TOKEN = parentEnv.VERCEL_TOKEN;
const TEAM = "team_g8llylGhpic6hXYNARE0EnNr";
const STORE = "prj_fq6nkXIHKRLsa9fylq78h6PpleyC";

(async () => {
  // Cek dulu: mungkin CRON_SECRET sudah ada (jangan ganda).
  const listRes = await fetch(
    `https://api.vercel.com/v9/projects/${STORE}/env?teamId=${TEAM}`,
    { headers: { authorization: `Bearer ${TOKEN}` } },
  );
  const list = await listRes.json();
  const ada = (list.envs ?? []).find((e) => e.key === "CRON_SECRET");
  if (ada) {
    console.log("CRON_SECRET sudah ada di store (tidak diubah). id:", ada.id);
    return;
  }
  const res = await fetch(
    `https://api.vercel.com/v9/projects/${STORE}/env?teamId=${TEAM}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        key: "CRON_SECRET",
        value: hubEnv.CRON_SECRET,
        type: "encrypted",
        target: ["production", "preview", "development"],
      }),
    },
  );
  const j = await res.json();
  console.log(
    `POST CRON_SECRET → HTTP ${res.status}`,
    JSON.stringify(j).slice(0, 200),
  );
  if (res.ok) {
    console.log(
      "OK: env terpasang. Vercel otomatis redeploy store — tunggu READY lalu tes cron/pending.",
    );
  }
})();
