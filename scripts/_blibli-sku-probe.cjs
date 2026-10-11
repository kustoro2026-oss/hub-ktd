// Probe order list Blibli: lihat format sellerSku asli + nama item + qty.
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
const qs = new URLSearchParams({
  storeCode: env.BLIBLI_STORE_CODE,
  username: "info@kustoro2026.com",
  storeId: "10001",
  channelId: "KUSTORO",
  requestId: `ktd-probe-${randomUUID()}`,
});

(async () => {
  const url = `https://api.blibli.com/v2/proxy/seller/v1/orders/packages/filter?${qs}`;
  const r = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      statusFPDateRange: { start: Date.now() - 30 * 24 * 3600 * 1000, end: Date.now() },
      paging: { page: 0, size: 50 },
    }),
  });
  console.log("HTTP", r.status);
  const body = await r.json();
  const pkgs = body.content ?? [];
  console.log("packages:", pkgs.length, "totalRecord:", body.paging?.totalRecord);
  let n = 0;
  for (const p of pkgs) {
    for (const it of p.orderItems ?? []) {
      n++;
      console.log(JSON.stringify({
        packageId: p.packageId,
        sellerSku: it.product?.sellerSku,
        itemName: (it.product?.itemName ?? "").slice(0, 60),
        qty: it.order?.quantity,
        status: it.order?.itemStatus,
        sellerDeliveryType: it.sellerDeliveryType,
        variant: it.product?.variantName,
      }));
      if (n >= 12) break;
    }
    if (n >= 12) break;
  }
})().catch((e) => { console.error("ERR", e); process.exit(1); });
