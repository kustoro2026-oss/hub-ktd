// Pembangun basis pengetahuan bot WhatsApp KTD Hub.
//
// Menghasilkan src/lib/bot-knowledge.json dari sumber data katalog yang
// DIMILIKI repositori toko (jakmall-clone), yang berada satu tingkat di
// atas folder ktd-hub ini:
//   ../src/lib/products-cache.json    — katalog produk fisik (752 item)
//   ../src/lib/description-cache.json — deskripsi produk per id
//   ../src/lib/topup.ts               — TOPUP_PROVIDERS (71 provider top-up)
//
// Pola ini sama dengan gen-topup-catalog.cjs di repositori toko: basis
// pengetahuan adalah ARTIFAK GENERATED yang di-commit. Setiap kali katalog
// toko diperbarui, jalankan ulang:
//   node scripts/build-bot-knowledge.cjs
// lalu commit bot-knowledge.json bersama perubahan katalog.
//
// Hasilnya dipakai runtime oleh src/lib/ai-reply.ts (pencarian + jawaban AI).
//
// Kebijakan toko di blok `store` ditulis manual di sini dan WAJIB disamakan
// bila checkout/FAQ toko berubah (rekening, biaya COD, jam CS, dll).
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const STORE = path.resolve(ROOT, "..");
const OUT = path.join(ROOT, "src", "lib", "bot-knowledge.json");

const CATALOG_URL = "https://toko.kustoro2026.com";

// Buang pasangan surrogate (emoji) SEBELUM pemangkasan: memotong di tengah
// emoji menghasilkan \uDXXX menggantung yang membuat JSON tidak valid bagi
// parser ketat Turbopack (padahal Node JSON.parse memaafkannya).
const clean = (s) => String(s ?? "").replace(/[\uD800-\uDFFF]/g, "");

// ---------- Ringkasan kebijakan toko (selalu disertakan di prompt) ----------
const STORE_BLOCK = `KTD Store adalah toko online (situs ${CATALOG_URL}) yang menjual produk fisik (kesehatan, kecantikan, rumah tangga, pertanian, otomotif, dan lainnya) serta produk digital (top up pulsa, paket data, token listrik PLN, e-money, dan voucher game).
Cara beli produk fisik: buka katalog ${CATALOG_URL} , pilih produk, klik tombol "Order via WhatsApp", lengkapi nama dan alamat (provinsi, kota, kecamatan), ongkir dihitung otomatis, lalu kirim pesan WhatsApp.
Cara beli top up digital: buka halaman top-up di ${CATALOG_URL}/topup , pilih kategori dan nominal, isi nomor tujuan atau ID game, bayar online (QRIS, VA, e-wallet, atau kartu), saldo masuk otomatis.
Pembayaran produk fisik: COD (bayar di tempat, biaya tambahan Rp 2.500 per paket) atau transfer bank Mandiri 1340025493742 a.n. KUSTORO (kirim bukti transfer ke chat).
Pengiriman fisik: seluruh Indonesia, estimasi 1-5 hari kerja, nomor resi dikirim via WhatsApp setelah paket diserahkan kurir. Tidak ada minimal pembelian.
Retur/penukaran: melalui CS WhatsApp, produk dalam kondisi asli beserta kemasan dan bukti pembelian.
Jam CS: setiap hari pukul 09:00-18:00 WIB kecuali hari libur nasional. Nomor CS: 0851 7115 7938.
Marketplace resmi KTD Store: Blibli, TikTok Shop, dan Lazada.`;

// ---------- Baca katalog produk fisik ----------
function loadProducts() {
  const cache = JSON.parse(
    fs.readFileSync(path.join(STORE, "src", "lib", "products-cache.json"), "utf8"),
  );
  const desc = JSON.parse(
    fs.readFileSync(path.join(STORE, "src", "lib", "description-cache.json"), "utf8"),
  );
  const stripHtml = (s) =>
    s
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const products = [];
  for (const p of cache.products ?? []) {
    if (!p.id || !p.name) continue;
    const d = desc.products?.[String(p.id)] ?? "";
    products.push({
      id: String(p.id),
      name: clean(p.name).trim(),
      price: String(p.rekomendasiJual ?? ""),
      stok: String(p.stok ?? ""),
      berat: String(p.berat ?? ""),
      desc: clean(stripHtml(d)).slice(0, 240),
      link: `${CATALOG_URL}/produk/${p.id}`,
    });
  }
  return products;
}

// ---------- Baca TOPUP_PROVIDERS dari topup.ts (satu baris raksasa) ----------
function loadTopup() {
  const s = fs.readFileSync(path.join(STORE, "src", "lib", "topup.ts"), "utf8");
  const start = s.indexOf("TOPUP_PROVIDERS: TopUpProvider[] = ");
  const endMarker = s.indexOf("TOPUP_PRODUCTS", start);
  if (start < 0 || endMarker < 0) {
    throw new Error("TOPUP_PROVIDERS tidak ditemukan di topup.ts");
  }
  const head = s.slice(start, endMarker).trimEnd(); // berakhir dengan "];"
  const eq = head.indexOf("=");
  const open = head.indexOf("[", eq); // kurung pembuka ARRAY DATA (setelah tanda =)
  const close = head.lastIndexOf("]");
  const providers = JSON.parse(head.slice(open, close + 1));
  return providers.map((p) => {
    const nominals = p.nominals ?? [];
    const sells = nominals.map((n) => n.sellPrice).filter((x) => typeof x === "number");
    const cat =
      nominals.find((n) => n.category)?.category ??
      p.category ??
      "";
    return {
      slug: p.slug,
      brand: clean(p.brand),
      label: clean(p.label ?? p.brand),
      category: clean(cat),
      count: nominals.length,
      priceMin: sells.length ? Math.min(...sells) : 0,
      priceMax: sells.length ? Math.max(...sells) : 0,
      examples: nominals.slice(0, 10).map((n) => clean(n.name)).filter(Boolean),
      customerNoLabel: clean(p.customerNoLabel),
      link: `${CATALOG_URL}/topup/${p.slug}`,
    };
  });
}

function main() {
  const products = loadProducts();
  const topup = loadTopup();
  const kb = {
    generatedAt: new Date().toISOString(),
    store: STORE_BLOCK,
    products,
    topup,
  };
  fs.writeFileSync(OUT, JSON.stringify(kb, null, 1));
  const sizeKb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log(`produk: ${products.length}`);
  console.log(`topup: ${topup.length} provider`);
  console.log(`ditulis ke ${OUT} (${sizeKb} KB)`);
}

main();
