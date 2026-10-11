// Verifikasi state SQLite lokal setelah baseline check Blibli.
const { DatabaseSync } = require("node:sqlite");
const path = require("path");

const db = new DatabaseSync(path.join(__dirname, "..", "data", "ktd-hub.db"));

const seen = db.prepare("SELECT COUNT(*) AS n FROM blibli_order_seen").get();
console.log("blibli_order_seen rows:", seen.n);

const seenSample = db
  .prepare("SELECT order_item_id, store_code, notify FROM blibli_order_seen LIMIT 3")
  .all();
for (const r of seenSample) {
  console.log("  seen:", r.order_item_id, "| store:", r.store_code, "| notify:", JSON.stringify(r.notify));
}

const cols = db
  .prepare("PRAGMA table_info(blibli_order_exec)")
  .all()
  .map((c) => c.name);
console.log("blibli_order_exec cols:", cols.join(", "));

const execN = db.prepare("SELECT COUNT(*) AS n FROM blibli_order_exec").get();
console.log("blibli_order_exec rows:", execN.n);

const mapN = db.prepare("SELECT COUNT(*) AS n FROM blibli_product_map").get();
console.log("blibli_product_map rows:", mapN.n);
