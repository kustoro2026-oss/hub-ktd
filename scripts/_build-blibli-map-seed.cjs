// TEMP: bangun src/lib/blibli-map-seed.json dari blibli-products.json
// (listing AKTIF hasil scrape Seller Center) x aneka-catalog.json, dengan
// jembatan ALIASES dari blibli-product-links.ts. Meniru builder TikTok
// (97/100) — kunci pemetaan = productSku ("KTS-70007-XXXXX").
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const BLIBLI_JSON = path.join(ROOT, "blibli-products.json");
const CATALOG_JSON = path.resolve(__dirname, "..", "src", "lib", "aneka-catalog.json");
const LINKS_TS = path.join(ROOT, "src", "lib", "blibli-product-links.ts");
const OUT_JSON = path.resolve(__dirname, "..", "src", "lib", "blibli-map-seed.json");

/** Lowercase, buang tanda baca, satukan spasi — sama persis dengan
 *  normalize() di blibli-product-links.ts supaya kunci ALIASES cocok. */
function normalize(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalisasi ketat tanpa spasi — menangkap typo pemisah kata
 *  (mis. "JJ 21Pria" vs "JJ 21 Pria"). Hanya untuk cocok persis. */
function squash(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function main() {
  const blibli = JSON.parse(fs.readFileSync(BLIBLI_JSON, "utf8"));
  const catalog = JSON.parse(fs.readFileSync(CATALOG_JSON, "utf8"));
  const catProducts = Array.isArray(catalog.products) ? catalog.products : [];

  // Katalog Aneka: indeks nama ternormalisasi + nama squashed.
  const catByNorm = new Map(); // norm -> {id, name}
  const catBySquash = new Map(); // squash -> [{id, name}]
  const catIds = new Set();
  for (const c of catProducts) {
    const id = String(c.id ?? "").trim();
    if (!id) continue;
    catIds.add(id);
    const n = normalize(c.name);
    const q = squash(c.name);
    if (n && !catByNorm.has(n)) catByNorm.set(n, { id, name: c.name });
    if (q) {
      if (!catBySquash.has(q)) catBySquash.set(q, []);
      if (!catBySquash.get(q).some((x) => x.id === id)) {
        catBySquash.get(q).push({ id, name: c.name });
      }
    }
  }

  // ALIASES dari blibli-product-links.ts: parse blok "const ALIASES".
  // Entri: { key: nama katalog ternormalisasi, sku: "KTS-70007-XXXXX" }.
  const ts = fs.readFileSync(LINKS_TS, "utf8");
  const block = /const ALIASES[^=]*=\s*\{([\s\S]*?)\n\};/.exec(ts);
  const aliasesBySku = new Map(); // sku -> key (norm katalog)
  if (block) {
    const re = /"([^"]+)"\s*:\s*"([^"]+)"/g;
    let m;
    while ((m = re.exec(block[1])) !== null) {
      const key = m[1]; // sudah ternormalisasi di file sumber
      const url = m[2];
      const sku = /ps--([A-Za-z0-9-]+)/.exec(url);
      if (sku) aliasesBySku.set(sku[1], key);
    }
  }

  // Indeks blibli: id -> produk.
  const blibliById = new Map();
  const blibliByNorm = new Map();
  const blibliNormList = [];
  for (const p of blibli) {
    const id = String(p.id ?? "").trim();
    if (!id) continue;
    blibliById.set(id, p);
    const n = normalize(p.name);
    blibliByNorm.set(n, id);
    blibliNormList.push(n);
  }

  const usedCatalog = new Set(); // produk Aneka yang sudah terpakai
  const rows = [];
  const unmatched = [];
  const ambiguous = [];

  function push(blibliId, cat) {
    const p = blibliById.get(blibliId);
    rows.push({
      blibli_sku: blibliId,
      seller_sku: "",
      product_name: p.name,
      aneka_product_id: cat.id,
      aneka_variant_id: "",
      aneka_product_name: cat.name,
      enabled: 1,
    });
    usedCatalog.add(cat.id);
  }

  for (const p of blibli) {
    const id = String(p.id ?? "").trim();
    const name = String(p.name ?? "").trim();
    const n = normalize(name);
    const q = squash(name);

    // 1. Cocok persis.
    const exact = catByNorm.get(n);
    if (exact) {
      push(id, exact);
      continue;
    }

    // 2. Prefix dua arah (min. 2 kata), harus unik.
    const words = n.split(" ").length;
    let cands = []; // kandidat produk Aneka
    const match = (catNorm) => {
      const cw = catNorm.split(" ").length;
      if (cw < 2 || words < 2) return false;
      return catNorm.startsWith(n + " ") || n.startsWith(catNorm + " ");
    };
    if (words >= 2) {
      for (const [catNorm, cat] of catByNorm) {
        if (match(catNorm)) cands.push(cat);
      }
      if (cands.length === 1) {
        push(id, cands[0]);
        continue;
      }
    }

    // 3. Squash (tanpa spasi) — hanya kalau unik.
    const sq = catBySquash.get(q) ?? [];
    if (sq.length === 1) {
      push(id, sq[0]);
      continue;
    }

    // 4. Jembatan ALIASES: URL listing memuat SKU produk ini.
    const aliasKey = aliasesBySku.get(id);
    if (aliasKey) {
      const cat = catByNorm.get(aliasKey);
      if (cat) {
        push(id, cat);
        continue;
      }
    }

    // Tidak ketemu — catat untuk laporan.
    if (cands.length > 1) {
      ambiguous.push({ id, name, candidates: cands.map((c) => c.id) });
    } else {
      unmatched.push({ id, name });
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    source:
      "blibli-products.json (semua listing aktif) x aneka-catalog.json + ALIASES blibli-product-links.ts",
    rows,
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(payload, null, 1) + "\n", "utf8");

  console.log(`listing Blibli : ${blibli.length}`);
  console.log(`katalog Aneka  : ${catProducts.length}`);
  console.log(`ALIASES        : ${aliasesBySku.size}`);
  console.log(`terpetakan     : ${rows.length}`);
  console.log(`ambiguous      : ${ambiguous.length}`);
  console.log(`belum terpetakan: ${unmatched.length}`);
  console.log("");
  if (ambiguous.length) {
    console.log("AMBIGUOUS:");
    for (const a of ambiguous) {
      console.log(`- ${a.id} | ${a.name} | calon: ${a.candidates.join(", ")}`);
    }
  }
  if (unmatched.length) {
    console.log("");
    console.log("BELUM TERPETAKAN:");
    for (const u of unmatched) {
      console.log(`- ${u.id} | ${u.name}`);
    }
  }
  console.log("");
  console.log(`ditulis: ${OUT_JSON}`);
}

main();
