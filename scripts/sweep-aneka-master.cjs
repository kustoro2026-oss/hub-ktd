/**
 * SWEEP MASTER KATALOG ANEKA (ktd-hub)
 * ====================================
 * Sapu SELURUH produk Anekadropship menjadi satu snapshot master di
 * ktd-hub/src/lib/aneka-master.json — sumber data menu Aneka di KTD Hub
 * dan (fase berikutnya) sinkronisasi harga/stok ke semua marketplace.
 *
 * Sumber data:
 *  1. LISTING (semua halaman, tanpa batas keras): /user/home?sort=newest,
 *     /produk/semua/malaysia, /produk/semua/terbaru → id + nama + HARGA
 *     MODAL (harga beli HANYA ada di kartu listing) + rekomendasi jual +
 *     profit + terjual + lokasi + kategori + gambar.
 *  2. FALLBACK untuk produk hidup tapi tersembunyi dari listing (detail
 *     tetap 200): jakmall-clone src/lib/products-cache.json, scripts/
 *     manual-products.json, tiktok-export/products.json — id yang belum
 *     ter-scrape dipakai sebagai entri tambahan.
 *  3. DETAIL per produk: /products/{id} → varian (label/warna/ukuran/
 *     harga/stok) dari x-data productActionDetail + Berat/Volume/Ekspedisi/
 *     Sistem/alamat seller dari HTML. Stok efektif = stok varian aktif
 *     minimum (produk tanpa varian = stok produk).
 *
 * Nama produk DIBERSIHKAN dari tag seller ([PG STORE], [HERBALUNA], dll)
 * — nama mentah Aneka tetap tersimpan di kolom namaAneka.
 *
 * Usage:
 *   node scripts/sweep-aneka-master.cjs              (semua, resume)
 *   node scripts/sweep-aneka-master.cjs --fresh      (mulai dari nol)
 *   node scripts/sweep-aneka-master.cjs --limit=20   (uji coba)
 *   node scripts/sweep-aneka-master.cjs --only=544,1042
 */
const fs = require("node:fs");
const path = require("node:path");
const cheerio = require("cheerio");

const BASE = "https://anekadropship.id";
const HUB_ROOT = path.resolve(__dirname, "..");
const STORE_ROOT = path.resolve(__dirname, "..", "..");
const OUT_PATH = path.join(HUB_ROOT, "src", "lib", "aneka-master.json");
const PARTIAL_PATH = path.join(__dirname, "_aneka-master-partial.json");
const DELAY_PAGE = 1000; // jeda antarkartu listing (situs flaky)
const DELAY_DETAIL = 300;
const TIMEOUT = 30000;
const WORKERS = 2;

const argv = process.argv.slice(2);
const FRESH = argv.includes("--fresh");
const SKIP_DETAIL = argv.includes("--skip-detail");
const limitArg = argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.slice("--limit=".length)) : 0;
const onlyArg = argv.find((a) => a.startsWith("--only="));
const ONLY = onlyArg ? onlyArg.slice("--only=".length).split(",").map((s) => s.trim()) : null;

// ---- Env (proses > ktd-hub/.env.local > jakmall-clone/.env.local) ----
function loadEnvFile(p) {
    if (!fs.existsSync(p)) return {};
    let txt = fs.readFileSync(p, "utf8");
    if (txt.charCodeAt(0) === 0xfeff) txt = txt.slice(1); // BOM PowerShell
    const out = {};
    for (const line of txt.split("\n")) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
    return out;
}
const hubEnv = loadEnvFile(path.join(HUB_ROOT, ".env.local"));
const storeEnv = loadEnvFile(path.join(STORE_ROOT, ".env.local"));
const EMAIL = process.env.ANEKA_EMAIL || hubEnv.ANEKA_EMAIL || storeEnv.ANEKA_EMAIL || "";
let PASSWORD = process.env.ANEKA_PASSWORD || "";
if (!PASSWORD && hubEnv.ANEKA_PASSWORD_B64) {
    PASSWORD = Buffer.from(hubEnv.ANEKA_PASSWORD_B64, "base64").toString("utf8");
}
if (!PASSWORD && hubEnv.ANEKA_PASSWORD) PASSWORD = hubEnv.ANEKA_PASSWORD.replace(/\\\$/g, "$");
if (!PASSWORD && storeEnv.ANEKA_PASSWORD) PASSWORD = storeEnv.ANEKA_PASSWORD.replace(/\\\$/g, "$");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie = "";
let loginPromise = null;

function grab(res) {
    const setCookies = res.headers.getSetCookie?.() ?? [];
    for (const c of setCookies) {
        const pair = c.split(";")[0];
        const name = pair.split("=")[0];
        cookie = cookie.replace(new RegExp(name + "=[^;]*;?"), "") + pair + "; ";
    }
}

/** Login ter-serialisasi (request paralel berbagi satu promise). */
function login() {
    if (!loginPromise) {
        loginPromise = (async () => {
            cookie = "";
            const page = await fetch(`${BASE}/login`, { redirect: "manual", headers: HEADERS });
            grab(page);
            const html = await page.text();
            const token = (html.match(/name="_token" value="([^"]+)"/) || [])[1] ?? "";
            if (!token) throw new Error("CSRF token tidak ditemukan");
            const res = await fetch(`${BASE}/login`, {
                method: "POST",
                headers: { ...HEADERS, "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
                body: new URLSearchParams({ _token: token, email: EMAIL, password: PASSWORD }),
                redirect: "manual",
            });
            grab(res);
            const loc = res.headers.get("location") ?? "";
            if (res.status === 419 || (res.status >= 300 && res.status < 400 && loc.includes("/login"))) {
                throw new Error(`login ditolak (${res.status})`);
            }
            console.log("[login] OK");
        })().finally(() => { loginPromise = null; });
    }
    return loginPromise;
}

async function fetchHtmlOnce(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => { try { ctrl.abort(); } catch { /* noop */ } }, TIMEOUT);
    try {
        const res = await fetch(url, { headers: { ...HEADERS, Cookie: cookie }, redirect: "follow", signal: ctrl.signal });
        return { status: res.status, html: await res.text() };
    } finally {
        clearTimeout(timer);
    }
}

/** Fetch dengan retry + re-login bila sesi mati. Null jika tetap gagal. */
async function fetchPage(url) {
    for (let i = 0; i < 3; i++) {
        try {
            const r = await fetchHtmlOnce(url);
            if (r.status === 404) return r;
            if (r.html.includes("Login ke akun Anda")) {
                await login();
                continue;
            }
            if (r.status === 200) return r;
        } catch { /* retry */ }
        await sleep(1200 * (i + 1));
    }
    return null;
}

// ---- Pembersih nama: buang tag seller [PG STORE] / [HERBALUNA] dll ----
function cleanName(raw) {
    let s = String(raw ?? "").replace(/\s+/g, " ").trim();
    // Tag kurung siku seimbang "[X]" maupun malformasi "[X}" (umum di aneka).
    s = s.replace(/\[[^\[\]]*[\]}]/g, " ");
    s = s.replace(/\b(?:META\s*ADS(?:\s*ONLY)?|ADS\s*ONLY)\b/gi, " ");
    s = s.replace(/^\s*[-–—]\s*/, "").replace(/\s*[-–—]\s*$/, "");
    s = s.replace(/\s{2,}/g, " ").trim();
    return s || String(raw ?? "").trim();
}

/** "Rp38.700" → 38700. */
function parseRp(s) {
    const n = Number(String(s ?? "").replace(/[^\d]/g, ""));
    return Number.isFinite(n) ? n : 0;
}

/** "500.00 Gram" → 500. */
function parseGram(s) {
    const m = String(s ?? "").match(/[\d.,]+/);
    if (!m) return 0;
    const n = parseFloat(m[0].replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
}

function decodeEntities(s) {
    return String(s ?? "")
        .replace(/&quot;/g, '"').replace(/&#39;|&#039;/g, "'")
        .replace(/&amp;/g, "&").replace(/&gt;/g, ">").replace(/&lt;/g, "<")
        .replace(/&nbsp;/g, " ").trim();
}

// ---- Parse kartu listing (selector sama dengan scrape-products-cache.cjs) ----
function parseListingCards(html, kategori) {
    const adsIdx = html.indexOf("meta_ads.png");
    const resultsHtml = adsIdx >= 0 ? html.slice(0, adsIdx) : html;
    const $ = cheerio.load(resultsHtml);
    const items = [];
    const seen = new Set();
    $('a.line-clamp-2[href*="/products/"]').each((_, el) => {
        const a = $(el);
        const card = a.closest("div.group");
        const href = a.attr("href") ?? "";
        const id = href.match(/\/products\/(\d+)/)?.[1] ?? "";
        const image = card.find("img").first().attr("src") ?? "";
        if (!id || seen.has(id) || !image) return;
        seen.add(id);

        const cleanPrice = (raw) => (raw ?? "").replace(/\s*\/\s*RM\s*[\d.,]+$/i, "").trim();
        const rekomendasiJual = cleanPrice(
            card.find('span:contains("Rekomendasi Jual")').parent()
                .find("span.text-green-600").first().text().trim()
        );
        const hargaModal = cleanPrice(card.find("span.text-red-500").first().text().trim());
        const hargaModalCut = cleanPrice(card.find("span.line-through").first().text().trim());
        const terjual = card.find('span:contains("Terjual")').parent()
            .find("span.font-bold").last().text().trim();
        const stok = card.find('span:contains("Stok:")').find("span").last().text().trim();
        const profit = card.find("span.bg-orange-100").first().text().trim();
        const location = card.find("div.absolute span.truncate").first().text().trim();

        items.push({
            id,
            rawName: a.text().trim(),
            name: cleanName(a.text()),
            image,
            location: location || "",
            rekomendasiJual,
            hargaModal,
            hargaModalCut,
            terjual: terjual || "0",
            stok: stok || "0",
            profit: profit || "",
            kategori: kategori || "",
        });
    });
    return items;
}

// ---- Sapu listing (semua halaman; berhenti saat halaman kosong/habis) ----
async function sweepListing() {
    const cardMap = new Map();
    const sources = [
        { label: "newest", url: (p) => `${BASE}/user/home?page=${p}&sort=newest`, kategori: "" },
        { label: "malaysia", url: (p) => `${BASE}/produk/semua/malaysia?page=${p}`, kategori: "malaysia" },
        { label: "terbaru", url: (p) => `${BASE}/produk/semua/terbaru?page=${p}`, kategori: "" },
    ];
    for (const src of sources) {
        console.log(`[listing] ${src.label} ...`);
        for (let page = 1; page <= 200; page++) {
            const html = await fetchPage(src.url(page));
            if (!html) {
                console.log(`  halaman ${page}: fetch gagal — lanjut sumber berikutnya`);
                break;
            }
            if (html.html.includes("tidak ada produk")) {
                console.log(`  halaman ${page} kosong, berhenti (total ${cardMap.size})`);
                break;
            }
            const cards = parseListingCards(html.html, src.kategori);
            let baru = 0;
            for (const c of cards) {
                if (!cardMap.has(c.id)) {
                    cardMap.set(c.id, { ...c, sumber: "listing" });
                    baru++;
                }
            }
            console.log(`  halaman ${page}: ${cards.length} kartu, ${baru} baru (total ${cardMap.size})`);
            if (cards.length < 3) break;
            await sleep(DELAY_PAGE);
        }
    }
    return cardMap;
}

// ---- Fallback produk tersembunyi dari snapshot toko & ekspor TikTok ----
function loadFallbacks(cardMap) {
    const add = (id, entry) => {
        if (!id || cardMap.has(id)) return;
        if (entry.name === "") return;
        cardMap.set(id, entry);
    };
    // 1) manual-products.json (produk sengaja tampil walau tersembunyi)
    try {
        const manual = JSON.parse(fs.readFileSync(path.join(STORE_ROOT, "scripts", "manual-products.json"), "utf8"));
        for (const p of manual.products ?? []) {
            const id = String(p.id ?? "");
            add(id, {
                id,
                rawName: String(p.name ?? ""),
                name: cleanName(p.name),
                image: String(p.image ?? ""),
                location: String(p.location ?? ""),
                rekomendasiJual: String(p.rekomendasiJual ?? ""),
                hargaModal: String(p.hargaModal ?? ""),
                hargaModalCut: String(p.hargaModalCut ?? ""),
                terjual: String(p.terjual ?? "0"),
                stok: String(p.stok ?? "0"),
                profit: String(p.profit ?? ""),
                kategori: "",
                beratGram: Number(p.beratGram) || 0,
                alamatSeller: String(p.alamatSeller ?? ""),
                ekspedisi: String(p.ekspedisi ?? ""),
                volume: String(p.volume ?? ""),
                sumber: "manual",
            });
        }
        console.log(`[fallback] manual-products: ${cardMap.size} total`);
    } catch (e) {
        console.log(`[fallback] manual-products gagal: ${e.message}`);
    }
    // 2) products-cache.json toko (semua field ter-enrich)
    try {
        const cache = JSON.parse(fs.readFileSync(path.join(STORE_ROOT, "src", "lib", "products-cache.json"), "utf8"));
        for (const p of cache.products ?? []) {
            const id = String(p.id ?? "");
            add(id, {
                id,
                rawName: String(p.name ?? ""),
                name: cleanName(p.name),
                image: String(p.image ?? ""),
                location: String(p.location ?? ""),
                rekomendasiJual: String(p.rekomendasiJual ?? ""),
                hargaModal: String(p.hargaModal ?? ""),
                hargaModalCut: String(p.hargaModalCut ?? ""),
                terjual: String(p.terjual ?? "0"),
                stok: String(p.stok ?? "0"),
                profit: String(p.profit ?? ""),
                kategori: String(p.category ?? ""),
                beratGram: Number(p.beratGram) || 0,
                alamatSeller: String(p.alamatSeller ?? ""),
                ekspedisi: String(p.ekspedisi ?? ""),
                volume: String(p.volume ?? ""),
                sumber: "cache",
            });
        }
        console.log(`[fallback] products-cache toko: ${cardMap.size} total`);
    } catch (e) {
        console.log(`[fallback] products-cache gagal: ${e.message}`);
    }
    // 3) tiktok-export/products.json (ekspor aneka penuh + SKU)
    try {
        const exp = JSON.parse(fs.readFileSync(path.join(STORE_ROOT, "tiktok-export", "products.json"), "utf8"));
        for (const p of Array.isArray(exp) ? exp : []) {
            const id = String(p.id ?? "");
            add(id, {
                id,
                rawName: String(p.name ?? ""),
                name: cleanName(p.name),
                image: Array.isArray(p.images) ? String(p.images[0] ?? "") : "",
                location: String(p.location ?? ""),
                rekomendasiJual: p.priceText ?? String(p.price ?? ""),
                hargaModal: p.modalText ?? "",
                hargaModalCut: "",
                terjual: String(p.soldText ?? "0"),
                stok: String(p.stockText ?? p.stock ?? "0"),
                profit: "",
                kategori: String(p.category ?? ""),
                beratGram: Number(p.weightGram) || 0,
                alamatSeller: String(p.alamatSeller ?? ""),
                ekspedisi: String(p.ekspedisi ?? ""),
                volume: String(p.volumeText ?? ""),
                sistem: String(p.sistem ?? ""),
                sku: String(p.sku ?? ""),
                varianMentah: Array.isArray(p.variants) ? p.variants : [],
                sumber: "tiktok-export",
            });
        }
        console.log(`[fallback] tiktok-export: ${cardMap.size} total`);
    } catch (e) {
        console.log(`[fallback] tiktok-export gagal: ${e.message}`);
    }
    return cardMap;
}

// ---- Parse halaman detail /products/{id} ----
function extractProductData(html) {
    const m = html.match(/x-data="productActionDetail\(([^"]+)\)"/);
    if (!m) return null;
    const s = decodeEntities(m[1]);
    const a = s.indexOf("{");
    const b = s.lastIndexOf("}");
    if (a < 0 || b <= a) return null;
    try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

function parseDetail(html) {
    const pd = extractProductData(html);
    const out = {
        pd: null,
        beratGram: 0,
        volume: "",
        ekspedisi: "",
        sistem: "",
        alamatSeller: "",
        hargaJual: 0,
    };
    // Blok pengiriman & alamat (HTML biasa, bukan x-data)
    const b = html.match(/Berat:\s*<strong>\s*([\d.,]+)\s*Gram/i);
    if (b) out.beratGram = parseGram(b[1]);
    const v = html.match(/Volume:\s*<strong>([^<]+)<\/strong>/i);
    if (v) out.volume = decodeEntities(v[1]);
    const e = html.match(/Ekspedisi:\s*<strong>([^<]+)<\/strong>/i);
    if (e) out.ekspedisi = decodeEntities(e[1]);
    const s = html.match(/Sistem:\s*<strong>([^<]+)<\/strong>/i);
    if (s) out.sistem = decodeEntities(s[1]);
    const al = html.match(/data-address="([^"]+)"/);
    if (al) out.alamatSeller = decodeEntities(al[1]);
    const hj = html.match(/Harga Jual:\s*<strong[^>]*>([^<]+)<\/strong>/i);
    if (hj) out.hargaJual = parseRp(hj[1]);
    if (pd) {
        out.pd = pd;
        const raw = Array.isArray(pd.variants) ? pd.variants : [];
        const aktif = raw.filter((x) => x && x.is_active !== false);
        const stokList = aktif.map((x) => Number(x.stock) || 0);
        out.stokEfektif = raw.length > 0
            ? (stokList.length ? Math.min(...stokList) : 0)
            : Number(pd.stock) || 0;
    }
    return out;
}

// ---- Gabung kartu + detail menjadi satu baris master ----
function buildRow(card, detail) {
    const d = detail ?? {};
    const pd = d.pd ?? null;
    const rawName = pd?.name ? String(pd.name) : card.rawName;
    const name = pd?.name ? cleanName(pd.name) : card.name;
    const modal = parseRp(card.hargaModal);
    const rek = parseRp(card.rekomendasiJual) || d.hargaJual || 0;
    let profitPct = card.profit;
    if (!profitPct && modal > 0 && rek > 0) {
        profitPct = `Profit +${Math.round(((rek - modal) / modal) * 100)}%`;
    }
    const varian = pd
        ? (Array.isArray(pd.variants) ? pd.variants : [])
            .filter((v) => v && v.id != null)
            .map((v) => ({
                id: String(v.id),
                label: String(v.label ?? v.name ?? "").trim(),
                nama: String(v.name ?? v.label ?? "").trim(),
                warna: v.color == null || v.color === "" ? null : String(v.color).trim(),
                ukuran: v.size == null || v.size === "" ? null : String(v.size).trim(),
                harga: parseRp(v.price),
                stok: Number.isFinite(Number(v.stock)) ? Number(v.stock) : 0,
                aktif: v.is_active !== false,
            }))
        : mapVarianMentah(card.varianMentah);
    const stok = d.stokEfektif != null
        ? d.stokEfektif
        : (varian.length > 0 ? Math.min(...varian.map((x) => x.stok)) : parseRp(card.stok) || Number(card.stok) || 0);

    return {
        id: card.id,
        name,
        namaAneka: rawName,
        hargaModal: modal,
        hargaModalCut: parseRp(card.hargaModalCut),
        rekomendasiJual: rek,
        profitPct,
        terjual: card.terjual || "0",
        stok,
        stokCard: card.stok,
        lokasi: card.location || "",
        kategori: card.kategori || "",
        beratGram: d.beratGram || card.beratGram || 0,
        volume: d.volume || card.volume || "",
        ekspedisi: d.ekspedisi || card.ekspedisi || "",
        sistem: d.sistem || card.sistem || "",
        alamatSeller: d.alamatSeller || card.alamatSeller || "",
        image: pd?.image ? String(pd.image) : card.image,
        sku: card.sku || "",
        hasVarian: varian.length > 0,
        varian,
        sumber: card.sumber,
        status: detail === null ? "404"
            : (detail === undefined ? "tanpa-detail" : "aktif"),
    };
}

function mapVarianMentah(raw) {
    if (!Array.isArray(raw) || raw.length === 0) return [];
    return raw
        .filter((v) => v && v.id != null)
        .map((v) => ({
            id: String(v.id),
            label: String(v.label ?? v.name ?? "").trim(),
            nama: String(v.name ?? v.label ?? "").trim(),
            warna: v.color == null || v.color === "" ? null : String(v.color).trim(),
            ukuran: v.size == null || v.size === "" ? null : String(v.size).trim(),
            harga: parseRp(v.price),
            stok: Number.isFinite(Number(v.stock)) ? Number(v.stock) : 0,
            aktif: v.is_active !== false,
        }));
}

// ---- Main ----
(async () => {
    if (!EMAIL || !PASSWORD) { console.error("ANEKA_EMAIL / ANEKA_PASSWORD kosong (cek .env.local)"); process.exit(1); }

    let cardMap = await sweepListing();
    if (!SKIP_DETAIL) cardMap = loadFallbacks(cardMap);
    console.log(`\n[id] ${cardMap.size} id unik (listing + fallback)`);

    if (ONLY) {
        const set = new Set(ONLY);
        cardMap = new Map([...cardMap].filter(([id]) => set.has(id)));
        console.log(`[only] dipersempit ke ${cardMap.size} produk`);
    }

    let partial = {};
    if (!FRESH && fs.existsSync(PARTIAL_PATH)) {
        try { partial = JSON.parse(fs.readFileSync(PARTIAL_PATH, "utf8")); } catch { partial = {}; }
    }
    const ids = [...cardMap.keys()].sort((a, b) => Number(a) - Number(b));
    const todo = LIMIT > 0 ? ids.slice(0, LIMIT) : ids;

    if (!SKIP_DETAIL) {
        await login();
        let cursor = 0;
        let done = 0;
        let gagal = 0;
        let noXdata = 0;
        async function worker(wid) {
            while (true) {
                const idx = cursor++;
                if (idx >= todo.length) return;
                const id = todo[idx];
                if (id in partial) { done++; continue; }
                const res = await fetchPage(`${BASE}/products/${id}`);
                if (!res) {
                    gagal++;
                    console.log(`  [w${wid}] #${id} GAGAL fetch (skip — ulangi run berikutnya)`);
                } else if (res.status === 404) {
                    partial[id] = { status: "404" };
                } else {
                    const d = parseDetail(res.html);
                    if (!d.pd) {
                        noXdata++;
                        partial[id] = { ...d, status: "tanpa-xdata" };
                    } else {
                        partial[id] = { ...d, pd: null, status: "ok" };
                        partial[id]._pd = d.pd; // sementara — dibuang saat tulis final
                    }
                }
                done++;
                if (done % 40 === 0) {
                    fs.writeFileSync(PARTIAL_PATH, JSON.stringify(partial), "utf8");
                    console.log(`  progres detail: ${done}/${todo.length} | gagal: ${gagal} | tanpa-xdata: ${noXdata}`);
                }
                await sleep(DELAY_DETAIL);
            }
        }
        await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(i + 1)));
        fs.writeFileSync(PARTIAL_PATH, JSON.stringify(partial), "utf8");
    }

    // ---- Susun file final ----
    const rows = [];
    for (const id of todo) {
        const card = cardMap.get(id);
        if (!card) continue;
        let detail;
        if (SKIP_DETAIL) {
            detail = undefined;
        } else {
            const entry = partial[id];
            if (entry === undefined) { rows.push(buildRow(card, undefined)); continue; }
            if (entry.status === "404") { rows.push(buildRow(card, null)); continue; }
            const { _pd, ...rest } = entry;
            detail = { ...rest, pd: _pd ?? null };
        }
        rows.push(buildRow(card, detail));
    }
    rows.sort((a, b) => Number(a.id) - Number(b.id));

    const out = {
        generatedAt: new Date().toISOString(),
        source: "sweep live anekadropship.id (listing + detail) + fallback snapshot toko",
        scanned: rows.length,
        withVariants: rows.filter((r) => r.hasVarian).length,
        totalVariants: rows.reduce((s, r) => s + r.varian.length, 0),
        status404: rows.filter((r) => r.status === "404").length,
        stokHabis: rows.filter((r) => r.status !== "404" && r.stok <= 0).length,
        products: rows,
    };
    fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 1), "utf8");
    fs.writeFileSync(PARTIAL_PATH, "{}", "utf8"); // checkpoint selesai → kosongkan

    console.log("\n================ RINGKASAN ================");
    console.log(`Tersimpan       : ${OUT_PATH}`);
    console.log(`Produk          : ${out.scanned}`);
    console.log(`Bervarian       : ${out.withVariants} (total varian ${out.totalVariants})`);
    console.log(`Status 404      : ${out.status404}`);
    console.log(`Stok habis (0)  : ${out.stokHabis}`);
    console.log("===========================================");
})().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
