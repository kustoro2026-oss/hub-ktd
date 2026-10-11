// Verifikasi live admin.kustoro2026.com setelah deploy modul Blibli.
// Tanpa sesi admin: halaman dashboard harus redirect ke /login (bukan 404/500),
// route API harus 401 "Belum masuk" (bukan 404).
async function probe(name, url, opts = {}) {
  try {
    const r = await fetch(url, { redirect: "manual", ...opts });
    const loc = r.headers.get("location") ?? "";
    const body = (await r.text()).slice(0, 120);
    console.log(name, "->", r.status, "loc:", loc, "|", body.replace(/\s+/g, " "));
  } catch (e) {
    console.log(name, "ERROR", String(e));
  }
}

(async () => {
  await probe("root", "https://admin.kustoro2026.com/");
  await probe("pesanan", "https://admin.kustoro2026.com/marketplace/blibli/pesanan");
  await probe("eksekusi", "https://admin.kustoro2026.com/marketplace/blibli/eksekusi");
  await probe("pemetaan", "https://admin.kustoro2026.com/marketplace/blibli/pemetaan");
  await probe("api orders", "https://admin.kustoro2026.com/api/blibli/orders");
  await probe("api exec", "https://admin.kustoro2026.com/api/blibli/exec", { method: "POST" });
  await probe("api map", "https://admin.kustoro2026.com/api/blibli/map");
})();
