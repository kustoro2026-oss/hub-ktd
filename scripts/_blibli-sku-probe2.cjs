// Probe mendalam: field produk asli di order list + order detail Blibli.
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const raw = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
const env = {};
for (const line of raw.split(/\r?\n/)) {
  const m = /^\s*([A-Z_]+)\s*=\s*(.*)$/.exec(line);
  if (m) env[m[1]] = m[2].trim().replace(/^"|"$/g, "");
}
const headers = {
  Authorization: "Basic " + Buffer.from(`${env.BLIBLI_API_CLIENT_ID}:${env.BLIBLI_API_CLIENT_KEY}`).toString("base64"),
  Accept: "application/json",
  "Content-Type": "application/json",
  "Api-Seller-Key": env.BLIBLI_API_SELLER_KEY,
};
const qs = () =>
  new URLSearchParams({
    storeCode: env.BLIBLI_STORE_CODE,
    username: "info@kustoro2026.com",
    storeId: "10001",
    channelId: "KUSTORO",
    requestId: `ktd-probe-${randomUUID()}`,
  });

(async () => {
  const url = `https://api.blibli.com/v2/proxy/seller/v1/orders/packages/filter?${qs()}`;
  const r = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      statusFPDateRange: { start: Date.now() - 60 * 24 * 3600 * 1000, end: Date.now() },
      paging: { page: 0, size: 50 },
    }),
  });
  const body = await r.json();
  const pkgs = body.content ?? [];
  console.log("packages:", pkgs.length);
  if (pkgs.length === 0) return;
  const it = pkgs[0].orderItems[0];
  console.log("== ITEM LIST (product) ==");
  console.log(JSON.stringify(it.product, null, 1));
  console.log("== ITEM LIST (order) ==");
  console.log(JSON.stringify({ id: it.order?.id, itemId: it.order?.itemId, quantity: it.order?.quantity, itemStatus: it.order?.itemStatus }, null, 1));
  // Detail item
  const durl = `https://api.blibli.com/v2/proxy/seller/v1/orders/items/${encodeURIComponent(it.order.id)}?${qs()}`;
  const dr = await fetch(durl, { headers });
  const dbody = await dr.json();
  const c = dbody.content ?? {};
  console.log("== DETAIL product ==");
  console.log(JSON.stringify(c.product, null, 1).slice(0, 900));
  console.log("== DETAIL status/histories ==");
  console.log(JSON.stringify({ status: c.status, histories: (c.histories ?? []).slice(0, 4) }, null, 1));
})().catch((e) => { console.error("ERR", e); process.exit(1); });
