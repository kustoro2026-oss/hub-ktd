// Redeploy paksa project STORE (env CRON_SECRET baru hanya aktif setelah deploy).
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const parentEnv = {};
for (const line of fs
  .readFileSync(path.resolve(__dirname, "../../.env.local"), "utf8")
  .split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) parentEnv[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}
const TOKEN = parentEnv.VERCEL_TOKEN;
const TEAM = "team_g8llylGhpic6hXYNARE0EnNr";
const STORE = "prj_fq6nkXIHKRLsa9fylq78h6PpleyC";

const sha = execSync("git rev-parse HEAD", {
  cwd: path.resolve(__dirname, "../.."),
})
  .toString()
  .trim();
console.log("HEAD sha store:", sha);

(async () => {
  // Info project: nama + repoId github.
  const infoRes = await fetch(
    `https://api.vercel.com/v9/projects/${STORE}?teamId=${TEAM}`,
    { headers: { authorization: `Bearer ${TOKEN}` } },
  );
  const info = await infoRes.json();
  const repoId = info.link?.repoId;
  console.log("project:", info.name, "| repoId:", repoId);
  if (!repoId) throw new Error("repoId tidak ditemukan");

  const r = await fetch(`https://api.vercel.com/v13/deployments?teamId=${TEAM}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: info.name,
      target: "production",
      project: STORE,
      gitSource: { type: "github", repoId, ref: "main", sha },
    }),
  });
  const j = await r.json();
  console.log("HTTP", r.status, "| uid:", j.id ?? j.uid ?? JSON.stringify(j).slice(0, 300));
})();
