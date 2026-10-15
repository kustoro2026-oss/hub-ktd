// Cari produk pengganti "Delta Plus" di Aneka live (login + /user/home?search=).
const fs = require("fs");
const env = {};
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}
const BASE = "https://anekadropship.id";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function grabCookie(jar, res) {
  let j = jar;
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const pair = c.split(";")[0];
    const name = pair.split("=")[0];
    j = j.replace(new RegExp(`${name}=[^;]*;?`), "") + pair + "; ";
  }
  return j;
}
async function fetchRetry(jar, url, init = {}, attempts = 2) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, {
        ...init,
        headers: { "User-Agent": UA, ...(jar ? { Cookie: jar } : {}), ...(init.headers ?? {}) },
      });
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await sleep(1200 * (i + 1));
    }
  }
  throw lastErr;
}

(async () => {
  const password = env.ANEKA_PASSWORD_B64
    ? Buffer.from(env.ANEKA_PASSWORD_B64, "base64").toString("utf8")
    : env.ANEKA_PASSWORD;
  if (!env.ANEKA_EMAIL || !password) {
    console.log("ANEKA creds tidak ada di .env.local");
    return;
  }
  let jar = "";
  const page = await fetchRetry(jar, `${BASE}/login`, { redirect: "manual" });
  jar = grabCookie(jar, page);
  const html = await page.text();
  const token = /name="_token"[^>]*value="([^"]+)"/.exec(html)?.[1] ?? "";
  if (!token) {
    console.log("login: token CSRF tidak ada");
    return;
  }
  const res = await fetchRetry(jar, `${BASE}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _token: token, email: env.ANEKA_EMAIL, password }),
  });
  jar = grabCookie(jar, res);
  const loc = res.headers.get("location") ?? "";
  if (res.status === 419 || (res.status >= 300 && res.status < 400 && loc.includes("/login"))) {
    console.log("login GAGAL", res.status, loc);
    return;
  }
  console.log("login OK");

  for (const q of ["Delta Plus", "DeltaPlus", "delta", "kutu caplak", "kutu anjing kucing"]) {
    const url = `${BASE}/user/home?search=${encodeURIComponent(q)}&category=&location=all&seller=all&page=1`;
    const r = await fetchRetry(jar, url, { redirect: "manual" });
    const h = await r.text();
    // Ekstrak kartu produk: id + nama dari tautan /products/{id} atau href produk
    const cards = [];
    const re = /href="\/products\/(\d+)"[^>]*>/g;
    let m;
    while ((m = re.exec(h))) {
      const id = m[1];
      if (cards.some((c) => c.id === id)) continue;
      // ambil nama dari sekitar tautan: alt gambar, atau teks bebas berikutnya
      const after = h.slice(m.index, m.index + 900);
      const nama =
        /alt="([^"]+)"/.exec(after)?.[1] ??
        /title="([^"]+)"/.exec(after)?.[1] ??
        /<h[1-5][^>]*>([^<]{5,150})<\/h[1-5]>/.exec(after)?.[1] ??
        "";
      const namaBersih = nama.replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim();
      if (namaBersih) cards.push({ id, nama: namaBersih });
    }
    console.log(`\n=== search "${q}" → ${cards.length} kartu ===`);
    for (const c of cards.slice(0, 20)) console.log(c.id, "|", c.nama.slice(0, 100));
    await sleep(800);
  }

  // Cek halaman produk 543 (live state)
  const p543 = await fetchRetry(jar, `${BASE}/products/543`, { redirect: "manual" });
  const phtml = await p543.text();
  const tped = /\[TPEDIA\]/.test(phtml);
  const pending = /persetujuan admin|menunggu persetujuan/i.test(phtml);
  const title = /<title>([^<]*)<\/title>/.exec(phtml)?.[1] ?? "";
  console.log(`\n=== produk 543 live ===`);
  console.log("title:", title);
  console.log("ada [TPEDIA]:", tped, "| ada teks persetujuan admin:", pending);
})();
