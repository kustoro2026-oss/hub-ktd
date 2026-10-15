// Hapus env Neon mati dari project Vercel hub (sisa integrasi Neon).
// PENGAMAN: sebelum menghapus DATABASE_URL/POSTGRES_URL, pastikan
// SUPABASE_DATABASE_URL benar-benar ada (kunci DB hidup saat ini).
const fs = require("fs");
const path = require("path");
const env = {};
// .env.local berada di root repo jakmall-clone (induk), bukan di ktd-hub.
const envPath = path.resolve(__dirname, "../../.env.local");
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}
const TOKEN = env.VERCEL_TOKEN;
const TEAM = "team_g8llylGhpic6hXYNARE0EnNr";
const HUB = "prj_qwhJO9tIekMnbaTX8uyGLp2XCrIW"; // hub-ktd
const STORE = "prj_fq6nkXIHKRLsa9fylq78h6PpleyC"; // toko-ktd

const DEAD = new Set([
  "DATABASE_URL", "POSTGRES_URL", "POSTGRES_URL_NON_POOLING",
  "POSTGRES_URL_NO_SSL", "POSTGRES_PRISMA_URL", "DATABASE_URL_UNPOOLED",
  "PGHOST", "PGHOST_UNPOOLED", "PGPASSWORD", "PGUSER", "PGDATABASE",
  "POSTGRES_HOST", "POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DATABASE",
  "NEON_PROJECT_ID", "NEON_AUTH_BASE_URL", "VITE_NEON_AUTH_URL",
]);

async function listEnv(project) {
  const res = await fetch(
    `https://api.vercel.com/v9/projects/${project}/env?teamId=${TEAM}`,
    { headers: { authorization: `Bearer ${TOKEN}` } },
  );
  const data = await res.json();
  return data.envs ?? [];
}

(async () => {
  // 1) Project HUB
  const hubEnvs = await listEnv(HUB);
  const keys = hubEnvs.map((e) => e.key);
  const supabase = hubEnvs.find((e) => e.key === "SUPABASE_DATABASE_URL");
  if (!supabase) {
    console.error(
      "ABORT: SUPABASE_DATABASE_URL tidak ditemukan di project hub. Jangan hapus apa pun.",
    );
    process.exit(1);
  }
  console.log(
    `PENGAMAN OK: SUPABASE_DATABASE_URL ada (${supabase.id}) — database hidup aman.`,
  );
  const targets = hubEnvs.filter((e) => DEAD.has(e.key));
  console.log("kandidat hapus hub:", targets.map((e) => e.key).join(", "));
  for (const e of targets) {
    const del = await fetch(
      `https://api.vercel.com/v9/projects/${HUB}/env/${e.id}?teamId=${TEAM}`,
      { method: "DELETE", headers: { authorization: `Bearer ${TOKEN}` } },
    );
    console.log(`hapus ${e.key} (${e.id}) → HTTP ${del.status}`);
    if (!del.ok) {
      const body = await del.text();
      console.log("  body:", body.slice(0, 200));
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  // 2) Project STORE — hanya lapor; hapus hanya NEON_* yang jelas mati.
  const storeEnvs = await listEnv(STORE);
  console.log("--- env project STORE (nilai disamarkan) ---");
  for (const e of storeEnvs) {
    const val = e.value ?? "";
    const asal = val.includes("neon")
      ? "NEON"
      : val.includes("supabase")
        ? "SUPABASE"
        : "-";
    const masked =
      val.slice(0, 12) + (val.length > 12 ? "..." : "") + ` [${asal}]`;
    console.log(`  ${e.key} (${e.id}) = ${masked}`);
  }
  const storeDead = storeEnvs.filter(
    (e) => e.key.startsWith("NEON_") || e.key === "VITE_NEON_AUTH_URL",
  );
  for (const e of storeDead) {
    const del = await fetch(
      `https://api.vercel.com/v9/projects/${STORE}/env/${e.id}?teamId=${TEAM}`,
      { method: "DELETE", headers: { authorization: `Bearer ${TOKEN}` } },
    );
    console.log(`hapus ${e.key} (${e.id}) → HTTP ${del.status}`);
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log("selesai");
})();
