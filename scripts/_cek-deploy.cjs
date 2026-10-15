// Cek status deploy terbaru hub-ktd + toko-ktd via REST API Vercel.
const fs = require("fs");
const path = require("path");
const env = {};
const envPath = path.resolve(__dirname, "../../.env.local");
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}
const TOKEN = env.VERCEL_TOKEN;
const TEAM = "team_g8llylGhpic6hXYNARE0EnNr";

async function api(p) {
  const sep = p.includes("?") ? "&" : "?";
  const r = await fetch(`https://api.vercel.com${p}${sep}teamId=${TEAM}`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}

(async () => {
  for (const [nama, id] of [
    ["HUB", "prj_qwhJO9tIekMnbaTX8uyGLp2XCrIW"],
    ["STORE", "prj_fq6nkXIHKRLsa9fylq78h6PpleyC"],
  ]) {
    const deps = await api(`/v6/deployments?projectId=${id}&limit=3`);
    console.log(`=== ${nama} ===`);
    for (const d of deps.deployments ?? []) {
      console.log(
        ` ${d.state.padEnd(10)} sha=${(d.meta?.githubCommitSha ?? "").slice(0, 8)}` +
          ` ${d.uid.slice(0, 10)} created=${d.createdAt}`,
      );
    }
  }
})();
