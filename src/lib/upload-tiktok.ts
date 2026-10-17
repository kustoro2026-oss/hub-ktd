// Upload produk baru ke TikTok Shop (Tahap 6) — port dari
// scripts/tiktok-fill2.ts (alur file bulk yang SUDAH TERBUKTI diterima
// Seller Center TikTok). Template resmi V5.0.2 (t1..t12, satu per pohon
// kategori) diisi lewat bedah XML zip langsung: lib xlsx TIDAK dipakai
// untuk menulis karena <dimension> template basi (A3:AB6) sehingga
// SheetJS membuang baris tersembunyi 1-2, 7997 data validation, dan baris
// data kosong 8-2000 yang dipakai TikTok untuk validasi struktur.
//
// Perbedaan dengan script asli:
//   - Sumber data = aneka-master.json (snapshot sweep) + blibli-detail.json
//     (deskripsi & gambar hasil scrape).
//   - Template = modul base64 (tiktok-templates.ts) supaya ikut ter-bundle
//     di deploy Vercel (fs.readFileSync saat runtime tidak dijamin ada).
//   - Peta kategori slim (tiktok-catmap.json: 415 nama + 5 aturan fallback)
//     + daftar nama produk TikTok live (tiktok-live-names.json) sebagai
//     gerbang "sudah ada di TikTok".
//   - Gerbang aturan Tahap 5: status tiktok "blokir"/"review" menolak.
//   - SATU BARIS PER PRODUK (tanpa ekspansi varian): hasil upload adalah
//     DRAFT yang wajib diedit per-draft sebelum dikirim.
//   - Output = ZIP berisi satu xlsx per template kategori (unduh via hub,
//     ekstrak, lalu unggah per-file ke Batch Tool Seller Center TikTok).
//   - Gambar WAJIB tautan langsung anekadropship.id (URL proxy wsrv.nl
//     ditolak TikTok: "Tautan gambar ini gagal diproses").
//
// Penyimpanan file: fungsi ini MURNI menghasilkan Buffer; penulisan ke
// disk/log DB dilakukan oleh route /api/aneka/upload (kanal=tiktok).
import * as zlib from "node:zlib";
import * as XLSX from "xlsx";
import {
  listAnekaMaster,
  getAnekaMasterById,
  type AnekaMasterProduct,
} from "@/lib/aneka-master";
import { cekAturanProduk } from "@/lib/aturan-produk";
import { listAnekaProductMaps } from "@/lib/db";
import { sanitasiDeskripsiLazada as sanitasiDeskripsi } from "@/lib/upload-lazada";
import catmapRaw from "@/lib/tiktok-catmap.json";
import liveNamesRaw from "@/lib/tiktok-live-names.json";
import detailRaw from "@/lib/blibli-detail.json";

const SITE_URL = "https://toko.kustoro2026.com";
// URL gambar ini mati permanen di server Aneka (dibuang dari slot gambar).
const BROKEN_URL =
  "https://anekadropship.id/uploads/products/1769842384_697da6d0e28da.webp";

type CatmapTikTok = {
  templates: Record<string, string>;
  leaves: Record<string, { path: string; tpl: string }>;
  maps: Record<string, { leaf: string }>;
};
type DetailAneka = { description?: string; images?: string[] };

const CATMAP = catmapRaw as unknown as CatmapTikTok;
const LIVE_NAMES = liveNamesRaw as string[];
const DETAIL = detailRaw as Record<string, DetailAneka>;

// ─── Produk WA-only (port dari src/lib/config toko web) ──────────────────────
// Parfum berindikasi HKI: hanya boleh dijual via WhatsApp — tidak boleh ikut
// file upload marketplace mana pun. Pencocokan: nama berawalan "parfum " +
// token pada nama ternormalisasi.
const WA_ONLY_TOKENS = [
  "cahnxl",
  "op1um",
  "invictus",
  "b4cca",
  "aqkva",
  "gold ribbon",
  "jennifer lopez",
  "zara oriental",
  "gucci",
];

function isWaOnlyProduct(name: string): boolean {
  const key = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!key.startsWith("parfum ")) return false;
  return WA_ONLY_TOKENS.some((t) => key.includes(t));
}

// ─── Pemetaan kategori TikTok ────────────────────────────────────────────────
// 1) cocok persis nama ternormalisasi -> maps (415 entri dari generator aset)
// 2) aturan fallback regex -> daun kategori yang terbukti cocok
// 3) null = tidak terpetakan (produk tidak layak ikut file).

const FALLBACK_KATEGORI: { re: RegExp; leaf: string }[] = [
  { re: /madu|honey/i, leaf: "920328" }, // Bahan Makanan .../Madu & Sirup Maple
  { re: /dress.*anak|anak.*dress|gaun anak|happy little dress/i, leaf: "804744" }, // Pakaian Anak Perempuan/Gaun
  { re: /kemeja|batik/i, leaf: "804616" }, // Pakaian Anak Perempuan/Setelan Resmi & Setelan
  { re: /cctv/i, leaf: "930440" }, // Elektronik Mobil/CCTV
  { re: /kabel|charger|adaptor/i, leaf: "601937" }, // Aksesori Ponsel/Kabel, Charger & Adaptor
];

export type KategoriTikTok = {
  leaf: string;
  path: string;
  tpl: string;
  namaTpl: string;
};

function normNama(s: string): string {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function kategoriTikTok(name: string): KategoriTikTok | null {
  const leafId =
    CATMAP.maps[normNama(name)]?.leaf ??
    FALLBACK_KATEGORI.find((f) => f.re.test(name))?.leaf;
  if (!leafId) return null;
  const leaf = CATMAP.leaves[leafId];
  if (!leaf) return null;
  return {
    leaf: leafId,
    path: leaf.path,
    tpl: leaf.tpl,
    namaTpl: CATMAP.templates[leaf.tpl] ?? leaf.tpl,
  };
}

// Produk yang namanya (ternormalisasi, min 8 karakter) saling termuat dengan
// nama produk TikTok yang sudah LIVE -> anggap sudah ada di TikTok.
function terindikasiLive(name: string): boolean {
  const n = normNama(name);
  if (n.length < 8) return false;
  return LIVE_NAMES.some((l) => l.length >= 8 && (l.includes(n) || n.includes(l)));
}

// ─── Konsolidasi gudang (port dari scripts/tiktok-fill.ts) ───────────────────
// TikTok multi-warehouse maks 20 gudang; 43 lokasi seller asli digabung
// jadi 18. Header template memuat "Jumlah di {gudang}" untuk 18 nama ini
// (urutan sama di semua template).
const GUDANG_MAP: Record<string, string> = {
  "Jakarta Barat": "Gudang Jakarta",
  "Jakarta Utara": "Gudang Jakarta",
  "Jakarta Pusat": "Gudang Jakarta",
  "Jakarta Selatan": "Gudang Jakarta",
  "Jakarta Timur": "Gudang Jakarta",
  Bekasi: "Gudang Jakarta",
  Bogor: "Gudang Jakarta",
  Tangerang: "Gudang Tangerang Raya",
  "Tangerang Selatan": "Gudang Tangerang Raya",
  Bandung: "Gudang Bandung Raya",
  "Jawa Barat": "Gudang Bandung Raya",
  Cirebon: "Gudang Cirebon",
  Majalengka: "Gudang Cirebon",
  "Jawa Tengah": "Gudang Semarang Raya",
  Semarang: "Gudang Semarang Raya",
  Salatiga: "Gudang Semarang Raya",
  Sukoharjo: "Gudang Semarang Raya",
  Klaten: "Gudang Semarang Raya",
  "Ampel Boyolali": "Gudang Semarang Raya",
  "Kab Pekalongan": "Gudang Pekalongan",
  Brebes: "Gudang Pekalongan",
  Cilacap: "Gudang Cilacap",
  Sragen: "Gudang Sragen",
  Ngawi: "Gudang Ngawi",
  Madiun: "Gudang Madiun",
  Jombang: "Gudang Jombang",
  Surabaya: "Gudang Surabaya",
  "Wiyung Surabaya": "Gudang Surabaya",
  "Jawa Timur": "Gudang Surabaya",
  Sidoarjo: "Gudang Sidoarjo",
  "Gedangan Sidoarjo": "Gudang Sidoarjo",
  "Sooko Mojokerto": "Gudang Sidoarjo",
  Malang: "Gudang Malang",
  "Malang Jatim": "Gudang Malang",
  "Sukun Malang": "Gudang Malang",
  Jember: "Gudang Malang",
  "Istimewa Yogyakarta": "Gudang Yogyakarta",
  "Di Yogyakarta": "Gudang Yogyakarta",
  Bantul: "Gudang Yogyakarta",
  Balikpapan: "Gudang Balikpapan",
  Jambi: "Gudang Jambi",
  "Lampung Barat": "Gudang Lampung",
};
// 18 nama gudang yang pasti ada di header semua template (kolom 25-42).
const GUDANG_TEMPLATE = new Set([
  "Gudang Jakarta",
  "Gudang Jombang",
  "Gudang Pekalongan",
  "Gudang Ngawi",
  "Gudang Sidoarjo",
  "Gudang Tangerang Raya",
  "Gudang Cilacap",
  "Gudang Sragen",
  "Gudang Cirebon",
  "Gudang Madiun",
  "Gudang Bandung Raya",
  "Gudang Yogyakarta",
  "Gudang Semarang Raya",
  "Gudang Balikpapan",
  "Gudang Jambi",
  "Gudang Lampung",
  "Gudang Surabaya",
  "Gudang Malang",
]);

function gudangOf(lokasi: string): string {
  const key = (lokasi || "").trim();
  if (!key) return "Gudang Jakarta";
  return GUDANG_MAP[key] ?? GUDANG_MAP[key.toLowerCase()] ?? `Gudang ${key}`;
}

// ─── Berat & dimensi default (sama dengan tabel Lazada) ──────────────────────
const DEF: { re: RegExp; gram: number; dims: number[] }[] = [
  { re: /cincin|kalung|gelang|anting|liontin|giok|hematite/i, gram: 50, dims: [12, 10, 3] },
  { re: /madu/i, gram: 500, dims: [8, 8, 20] },
  { re: /(tas|ransel|sling|tote|clutch|dompet)/i, gram: 400, dims: [30, 20, 10] },
  { re: /(sepatu|sandal)/i, gram: 800, dims: [35, 25, 12] },
  { re: /(dress|gamis|kaftan|daster)/i, gram: 200, dims: [30, 25, 5] },
  { re: /(bor|drill|mesin|pompa|panci|panggangan|chopper)/i, gram: 1200, dims: [30, 25, 15] },
];
const DEF_DEFAULT = { gram: 300, dims: [20, 15, 10] };

function defaultsUntuk(name: string): { gram: number; dims: number[] } {
  for (const d of DEF) if (d.re.test(name)) return { gram: d.gram, dims: d.dims };
  return DEF_DEFAULT;
}

/** Parse volume "7 x 7 x 23 CM" -> [panjang, lebar, tinggi]. */
function parseVolumeToCm(vol: string): number[] | null {
  if (!vol) return null;
  const m = vol.match(
    /(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)/i,
  );
  if (!m) return null;
  const nums = [m[1], m[2], m[3]].map((v) =>
    Math.round(parseFloat(v.replace(",", "."))),
  );
  if (nums.some((n) => !Number.isFinite(n) || n <= 0)) return null;
  return nums;
}

/** Lepas wrapper wsrv.nl -> URL langsung anekadropship.id. */
function cleanImg(u: string): string {
  if (!u) return "";
  const m = u.match(/[?&]url=(https?%3A%2F%2F[^&]+)/i);
  if (m) return decodeURIComponent(m[1]);
  return u.trim();
}

// ─── Zip reader/writer minimal (store, no compression) — port fill2 ──────────

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const b of buf) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readZip(buf: Buffer): Map<string, Buffer> {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("bukan zip: EOCD tidak ditemukan");
  const count = buf.readUInt16LE(eocd + 10);
  const cdOff = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("central directory rusak");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const lnameLen = buf.readUInt16LE(localOff + 26);
    const lextraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lnameLen + lextraLen;
    const comp = buf.subarray(dataStart, dataStart + compSize);
    out.set(name, method === 8 ? zlib.inflateRawSync(comp) : comp);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function writeZip(entries: { name: string; data: Buffer }[]): Buffer {
  const parts: Buffer[] = [];
  const cd: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, "utf8");
    const crc = crc32(e.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6); // UTF-8
    lh.writeUInt16LE(0, 8); // store
    lh.writeUInt16LE(0, 10); // time
    lh.writeUInt16LE(0x0021, 12); // date 1980-01-01
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(e.data.length, 18);
    lh.writeUInt32LE(e.data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    parts.push(lh, nameBuf, e.data);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x0021, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(e.data.length, 20);
    ch.writeUInt32LE(e.data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    cd.push(ch, nameBuf);
    offset += 30 + nameBuf.length + e.data.length;
  }
  const cdStart = offset;
  const cdBuf = Buffer.concat(cd);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, cdBuf, eocd]);
}

function colLetter(i: number): string {
  let s = "";
  i = i + 1;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

function colToIdx(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function xmlEsc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r\n|\r|\n/g, "&#10;");
}

function textCell(ref: string, text: string): string {
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(text)}</t></is></c>`;
}

function numCell(ref: string, num: number): string {
  return `<c r="${ref}"><v>${num}</v></c>`;
}

// ─── Parsing template per kategori (di-cache dalam memori proses) ────────────
// sheet1.xml: baris 1-2 tersembunyi (kode field + tanda tangan V5.0.2),
// baris 3 header Indonesia, baris 4 Wajib/Opsional, baris 5 instruksi,
// baris 6 contoh, baris 8-2000 baris data kosong. TemplateConfig
// (dimensi benar) = sumber kode kolom 47+ (properti kategori).
// HiddenStyle = wajib/opsional/forbid per kolom per path kategori.
// HiddenAttr = opsi nilai valid per properti (untuk validasi isian).

type GayaKolom = "Mandatory" | "Optional" | "Forbid";

type ParsedTpl = {
  tpl: string;
  width: number;
  sheetName: string;
  sheetXml: string;
  zip: Map<string, Buffer>;
  colCat: number | null;
  colName: number | null;
  colDesc: number | null;
  colImg1: number | null;
  colWeight: number | null;
  colLen: number | null;
  colWid: number | null;
  colHei: number | null;
  colPrice: number | null;
  colSku: number | null;
  colSizeChart: number | null;
  whCol: Map<string, number>;
  propCols: { col: number; id: string; qualification: boolean }[];
  attrValues: Set<string>;
  styleRows: { path: string; styles: (string | null)[] }[];
};

const tplCache = new Map<string, ParsedTpl>();

async function muatTemplate(tpl: string): Promise<ParsedTpl> {
  const cached = tplCache.get(tpl);
  if (cached) return cached;

  const mod = await import("./tiktok-templates");
  const b64 = mod.TEMPLATE_TIKTOK_B64[tpl];
  if (!b64) throw new Error(`Template ${tpl} tidak ada di modul base64.`);
  const zipBuf = Buffer.from(b64, "base64");
  const zip = readZip(zipBuf);

  const sheetName = [...zip.keys()].find((k) =>
    /worksheets\/sheet1\.xml$/.test(k),
  );
  if (!sheetName) throw new Error(`${tpl}: sheet1.xml tidak ditemukan.`);
  const sheetXml = zip.get(sheetName)!.toString("utf8");

  // sharedStrings -> header baris 3
  const ssKey = [...zip.keys()].find((k) => /sharedStrings\.xml$/.test(k));
  if (!ssKey) throw new Error(`${tpl}: sharedStrings.xml tidak ditemukan.`);
  const ss: string[] = [];
  const ssRaw = zip.get(ssKey)!.toString("utf8");
  for (const m of ssRaw.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const parts = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]);
    ss.push(
      parts
        .join("")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#160;/g, "\u00a0")
        .replace(/&#10;/g, "\n"),
    );
  }

  const header = new Map<number, string>();
  for (const m of sheetXml.matchAll(
    /<c r="([A-Z]+)3"[^>]*t="s"[^>]*><v>(\d+)<\/v><\/c>/g,
  )) {
    header.set(colToIdx(m[1]), ss[parseInt(m[2], 10)] ?? "");
  }
  // Nama header memakai spasi non-breaking (\u00a0) antara "di" dan "Gudang".
  const normH = (s: string) => s.replace(/\u00a0/g, " ").trim();
  const findCol = (nama: string): number | null => {
    for (const [idx, h] of header) if (normH(h) === nama) return idx;
    return null;
  };
  const whCol = new Map<string, number>();
  for (const [idx, nama] of header) {
    const n = normH(nama);
    if (n.startsWith("Jumlah di ")) {
      whCol.set(n.slice("Jumlah di ".length).trim(), idx);
    }
  }

  // TemplateConfig/HiddenStyle/HiddenAttr punya dimensi benar -> aman via SheetJS.
  const wb = XLSX.read(zipBuf, { type: "buffer" });
  const tcAoa = XLSX.utils.sheet_to_json(wb.Sheets["TemplateConfig"], {
    header: 1,
    raw: false,
    defval: null,
  }) as (string | null)[][];
  const codes = tcAoa[0] ?? [];
  const width = codes.length;
  const propCols: { col: number; id: string; qualification: boolean }[] = [];
  for (let c = 47; c < width; c++) {
    const code = String(codes[c] ?? "");
    if (code.startsWith("product_property/")) {
      propCols.push({
        col: c,
        id: code.slice("product_property/".length),
        qualification: false,
      });
    } else if (code.startsWith("qualification/")) {
      propCols.push({ col: c, id: "", qualification: true });
    }
  }

  const hsAoa = XLSX.utils.sheet_to_json(wb.Sheets["HiddenStyle"], {
    header: 1,
    raw: false,
    defval: null,
  }) as (string | null)[][];
  const styleRows = hsAoa
    .filter((r) => r?.[0])
    .map((r) => ({
      path: String(r[0]),
      styles: r.slice(0, width).map((v) => (v ? String(v) : null)),
    }));

  const attrValues = new Set<string>();
  const haAoa = XLSX.utils.sheet_to_json(wb.Sheets["HiddenAttr"], {
    header: 1,
    raw: false,
    defval: null,
  }) as (string | null)[][];
  for (const row of haAoa) {
    // Baris = pasangan (path, nilai) — nilai di posisi ganjil.
    for (let i = 1; i < row.length; i += 2) {
      const v = row[i];
      if (v != null && String(v).trim()) attrValues.add(String(v).trim());
    }
  }

  const parsed: ParsedTpl = {
    tpl,
    width,
    sheetName,
    sheetXml,
    zip,
    colCat: findCol("Kategori"),
    colName: findCol("Nama produk"),
    colDesc: findCol("Deskripsi produk"),
    colImg1: findCol("Gambar utama"),
    colWeight: findCol("Berat paket(g)"),
    colLen: findCol("Panjang paket(cm)"),
    colWid: findCol("Lebar paket(cm)"),
    colHei: findCol("Tinggi paket(cm)"),
    colPrice: findCol("Harga Ritel (Mata Uang Lokal)"),
    colSku: findCol("SKU Penjual"),
    colSizeChart: findCol("Bagan Ukuran"),
    whCol,
    propCols,
    attrValues,
    styleRows,
  };
  tplCache.set(tpl, parsed);
  return parsed;
}

/** Gaya kolom untuk satu path kategori: cocok persis -> prefix terpanjang
 *  ("X/Y/Z" memakai baris "X/Y") -> semua Optional. */
function gayaKolom(t: ParsedTpl, path: string, col: number): GayaKolom {
  let row = t.styleRows.find((r) => r.path === path) ?? null;
  if (!row) {
    let best: (typeof t.styleRows)[number] | null = null;
    for (const r of t.styleRows) {
      if (path.startsWith(r.path + "/") && (!best || r.path.length > best.path.length)) {
        best = r;
      }
    }
    row = best;
  }
  const s = row?.styles[col];
  return s === "Mandatory" || s === "Forbid" ? s : "Optional";
}

// ─── Atribut pakaian (t2) & bagan ukuran — nilai terbukti diterima ───────────

const ATTR_DEWASA = {
  pola: "Motif All-Over",
  musim: "Semua musim",
  gaya: "Dasar",
  melar: "Sedikit",
  usia: "13-14 Tahun",
  bahan: "Katun",
};
const ATTR_ANAK = {
  pola: "Polos",
  musim: "Semua musim",
  gaya: "Simpel",
  melar: "Sedikit",
  usia: "5-6 Tahun",
  bahan: "Katun",
};
const ATTR_GAUN = {
  pola: "Bunga",
  musim: "Semua musim",
  gaya: "Imut",
  melar: "Sedikit",
  usia: "5-6 Tahun",
  bahan: "Katun",
};
const SIZE_CHART_ANAK = `${SITE_URL}/tabel-ukuran-anak.png`;
const SIZE_CHART_DEWASA = `${SITE_URL}/tabel-ukuran.png`;

type AtributPakaian = typeof ATTR_DEWASA;

function atributPakaian(name: string): AtributPakaian {
  if (/gaun|dress/i.test(name)) return ATTR_GAUN;
  if (/anak|bayi|balita|bocah|kids/i.test(name)) return ATTR_ANAK;
  return ATTR_DEWASA;
}

// ─── Kandidat upload (produk master belum ada di TikTok) ─────────────────────

export type KandidatTikTok = {
  id: string;
  name: string;
  lokasi: string;
  gudang: string;
  gudangFallback: boolean;
  hargaJual: number;
  stok: number;
  /** Verdict rule engine Tahap 5 untuk kanal TikTok. */
  statusAturan: "aman" | "perhatian" | "review" | "blokir";
  jumlahVarian: number;
  leaf: string;
  path: string;
  tpl: string;
  namaTpl: string;
  adaDeskripsi: boolean;
  jumlahGambar: number;
  /** Alasan TIDAK layak diikutkan file; kosong = layak. */
  alasan: string[];
  layak: boolean;
};

export type RingkasanKandidatTikTok = {
  totalMaster: number;
  sudahTerpetakan: number;
  baru: number;
  mati404: number;
  waOnly: number;
  liveName: number;
  layak: number;
  tidakLayak: number;
  varian: number;
  tanpaVarian: number;
  aman: number;
  perhatian: number;
  review: number;
  blokir: number;
  kategoriKosong: number;
  denganDeskripsi: number;
  tanpaDeskripsi: number;
  lokasiFallback: number;
};

/** Daftar produk master yang belum terpetakan ke TikTok (aneka_product_map +
 *  kesamaan nama dengan produk live) + verdict rule engine + kategori target.
 *  Produk status "404", parfum WA-only, dan nama yang sudah live dikeluarkan
 *  dari daftar tapi dihitung di ringkasan. */
export async function kandidatUploadTikTok(): Promise<{
  kandidat: KandidatTikTok[];
  ringkasan: RingkasanKandidatTikTok;
}> {
  const maps = await listAnekaProductMaps();
  const terpetakan = new Set(
    maps.map((r) => String(r.aneka_product_id ?? "")).filter(Boolean),
  );
  const semua = listAnekaMaster();

  const ringkasan: RingkasanKandidatTikTok = {
    totalMaster: semua.length,
    sudahTerpetakan: terpetakan.size,
    baru: 0,
    mati404: 0,
    waOnly: 0,
    liveName: 0,
    layak: 0,
    tidakLayak: 0,
    varian: 0,
    tanpaVarian: 0,
    aman: 0,
    perhatian: 0,
    review: 0,
    blokir: 0,
    kategoriKosong: 0,
    denganDeskripsi: 0,
    tanpaDeskripsi: 0,
    lokasiFallback: 0,
  };

  const kandidat: KandidatTikTok[] = [];
  for (const p of semua) {
    if (terpetakan.has(String(p.id))) continue;
    ringkasan.baru++;
    if (p.status === "404") {
      ringkasan.mati404++;
      continue;
    }
    if (isWaOnlyProduct(p.name)) {
      ringkasan.waOnly++;
      continue;
    }
    if (terindikasiLive(p.name)) {
      ringkasan.liveName++;
      continue;
    }

    const hasil = cekAturanProduk(p.name, p.kategori);
    const statusAturan = hasil.perKanal.tiktok;
    const kat = kategoriTikTok(p.name);
    const detail = DETAIL[String(p.id)];
    const varianAktif = (p.varian || []).filter((v) => v.aktif);
    const jumlahVarian = p.hasVarian ? varianAktif.length : 0;
    const gudang = gudangOf(p.lokasi || "");
    const gudangFallback = !GUDANG_TEMPLATE.has(gudang);
    const adaDeskripsi = Boolean(detail?.description);

    ringkasan[statusAturan]++;
    if (p.hasVarian) ringkasan.varian++;
    else ringkasan.tanpaVarian++;
    if (!kat) ringkasan.kategoriKosong++;
    if (adaDeskripsi) ringkasan.denganDeskripsi++;
    else ringkasan.tanpaDeskripsi++;
    if (gudangFallback) ringkasan.lokasiFallback++;

    const alasan: string[] = [];
    if (statusAturan === "blokir" || statusAturan === "review") {
      alasan.push(
        `aturan ${hasil.temuan
          .filter((t) => t.perKanal.tiktok === statusAturan)
          .map((t) => t.kode)
          .join(", ")}`,
      );
    }
    if (!kat) alasan.push("kategori tidak terpetakan");

    const layak = alasan.length === 0;
    if (layak) ringkasan.layak++;
    else ringkasan.tidakLayak++;

    kandidat.push({
      id: p.id,
      name: p.name,
      lokasi: p.lokasi,
      gudang,
      gudangFallback,
      hargaJual: p.rekomendasiJual || 0,
      stok: p.stok || 0,
      statusAturan,
      jumlahVarian,
      leaf: kat?.leaf || "",
      path: kat?.path || "",
      tpl: kat?.tpl || "",
      namaTpl: kat?.namaTpl || "",
      adaDeskripsi,
      jumlahGambar: (detail?.images || [p.image]).filter(Boolean).length,
      alasan,
      layak,
    });
  }

  return { kandidat, ringkasan };
}

// ─── Baris upload + bedah XML ────────────────────────────────────────────────

type CatatanBarisTikTok = {
  gudangFallback: boolean;
  tanpaDeskripsi: boolean;
  tanpaGambar: boolean;
  propertiWajibKosong: string[];
};

/** Isian properti kategori yang bisa diisi otomatis. Nilai wajib divalidasi
 *  terhadap opsi HiddenAttr template (kecuali deklarasi "Tidak" yang sudah
 *  terbukti diterima Seller Center tanpa ada di daftar opsi). */
function nilaiProperty(
  t: ParsedTpl,
  id: string,
  name: string,
): string | null {
  switch (id) {
    case "101066": // Nomor Ijin Edar (BPOM/PIRT) — "Tidak" terbukti lolos
    case "101734": // barang berbahaya — "Tidak"
      return "Tidak";
    case "100107": {
      // Jenis Garansi
      const v = "Tanpa Garansi";
      return t.attrValues.has(v) ? v : null;
    }
    case "100198": // Pola
    case "100397": // Musim
    case "100398": // Gaya
    case "100400": // Melar
    case "100433": // Usia yang Direkomendasikan
    case "100701": {
      // Bahan
      const a = atributPakaian(name);
      const v =
        id === "100198"
          ? a.pola
          : id === "100397"
            ? a.musim
            : id === "100398"
              ? a.gaya
              : id === "100400"
                ? a.melar
                : id === "100433"
                  ? a.usia
                  : a.bahan;
      return t.attrValues.has(v) ? v : null;
    }
    default:
      // 101084/101085 (nomor sertifikasi) dll: tidak bisa ditebak — kosong;
      // terbukti file tetap diterima (FIX t7) dan draft diedit manual.
      return null;
  }
}

/** Bangun sel-sel satu baris data untuk satu produk master (kolom base dari
 *  header baris 3 template, kolom properti 47+ dari TemplateConfig).
 *  Prasyarat: gerbang aturan/kategori/404/WA-only sudah lolos. */
function barisUntukProdukTikTok(
  p: AnekaMasterProduct,
  kat: KategoriTikTok,
  t: ParsedTpl,
  usedImg: Set<string>,
  rn: number,
): { cells: string[]; catatan: CatatanBarisTikTok } {
  const ref = (c: number | null) => (c == null ? null : `${colLetter(c)}${rn}`);
  const cells: string[] = [];
  const push = (c: number | null, s: string) => {
    if (c != null) cells.push(s);
  };

  const name = (p.name || "")
    .trim()
    .replace(/^[-\s]+/, "")
    .replace(/\s+/g, " ")
    .slice(0, 255);

  // Kategori: format "path (leafId)" — sama dengan file fill2 yang terbukti.
  push(t.colCat, textCell(ref(t.colCat)!, `${kat.path} (${kat.leaf})`));
  push(t.colName, textCell(ref(t.colName)!, name));

  const detail = DETAIL[String(p.id)];
  let desc = sanitasiDeskripsi(detail?.description || "")
    .replace(/\r/g, "")
    .trim();
  const tanpaDeskripsi = !desc;
  if (desc.length > 2000) desc = desc.slice(0, 2000);
  // Template mensyaratkan deskripsi min 20 karakter -> awali nama produk;
  // bila masih pendek, tambahkan path kategori (faktual, bukan klaim).
  if (desc.length < 20) {
    desc = (name + ". " + desc).trim();
    if (desc.length < 20) desc = (desc + ". Kategori: " + kat.path).trim();
  }
  desc = desc.slice(0, 2000);
  push(t.colDesc, textCell(ref(t.colDesc)!, desc));

  // Gambar: WAJIB tautan langsung (wsrv.nl ditolak TikTok), dedupe se-file,
  // buang URL mati yang diketahui.
  const srcs = (
    (detail?.images?.length ? detail.images : [p.image]).filter(Boolean) as string[]
  )
    .map((img) => (/^https?:\/\//i.test(img) ? img : SITE_URL + img))
    .map(cleanImg)
    .filter((u) => u && u !== BROKEN_URL);
  const imgs: string[] = [];
  for (const u of srcs) {
    if (imgs.length >= 9) break;
    if (usedImg.has(u)) continue;
    usedImg.add(u);
    imgs.push(u);
  }
  const tanpaGambar = imgs.length < 1;
  for (let i = 0; i < 9; i++) {
    if (t.colImg1 == null) break;
    push(t.colImg1 + i, textCell(ref(t.colImg1 + i)!, imgs[i] ?? ""));
  }

  const def = defaultsUntuk(name);
  const gram = +(p.beratGram || 0) > 0 ? +p.beratGram : def.gram;
  const dims = parseVolumeToCm(p.volume || "") || def.dims;
  push(t.colWeight, numCell(ref(t.colWeight)!, gram));
  push(t.colLen, numCell(ref(t.colLen)!, Math.round(dims[0] * 10) / 10));
  push(t.colWid, numCell(ref(t.colWid)!, Math.round(dims[1] * 10) / 10));
  push(t.colHei, numCell(ref(t.colHei)!, Math.round(dims[2] * 10) / 10));

  const price = Math.max(0, Math.round(+(p.rekomendasiJual) || 0));
  push(t.colPrice, numCell(ref(t.colPrice)!, price));

  // Stok ke kolom gudang produk (fallback: gudang pertama di template).
  let stockN = Math.max(1, Math.round(+(p.stok) || 1));
  if (stockN > 99999) stockN = 99999;
  const g = gudangOf(p.lokasi || "");
  let wIdx = t.whCol.get(g);
  const gudangFallback = wIdx == null;
  if (wIdx == null) wIdx = [...t.whCol.entries()][0][1];
  cells.push(numCell(ref(wIdx)!, stockN));

  // SKU penjual: preferensi SKU master; kosong -> KTD-{id}.
  const sku = String(p.sku?.trim() || `KTD-${p.id}`).slice(0, 50);
  push(t.colSku, textCell(ref(t.colSku)!, sku));

  // Bagan ukuran hanya untuk template Pakaian Anak (t2) — URL terbukti.
  if (t.tpl === "t2" && t.colSizeChart != null) {
    const chart = /anak|bayi|balita|bocah|kids/i.test(name)
      ? SIZE_CHART_ANAK
      : SIZE_CHART_DEWASA;
    push(t.colSizeChart, textCell(ref(t.colSizeChart)!, chart));
  }

  // Properti kategori (kolom 47+): isi sesuai gaya HiddenStyle.
  const propertiWajibKosong: string[] = [];
  for (const pc of t.propCols) {
    const style = gayaKolom(t, kat.path, pc.col);
    if (style === "Forbid") continue; // jangan pernah isi kolom Forbid
    if (pc.qualification) {
      // Sertifikat gambar (halal/BPOM/SNI) tidak pernah diisi otomatis.
      if (style === "Mandatory") {
        propertiWajibKosong.push(`sertifikat kolom ${colLetter(pc.col)}`);
      }
      continue;
    }
    const v = nilaiProperty(t, pc.id, name);
    if (v) {
      push(pc.col, textCell(ref(pc.col)!, v));
    } else if (style === "Mandatory") {
      // File tetap diterima tanpa properti wajib ini (bukti: FIX t7) —
      // hanya dicatat agar draft diedit manual di Seller Center.
      propertiWajibKosong.push(`properti ${pc.id} (kolom ${colLetter(pc.col)})`);
    }
  }

  return {
    cells,
    catatan: { gudangFallback, tanpaDeskripsi, tanpaGambar, propertiWajibKosong },
  };
}

export type HasilBuatFileTikTok = {
  buffer: Buffer;
  namaFile: string;
  jumlahProduk: number;
  jumlahBaris: number;
  fileList: string[];
  peringatan: string[];
};

/** Validasi + bangun ZIP berisi satu xlsx per template kategori untuk daftar
 *  id produk master. Melempar Error berpesan jelas bila ada id yang tidak
 *  valid / tidak layak. */
export async function buatFileUploadTikTok(
  ids: string[],
): Promise<HasilBuatFileTikTok> {
  if (!Array.isArray(ids) || !ids.length) {
    throw new Error("Pilih minimal satu produk.");
  }
  const unik = [...new Set(ids.map(String))];
  if (unik.length > 500) {
    throw new Error("Maksimal 500 produk per file.");
  }

  const masalah: string[] = [];
  const produk: { p: AnekaMasterProduct; kat: KategoriTikTok }[] = [];
  for (const id of unik) {
    const p = getAnekaMasterById(id);
    if (!p) {
      masalah.push(`id ${id}: tidak ada di master Aneka`);
      continue;
    }
    const hasil = cekAturanProduk(p.name, p.kategori);
    const statusAturan = hasil.perKanal.tiktok;
    if (statusAturan === "blokir" || statusAturan === "review") {
      masalah.push(
        `${p.name}: ${statusAturan} aturan (${hasil.temuan
          .filter((t) => t.perKanal.tiktok === statusAturan)
          .map((t) => t.kode)
          .join(", ")})`,
      );
      continue;
    }
    if (p.status === "404") {
      masalah.push(`${p.name}: produk nonaktif di Aneka (404)`);
      continue;
    }
    if (isWaOnlyProduct(p.name)) {
      masalah.push(`${p.name}: parfum WA-only (indikasi HKI)`);
      continue;
    }
    const kat = kategoriTikTok(p.name);
    if (!kat) {
      masalah.push(`${p.name}: kategori tidak terpetakan`);
      continue;
    }
    produk.push({ p, kat });
  }
  if (masalah.length) {
    throw new Error(`Produk tidak dapat diikutkan file:\n- ${masalah.join("\n- ")}`);
  }
  if (!produk.length) throw new Error("Tidak ada produk yang layak.");

  // Kelompokkan per template kategori.
  const grup = new Map<string, { p: AnekaMasterProduct; kat: KategoriTikTok }[]>();
  for (const x of produk) {
    const g = grup.get(x.kat.tpl) ?? [];
    g.push(x);
    grup.set(x.kat.tpl, g);
  }

  const usedImg = new Set<string>();
  const entries: { name: string; data: Buffer }[] = [];
  const fileList: string[] = [];
  let jumlahGudangFallback = 0;
  let jumlahTanpaDeskripsi = 0;
  let jumlahTanpaGambar = 0;
  let jumlahHargaRendah = 0;
  let jumlahVarian = 0;
  const daftarPropertiKosong: string[] = [];

  for (const [tpl, daftar] of [...grup.entries()].sort((a, b) =>
    a[0].localeCompare(b[0], undefined, { numeric: true }),
  )) {
    const t = await muatTemplate(tpl);
    let xml = t.sheetXml;

    daftar.forEach(({ p, kat }, k) => {
      const rn = 8 + k;
      const { cells, catatan } = barisUntukProdukTikTok(
        p,
        kat,
        t,
        usedImg,
        rn,
      );
      // Injeksi sel setelah tag buka <row r="N"> (baris kosong siap pakai).
      const rowTag = `<row r="${rn}">`;
      if (!xml.includes(rowTag)) {
        throw new Error(
          `${tpl}: <row r="${rn}"> tidak ditemukan (produk ke-${k + 1}).`,
        );
      }
      xml = xml.replace(rowTag, rowTag + cells.join(""));

      if (catatan.gudangFallback) jumlahGudangFallback++;
      if (catatan.tanpaDeskripsi) jumlahTanpaDeskripsi++;
      if (catatan.tanpaGambar) jumlahTanpaGambar++;
      if ((Number(p.rekomendasiJual) || 0) < 100) jumlahHargaRendah++;
      if (p.hasVarian) jumlahVarian++;
      for (const pk of catatan.propertiWajibKosong) {
        daftarPropertiKosong.push(`${p.name.slice(0, 40)}: ${pk}`);
      }
    });

    // Perbaiki <dimension> yang basi (template asli A3:AB6) agar mencakup
    // baris data. Tag raw berbentuk pasangan (<dimension ...></dimension>)
    // sehingga pola self-closing tidak cocok — ganti HANYA atribut ref,
    // pola yang sama dengan builder Blibli yang terbukti diterima platform.
    // Bukti TikTok: semua file FIX yang lolos Seller Center memuat dimension
    // terbaru (A1:BK7, A1:BB163, ...) sedangkan file lama yang masih basi
    // adalah batch yang gagal/bermasalah.
    xml = xml.replace(
      /<dimension ref="[^"]*"/,
      `<dimension ref="A1:${colLetter(t.width - 1)}${7 + daftar.length}"`,
    );

    const outEntries = [...t.zip.entries()].map(([nama, data]) =>
      nama === t.sheetName
        ? { name: nama, data: Buffer.from(xml, "utf8") }
        : { name: nama, data },
    );
    const namaFile = `${tpl}-${CATMAP.templates[tpl] ?? tpl}.xlsx`.replace(
      /[\\/:*?"<>|]/g,
      "-",
    );
    entries.push({ name: namaFile, data: writeZip(outEntries) });
    fileList.push(namaFile);
  }

  const buffer = writeZip(entries);

  const peringatan: string[] = [];
  if (jumlahVarian) {
    peringatan.push(
      `${jumlahVarian} produk punya varian: file memuat 1 baris per produk — hasil upload adalah DRAFT; pilih ukuran/warna per-draft di Seller Center sebelum dikirim.`,
    );
  }
  if (jumlahGudangFallback) {
    peringatan.push(
      `${jumlahGudangFallback} produk lokasinya tanpa kolom gudang di template (stok ditulis di kolom "Gudang Jakarta").`,
    );
  }
  if (jumlahTanpaDeskripsi) {
    peringatan.push(
      `${jumlahTanpaDeskripsi} produk memakai deskripsi fallback dari nama produk karena belum pernah di-scrape.`,
    );
  }
  if (jumlahTanpaGambar) {
    peringatan.push(`${jumlahTanpaGambar} produk tanpa gambar sama sekali (draft wajib dilengkapi manual).`);
  }
  if (jumlahHargaRendah) {
    peringatan.push(`${jumlahHargaRendah} produk harga jual < Rp 100 (cek ulang harga).`);
  }
  if (daftarPropertiKosong.length) {
    peringatan.push(
      `${daftarPropertiKosong.length} kolom properti wajib kosong (nomor sertifikasi dll — file tetap diterima, lengkapi per-draft): ${daftarPropertiKosong.slice(0, 5).join("; ")}${daftarPropertiKosong.length > 5 ? "; …" : ""}`,
    );
  }
  peringatan.push(
    "ZIP berisi satu file per template kategori — ekstrak lalu unggah per-file ke Batch Tool Seller Center TikTok; CAPTCHA (jika muncul) diselesaikan manual.",
  );

  const tgl = new Date();
  const stempel = `${tgl.getFullYear()}${String(tgl.getMonth() + 1).padStart(2, "0")}${String(
    tgl.getDate(),
  ).padStart(2, "0")}-${String(tgl.getHours()).padStart(2, "0")}${String(
    tgl.getMinutes(),
  ).padStart(2, "0")}`;

  return {
    buffer,
    namaFile: `tiktok-upload-baru-${stempel}.zip`,
    jumlahProduk: produk.length,
    jumlahBaris: produk.length,
    fileList,
    peringatan,
  };
}
