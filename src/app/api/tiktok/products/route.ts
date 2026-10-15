// Daftar produk TikTok Shop semua toko terotorisasi (baca API produk).
// Filter: state (ACTIVATE/SELLER_DEACTIVATED/DRAFT/PENDING/FAILED/ALL),
// q (cari judul — API produk TikTok tidak punya filter judul, jadi halaman
// dipindai lalu disaring di sini), pageToken (halaman berikutnya).
import { isAuthed } from "@/lib/auth";
import { listTiktokShopTokens } from "@/lib/db";
import { searchTiktokProducts, type TiktokProductRow } from "@/lib/tiktok-products";
import { prepareShop } from "@/lib/tiktok-orders";

export const dynamic = "force-dynamic";

const STATES = new Set([
  "ACTIVATE",
  "SELLER_DEACTIVATED",
  "DRAFT",
  "PENDING",
  "FAILED",
  "ALL",
]);
/** Batas pemindaian saat cari judul (100 produk per halaman). */
const MAKS_SCAN_HALAMAN = 20;
const MAKS_HASIL_CARI = 300;

export async function GET(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }

  const url = new URL(request.url);
  const rawState = url.searchParams.get("state") ?? "ACTIVATE";
  const state = STATES.has(rawState) ? rawState : "ACTIVATE";
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const pageToken = (url.searchParams.get("pageToken") ?? "").trim();

  const shops = await listTiktokShopTokens();
  if (shops.length === 0) {
    return Response.json({
      ok: false,
      detail: "Belum ada toko TikTok Shop yang terotorisasi.",
    });
  }
  const shop = shops[0];
  const prep = await prepareShop(shop);
  if (!prep.ok) return Response.json({ ok: false, detail: prep.detail });

  try {
    if (q !== "") {
      // Mode cari: pindai halaman demi halaman (100/halaman) lalu saring
      // judul produk di sisi server.
      let token = "";
      let scanned = 0;
      const hasil: TiktokProductRow[] = [];
      for (let i = 0; i < MAKS_SCAN_HALAMAN; i++) {
        const page = await searchTiktokProducts(prep, {
          status: state,
          pageSize: 100,
          pageToken: token,
        });
        if (!page.ok) return Response.json({ ok: false, detail: page.detail });
        scanned += 1;
        for (const p of page.items) {
          if (p.title.toLowerCase().includes(q)) hasil.push(p);
        }
        if (!page.nextPageToken) break;
        token = page.nextPageToken;
      }
      const items = hasil.slice(0, MAKS_HASIL_CARI);
      return Response.json({
        ok: true,
        shopName: shop.shop_name,
        items,
        totalCount: items.length,
        searchMode: true,
        scanned,
      });
    }

    const page = await searchTiktokProducts(prep, {
      status: state,
      pageSize: 50,
      pageToken,
    });
    if (!page.ok) return Response.json({ ok: false, detail: page.detail });
    return Response.json({
      ok: true,
      shopName: shop.shop_name,
      items: page.items,
      totalCount: page.totalCount,
      nextPageToken: page.nextPageToken,
    });
  } catch (e) {
    return Response.json({
      ok: false,
      detail: `Kesalahan server: ${
        e instanceof Error ? e.message : "tidak dikenal"
      }`,
    });
  }
}
