// Cek status deployment SATU KALI (uid via argv).
const fs = require("fs");
const t = fs
  .readFileSync("c:/Users/exe/Documents/clonejackmal/jakmall-clone/.env.local", "utf8")
  .replace(/^\uFEFF/, "");
const m = /^\s*VERCEL_TOKEN\s*=\s*(.*)\s*$/.exec(
  t.split(/\r?\n/).find((l) => l.startsWith("VERCEL_TOKEN")),
);
const token = m[1].replace(/^["']|["']$/g, "");
const UID = process.argv[2];
const TEAM = "komet-s-projects";
(async () => {
  const teams = await (
    await fetch("https://api.vercel.com/v2/teams?limit=50", {
      headers: { Authorization: "Bearer " + token },
    })
  ).json();
  const team = teams.teams.find((x) => x.slug === TEAM);
  const d = await (
    await fetch(
      "https://api.vercel.com/v13/deployments/" + UID + "?teamId=" + team.id,
      { headers: { Authorization: "Bearer " + token } },
    )
  ).json();
  console.log(
    JSON.stringify({
      state: d.state,
      readyState: d.readyState,
      aliasError: d.aliasError ?? null,
      url: d.url,
    }),
  );
})().catch((e) => console.log("ERR", e.message));
