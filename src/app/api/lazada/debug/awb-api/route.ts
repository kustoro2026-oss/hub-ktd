// Rute debug admin (READ-ONLY): uji jalur API MURNI cetak AWB resmi —
//   /order/document/awb/html/get (HTML) dan /order/package/document/get
//   (PrintAWB, PDF) — untuk satu pesanan. Membantu menentukan format
//   parameter yang benar sebelum jalur ini dipasang permanen.
//
// Dipakai: GET /api/lazada/debug/awb-api?order_id=...&debug_awb=1
//   (cookie admin). TIDAK mengubah data pesanan/payload apa pun.
import { isAuthed } from "@/lib/auth";
import { getLazadaOrderExec } from "@/lib/db";
import {
  API_HOST,
  getLazadaAwbHtml,
  getLazadaCtx,
  signLazada,
} from "@/lib/lazada";

export const dynamic = "force-dynamic";

/** Panggil business API mentah tanpa membuka kode "0" — kembalikan JSON
 *  respons utuh supaya bentuk asli Lazada terlihat (bukan hasil olahan). */
async function callRaw(
  apiPath: string,
  params: Record<string, string>,
): Promise<{ code: string; message?: string; data?: unknown; raw?: string }> {
  const ctx = await getLazadaCtx();
  if (!ctx.ok) return { code: "ctx-gagal", message: ctx.detail };
  const signed: Record<string, string> = {
    app_key: ctx.appKey,
    timestamp: Date.now().toString(),
    sign_method: "sha256",
    access_token: ctx.accessToken,
    ...params,
  };
  signed.sign = signLazada(ctx.appSecret, apiPath, signed);
  const url = new URL(API_HOST + apiPath);
  for (const [k, v] of Object.entries(signed)) url.searchParams.set(k, v);
  try {
    const res = await fetch(url.toString(), { method: "GET", cache: "no-store" });
    const text = await res.text();
    try {
      const j = JSON.parse(text) as Record<string, unknown>;
      return {
        code: String(j.code ?? ""),
        message: String(j.message ?? ""),
        data: j.data,
      };
    } catch {
      return { code: "non-json", raw: text.slice(0, 300) };
    }
  } catch (e) {
    return { code: "fetch-gagal", message: String(e) };
  }
}

export async function GET(request: Request): Promise<Response> {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const orderId =
    new URL(request.url).searchParams.get("order_id")?.trim() ?? "";
  if (!orderId) {
    return Response.json({ error: "order_id kosong" }, { status: 400 });
  }

  const hasil: Record<string, unknown> = { order_id: orderId };

  // 1) Item pesanan — dump SEMUA kunci mentah (cari package_id di respons).
  const rawItems = await callRaw("/order/items/get", { order_id: orderId });
  const rawList = (rawItems.data as unknown[] | undefined) ?? [];
  const itemKeys = new Set<string>();
  const packageIdsDitemukan: string[] = [];
  for (const it of rawList) {
    if (it && typeof it === "object") {
      for (const k of Object.keys(it as Record<string, unknown>)) itemKeys.add(k);
      const row = it as Record<string, unknown>;
      for (const k of ["package_id", "packageId", "PackageId"]) {
        const v = row[k];
        if (v !== undefined && v !== null && String(v) !== "") {
          packageIdsDitemukan.push(`${k}=${String(v)}`);
        }
      }
    }
  }
  hasil.items = {
    code: rawItems.code,
    message: rawItems.message ?? "",
    jumlah: rawList.length,
    kunci: Array.from(itemKeys).sort(),
    package_id_di_items: packageIdsDitemukan,
  };

  const itemIds = rawList
    .map((x) => String((x as Record<string, unknown>)?.order_item_id ?? ""))
    .filter((x) => x !== "");

  // 2) AWB HTML resmi (awb/html/get) — tanpa package_id.
  if (itemIds.length > 0) {
    const html = await getLazadaAwbHtml(itemIds);
    if (html.ok) {
      const dec = Buffer.from(html.data.base64, "base64");
      hasil.awb_html = {
        ok: true,
        mime: html.data.mimeType,
        ukuran_base64: html.data.base64.length,
        kepala_base64: html.data.base64.slice(0, 60),
        ukuran_decode: dec.length,
        awalan: dec.subarray(0, 160).toString("utf8"),
      };
    } else {
      hasil.awb_html = { ok: false, detail: html.detail };
    }
  }

  // 3) PrintAWB — butuh package_id. Cari di payload antrean dulu, lalu di
  //    item mentah (bila ada).
  let packageId = "";
  const row = await getLazadaOrderExec(orderId);
  if (row) {
    try {
      const pl = JSON.parse(row.payload) as Record<string, unknown>;
      const v = pl.package_id ?? pl.packageId ?? "";
      if (String(v).trim() !== "") packageId = String(v).trim();
    } catch {
      // payload rusak — abaikan.
    }
  }
  if (!packageId) {
    const m = packageIdsDitemukan.join(",");
    const mm = /(?:package_id|packageId|PackageId)=([^,]+)/.exec(m);
    if (mm) packageId = mm[1];
  }
  hasil.package_id_dipakai = packageId;

  if (packageId) {
    // Variasi serialisasi param untuk menemukan format yang diterima.
    const varian: Array<[string, Record<string, string>]> = [
      [
        "getDocumentReq",
        {
          getDocumentReq:
            '{"doc_type":"PDF","packages":[{"package_id":"' + packageId + '"}]}',
        },
      ],
      [
        "getDocumentReq_kurung",
        {
          getDocumentReq:
            '{"doc_type":"PDF","packages":[{"package_id":["' + packageId + '"]}]}',
        },
      ],
      [
        "packages_terpisah",
        {
          packages: '[{"package_id":"' + packageId + '"}]',
          doc_type: "PDF",
        },
      ],
      [
        "package_id_datar",
        { package_id: packageId, doc_type: "PDF" },
      ],
    ];
    for (const [nama, params] of varian) {
      const r = await callRaw("/order/package/document/get", params);
      hasil["printawb_" + nama] = {
        code: r.code,
        message: r.message ?? "",
        data: r.data === undefined ? undefined : r.data,
      };
      if (r.code === "0") break;
    }
  } else {
    hasil.printawb = {
      dilewati: true,
      alasan: "package_id tidak ditemukan (payload maupun items/get)",
    };
  }

  return Response.json(hasil);
}
