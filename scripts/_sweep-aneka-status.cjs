// Sweep status live semua produk Aneka yang ter-mapping di DB (97 produk):
// deteksi produk yang "menunggu persetujuan admin" (tidak bisa dipesan,
// seperti produk 543 Delta Plus) atau hilang (404), agar eksekusi pesanan
// tidak gagal di kemudian hari. Sumber id: SQLite lokal ktd-hub.db.
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const env = {};
for (const line of fs
  .readFileSync(path.resolve(__dirname, "../.env.local"), "utf8")
  .split(/\r?\n/)) {
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
        headers: {
          "User-Agent": UA,
          ...(jar ? { Cookie: jar } : {}),
          ...(init.headers ?? {}),
        },
      });
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await sleep(1200 * (i + 1));
    }
  }
  throw lastErr;
}

(async () => {
  // 1) Daftar produk dari SQLite lokal.
  const db = new DatabaseSync(
    path.resolve(__dirname, "../data/ktd-hub.db"),
    { readOnly: true },
  );
  const rows = db
    .prepare(
      "SELECT DISTINCT aneka_product_id id, MAX(aneka_product_name) nama FROM aneka_product_map WHERE aneka_product_id != '' GROUP BY aneka_product_id ORDER BY CAST(aneka_product_id AS INTEGER)",
    )
    .all();
  db.close();
  console.log("produk unik ter-mapping:", rows.length);

  // 2) Login Aneka.
  const password = env.ANEKA_PASSWORD_B64
    ? Buffer.from(env.ANEKA_PASSWORD_B64, "base64").toString("utf8")
    : env.ANEKA_PASSWORD;
  if (!env.ANEKA_EMAIL || !password) {
    console.log("kredensial Aneka tidak ada — batal");
    return;
  }
  let jar = "";
  const page = await fetchRetry(jar, `${BASE}/login`, { redirect: "manual" });
  jar = grabCookie(jar, page);
  const html = await page.text();
  const token = /name="_token"[^>]*value="([^"]+)"/.exec(html)?.[1] ?? "";
  if (!token) {
    console.log("token CSRF tidak ada — batal");
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
  console.log("login OK — mulai cek per produk...");

  // 3) Cek tiap produk.
  const masalah = [];
  let n = 0;
  for (const p of rows) {
    n++;
    try {
      const r = await fetchRetry(jar, `${BASE}/products/${p.id}`, {
        redirect: "manual",
      });
      const h = await r.text();
      const pending = /persetujuan admin|menunggu persetujuan/i.test(h);
      const hilang =
        r.status === 404 || /produk tidak ditemukan|404|Not Found/i.test(h.slice(0, 500));
      if (pending || hilang) {
        const title = /<title>([^<]*)<\/title>/.exec(h)?.[1] ?? "";
        masalah.push({
          id: p.id,
          nama: (p.nama ?? "").slice(0, 70),
          status: pending ? "MENUNGGU PERSETUJUAN" : "HILANG/404",
          title: title.slice(0, 80),
        });
        console.log(
          `  [${n}/${rows.length}] id=${p.id} → ${masalah[masalah.length - 1].status} | ${title}`,
        );
      }
    } catch (e) {
      masalah.push({ id: p.id, nama: (p.nama ?? "").slice(0, 70), status: `ERROR ${e.message}`, title: "" });
    }
    if (n % 25 === 0) console.log(`  ...progress ${n}/${rows.length}`);
    await sleep(280);
  }

  console.log(`\n=== HASIL SWEEP: ${rows.length} produk dicek ===`);
  if (masalah.length === 0) {
    console.log("Semua produk aman (tidak ada yang menunggu persetujuan / hilang).");
  } else {
    console.log(`Produk bermasalah: ${masalah.length}`);
    for (const m of masalah) console.log(`  id=${m.id} | ${m.status} | ${m.nama} | ${m.title}`);
  }
})();
