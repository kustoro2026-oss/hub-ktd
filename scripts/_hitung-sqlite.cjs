// Hitung baris semua tabel SQLite lokal (ktd-hub + toko).
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

for (const [label, file] of [
  ["HUB", path.join(process.cwd(), "data", "ktd-hub.db")],
  ["STORE", path.join(process.cwd(), "..", "data", "store.db")],
]) {
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
  } catch {
    console.log(`${label}: file tidak ada (${file})`);
    continue;
  }
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
  console.log(`=== ${label} (${file}) ===`);
  for (const t of tables) {
    const c = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
    console.log(`${t}: ${c}`);
  }
  db.close();
}
