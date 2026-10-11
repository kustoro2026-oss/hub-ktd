// Probe: detail item non-batal (varian) + struktur xlsx upload.
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
  // Ambil item dengan status bukan X
  let target = null;
  for (const p of pkgs) {
    for (const it of p.orderItems ?? []) {
      if (it.order?.itemStatus !== "X") { target = it; break; }
    }
    if (target) break;
  }
  if (!target) { console.log("tidak ada item non-batal"); return; }
  console.log("target:", target.order?.id, target.product?.itemName?.slice(0, 40));
  const durl = `https://api.blibli.com/v2/proxy/seller/v1/orders/items/${encodeURIComponent(target.order.id)}?${qs()}`;
  const dr = await fetch(durl, { headers });
  const dbody = await dr.json();
  console.log("detail HTTP", dr.status);
  const c = dbody.content ?? {};
  console.log(JSON.stringify({
    product: c.product,
    status: c.status,
    recipientName: c.recipient?.name,
  }, null, 1).slice(0, 1200));
})().catch((e) => { console.error("ERR", e); process.exit(1); });
