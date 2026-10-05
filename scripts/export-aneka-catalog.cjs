// Ekspor snapshot katalog Aneka dari cache toko (jakmall-clone) ke
// ktd-hub/src/lib/aneka-catalog.json — dipakai pencarian produk Aneka
// di halaman Pemetaan Produk (Fase 1 TikTok→Aneka).
//
// Jalankan dari folder ktd-hub setiap cache toko di-refresh:
//   node scripts/export-aneka-catalog.cjs
const fs = require("node:fs");
const path = require("node:path");

const SRC = path.resolve(
  __dirname,
  "..",
  "..",
  "src",
  "lib",
  "products-cache.json",
);
const OUT = path.resolve(__dirname, "..", "src", "lib", "aneka-catalog.json");

const cache = JSON.parse(fs.readFileSync(SRC, "utf8"));
const products = Array.isArray(cache) ? cache : (cache.products ?? []);

const rows = products
  .filter((p) => /^\d+$/.test(String(p.id ?? "")))
  .map((p) => ({
    id: String(p.id),
    name: String(p.name ?? "").trim(),
    hargaModal: String(p.hargaModal ?? ""),
    rekomendasiJual: String(p.rekomendasiJual ?? ""),
    location: String(p.location ?? ""),
  }))
  .filter((p) => p.name !== "")
  .sort((a, b) => a.name.localeCompare(b.name, "id"));

fs.writeFileSync(
  OUT,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      source: "jakmall-clone src/lib/products-cache.json (subset Aneka)",
      products: rows,
    },
    null,
    1,
  ),
  "utf8",
);

console.log(`OK: ${rows.length} produk Aneka ditulis ke ${path.relative(process.cwd(), OUT)}`);
