// Upload produk baru ke Lazada (Tahap 6) — port dari
// scripts/lazada-build-full.cjs (alur file bulk yang SUDAH TERBUKTI: 647
// SKU sukses dimuat ke Seller Center Lazada via "Tambahkan Secara Massal").
// Perbedaan dengan script asli:
//   - Sumber data = aneka-master.json (snapshot sweep) + blibli-detail.json
//     (deskripsi & gambar hasil scrape) — tidak ada _work647.json lagi.
//   - Template xlsx = modul base64 (lazada-upload-template.ts) supaya ikut
//     ter-bundle di deploy Vercel (fs.readFileSync saat runtime tidak
//     dijamin tersedia di serverless).
//   - Peta kategori slim (lazada-catmap.json, 142 catId) hanya memuat catId
//     yang dipakai rule table di bawah — divalidasi generator terhadap
//     _catmap-full.json (3088 entri).
//   - Gerbang aturan Tahap 5: status lazada "blokir"/"review" menolak.
//   - SATU BARIS PER PRODUK (tanpa ekspansi varian): hasil upload adalah
//     DRAFT yang wajib diedit per-draft sebelum dikirim (ukuran, warna,
//     atribut kategori, garansi). Kolom stok per-gudang pun diabaikan
//     Lazada saat pembuatan draft — stok diisi lewat "Perbarui Produk".
//
// Penyimpanan file: fungsi ini MURNI menghasilkan Buffer; penulisan ke
// disk/log DB dilakukan oleh route /api/aneka/upload (kanal=lazada).
import * as XLSX from "xlsx";
import {
  listAnekaMaster,
  getAnekaMasterById,
  type AnekaMasterProduct,
} from "@/lib/aneka-master";
import { cekAturanProduk } from "@/lib/aturan-produk";
import { listLazadaProductMaps } from "@/lib/db";
import catmapRaw from "@/lib/lazada-catmap.json";
import planRaw from "@/lib/blibli-upload-plan.json";
import detailRaw from "@/lib/blibli-detail.json";

// ─── Tipe data pendukung ───────────────────────────────────────────────────

type TitikPickup = {
  location: string[];
  ppCode: string;
  name: string;
};

type RencanaPickup = {
  description: string;
  phone: string;
  existing: TitikPickup[];
  new: TitikPickup[];
};

type DetailAneka = {
  description?: string;
  images?: string[];
};

const SITE_URL = "https://toko.kustoro2026.com";
const PLAN = planRaw as unknown as RencanaPickup;
const CATMAP: Record<string, string> = catmapRaw as Record<string, string>;
const DETAIL: Record<string, DetailAneka> = detailRaw as Record<
  string,
  DetailAneka
>;

// ─── Pemetaan kategori Lazada (port RULES dari lazada-build-full.cjs) ───────
// [regex, catId] — urutan = prioritas, first match wins. catId placeholder
// (mis. "TSHIRT") di-resolve oleh decideLazada() sesuai gender/segmen nama.
// Semua catId hasil resolve WAJIB ada di CATMAP (dijaga generator aset).

type RuleLazada = { re: RegExp; cat: string; sub?: RegExp | string };

const RULES: RuleLazada[] = [
  // == bedding (sebelum 'sarung' umum) ==
  { re: /sarung bantal|sarung guling|bed ?cover|set sarung/i, cat: "16396" },
  { re: /sprei|bed ?sheet/i, cat: "16401" },
  // == hewan / ternak (sebelum aturan salon/obat manusia) ==
  { re: /salep|obat kulit|scabies|jamur/i, cat: "62114804", sub: /kucing|anjing|anabul|kelinci/ },
  { re: /x-?worm|obat cacing|deworm/i, cat: "62114804" },
  { re: /vitamin nafsu|multivitamin.*(kucing|anjing|hewan|ternak)|vita plus/i, cat: "62114404" },
  { re: /pupdeo|litter ?box|pengusir kucing|cat ?repeller/i, cat: "16156" },
  { re: /cat grass|camilan kucing|snack kucing|makanan kucing/i, cat: "16081" },
  { re: /penghilang bau.*(kandang|amoniak)|amoniak/i, cat: "16156" },
  { re: /pemerah telur|xantaxenthin|premix super|max centin/i, cat: "62114404" },
  {
    re: /ayam|unggas|ternak|sapi|kambing|domba|pedet|cempe/i,
    cat: "TERN",
    sub: "obat|antibiotik|cacing|gurem|kutu|lalat|scabies|flu|pilek|pinicillin|alfa ?tox|floxan|fludoxan|ecovet|oxi ?fit|herbaracik",
  },
  // == otomotif (sebelum aturan umum pembersih/shampoo) ==
  { re: /wax leather|wax kulit/i, cat: "17096" },
  { re: /semir (ban|karet)|tire (polish|shine)/i, cat: "17092" },
  { re: /shampo ?(mobil|moto)|shampoo ultrafoam|ultrafoam|car ?wash/i, cat: "17083" },
  { re: /jamur kaca|stiker kaca|rain ?proof|fog/i, cat: "17083" },
  { re: /tambal kaca|windshield|crack ?repair/i, cat: "17621" },
  { re: /daun talas|glass coating/i, cat: "17082" },
  { re: /rubbing compound|kompon|black magic|penghitam (body|cat)|instant coating/i, cat: "17082" },
  { re: /interior cleaner|pembersih interior/i, cat: "17096" },
  { re: /pembersih mesin|engine (degreaser|cleaner)/i, cat: "17083" },
  { re: /pelumas|gemuk|grease|lubricant/i, cat: "17073" },
  { re: /fuel|additive|solar boros|injector/i, cat: "17067" },
  { re: /essen/i, cat: "15636" },
  // == manusia: herbal / madu / vitamin ==
  { re: /ambeien|wasir|hemorrhoid/i, cat: "62470802" },
  { re: /madu|honey/i, cat: "18437" },
  { re: /vitamin|multivitamin/i, cat: "11382" },
  { re: /koyo|salep|pegal|linu|nyeri|analgesik|topedy|lumbo/i, cat: "18077" },
  { re: /penyedap|penambah rasa|glutamin/i, cat: "18172" },
  { re: /cuka/i, cat: "10003367" },
  { re: /kopi/i, cat: "10003099" },
  { re: /sari lemon|lemon.*(diet|detoks)/i, cat: "10100622" },
  { re: /sereal|multigrain|cereal/i, cat: "10003108" },
  { re: /chia/i, cat: "10003334" },
  { re: /vanilla.*(bean|pod|gourmet)/i, cat: "18172" },
  { re: /vanilla ?extract/i, cat: "10003263" },
  { re: /susu bubuk|milk powder/i, cat: "18471" },
  { re: /serum vitalitas|eros|vitalitas pria|4g joss|minyak pria|thormax|underarm|body (serum|whitening|enhancer)/i, cat: "10003015" },
  { re: /collagen|kolagen/i, cat: "6330" },
  { re: /probiotik|kapsul|herbal|jamu/i, cat: "18202" },
  { re: /kurma/i, cat: "10003461" },
  // == fashion muslim ==
  { re: /sarung anak|sarung (bocah|balita)/i, cat: "62543202" },
  { re: /koko anak|muslim.*anak laki/i, cat: "62104201" },
  { re: /baju koko|muslimin/i, cat: "17965" },
  { re: /kaftan anak/i, cat: "42032201" },
  { re: /kaftan/i, cat: "6789" },
  { re: /sarung/i, cat: "62541402" },
  { re: /gamis|jubah/i, cat: "6789" },
  // == kids ==
  { re: /dress.*anak|anak.*dress|gaun anak|happy little dress/i, cat: "10496" },
  { re: /(piyama|piama|pyjama|sleepwear|setelan tidur).*(anak|bayi)|(anak|bayi).*(piyama|piama|pyjama|sleepwear)/i, cat: "KIDSPJ" },
  { re: /(setelan|one ?set|oneset|jumpsuit|romper).*(anak|bayi|usia|kawai)|(anak|bayi).*(setelan|jumpsuit|romper)|^\s*set\s+anak\b/i, cat: "KIDSSET" },
  { re: /(kaos|t-?shirt|tee)\b.*\b(anak|bayi)|\b(anak|bayi)\b.*\b(kaos|t-?shirt|tee)\b/i, cat: "KIDSTEE" },
  { re: /(celana|jogger|chino)\b.*\b(anak|bayi)|\b(anak|bayi)\b.*\b(celana|jogger|chino)\b/i, cat: "KIDSPANT" },
  // == dewasa fashion ==
  { re: /daster|piyama|piama|sleepwear|setelan tidur/i, cat: "15838" },
  { re: /\brok\b|\bskirt\b/i, cat: "SKIRT" },
  { re: /sweater|hoodie|cardigan/i, cat: "SWEATER" },
  { re: /kemeja.*(pria|laki)|batik (pria|laki)|kemeja batik/i, cat: "6553" },
  { re: /kemeja|blouse|atasan wanita/i, cat: "14942" },
  { re: /hot ?pants/i, cat: "14917" },
  { re: /vest|rompi/i, cat: "6602" },
  { re: /kaos|t-?shirt/i, cat: "TSHIRT" },
  { re: /celana|jogger|chino/i, cat: "PANTS" },
  // == sepatu / sandal ==
  { re: /hemmels|sandal pesta|sepatu pesta|heels|pumps|kondangan|selop pesta/i, cat: "5824" },
  { re: /sandal jepit|slide/i, cat: "14945" },
  { re: /sandal (kulit|pria)|joemen.*sandal/i, cat: "14946" },
  { re: /sandal (wanita|flat)|flat ?shoes|ballet/i, cat: "14910" },
  { re: /sandal rumah|house slipper/i, cat: "18021" },
  { re: /hiking|gunung/i, cat: "6948" },
  { re: /boots|docmart/i, cat: "5895" },
  { re: /pantofel|formal|kerja.*sepatu|sepatu.*kerja/i, cat: "5898" },
  { re: /sandal anak|sepatu anak/i, cat: "10513" },
  { re: /sandal/i, cat: "14945" },
  { re: /sepatu|sneakers/i, cat: "4917" },
  // == tas ==
  { re: /pembersih tas/i, cat: "17982" },
  { re: /dompet/i, cat: "17983" },
  { re: /koper|bagasi/i, cat: "17994" },
  { re: /ransel|backpack/i, cat: "RANSEL" },
  { re: /clutch/i, cat: "17938" },
  { re: /tote/i, cat: "17935" },
  { re: /laptop|ljinjing/i, cat: "17943" },
  { re: /waist ?bag|tas pinggang/i, cat: "17936" },
  { re: /sling|shoulder|selempang|bahu|sling ?bag/i, cat: "17936" },
  { re: /tas |tote ?bag/i, cat: "17937" },
  // == perhiasan / aksesoris ==
  { re: /cincin|ring/i, cat: "17296" },
  { re: /giok|jade/i, cat: "10100856" },
  { re: /kalung|liontin/i, cat: "10100814" },
  { re: /gelang|bracelet/i, cat: "17298" },
  { re: /anting|earring/i, cat: "10100811" },
  { re: /gantungan kunci|key ?chain/i, cat: "17991" },
  { re: /stiker anak|buku stiker|album stiker/i, cat: "16706" },
  // == kecantikan / perawatan ==
  { re: /pomade|hair ?spray/i, cat: "3710" },
  { re: /hair ?tonic|hair ?care ?essence|minyak (kemiri|rambut)/i, cat: "3718" },
  { re: /shampo|shampoo|sampo/i, cat: "3708" },
  { re: /toothpaste|pasta gigi/i, cat: "3735" },
  { re: /sabun cuci|pembersih (tumbler|botol)/i, cat: "18399" },
  { re: /sabun|soap/i, cat: "10003070" },
  { re: /deodorant|deodoran/i, cat: "3739" },
  { re: /nail|kuku/i, cat: "18213" },
  { re: /parfum|oud|arabiyat|artistry|lamsat|scentnice/i, cat: "PARFUM" },
  { re: /masks?er.*kaki|foot ?masks?/i, cat: "18194" },
  { re: /heel|tumit|kaki/i, cat: "18193" },
  { re: /toner/i, cat: "11406" },
  { re: /facial wash|cuci muka|cleanser/i, cat: "11401" },
  { re: /sunscreen|sunblock|spf/i, cat: "11405" },
  { re: /serum|essence/i, cat: "11407" },
  { re: /moistur|nutricream|brightening|bekas luka|jerawat|crea[m]?|losion|lotion/i, cat: "10100737" },
  { re: /nose|hidung|penirus|selotip/i, cat: "3807" },
  { re: /pijat|massage|urut|roller|guasha/i, cat: "62474001" },
  { re: /sisir|comb/i, cat: "18206" },
  // == rumah tangga: kebersihan ==
  { re: /pembersih kaca|glass ?cleaner/i, cat: "10003390" },
  { re: /kerak|kloset|toilet|kamar mandi|wastafel/i, cat: "10003382" },
  { re: /racun (tikus|semut|kecoa)/i, cat: "18378" },
  { re: /katakill|serangga|insect|kutu|tungau|ngengat|naphtalene|kamper|pembasmi/i, cat: "18381" },
  { re: /pembersih (sofa|karpet|kasur)/i, cat: "10003386" },
  { re: /pembersih sepatu|shoe ?s? ?clean|pengharum sepatu|parfum sepatu/i, cat: "10003087" },
  { re: /kapsul.*(laundry|cuci)|laundry ?pods/i, cat: "62514802" },
  { re: /detergen|deterjen/i, cat: "DETERGENT" },
  { re: /pemutih|bleach|sodium percarbonate|pencerah warna/i, cat: "18392" },
  { re: /noda/i, cat: "18374" },
  { re: /silica|anti jamur/i, cat: "18404" },
  { re: /lilin lebah|wood.*(season|polish|wax)|pengkilap kayu/i, cat: "18400" },
  { re: /penghilang bau|pengharum|freshener|pewangi|aroma|wangi/i, cat: "10100546" },
  { re: /pembersih (wajan|meja|dapur|serbaguna|multi)|serbaguna|multipurpose/i, cat: "18399" },
  { re: /pembersih|cleaner|cleaning/i, cat: "18399" },
  { re: /pupuk|fertilizer/i, cat: "16649" },
  { re: /benih|bibit/i, cat: "16653" },
  { re: /paranet|jaring|net tanaman/i, cat: "16647" },
  { re: /asahan|pisau/i, cat: "16787" },
  { re: /lem perekat|perekat|sealant|anti bocor/i, cat: "16561" },
  { re: /panci|multi ?cooker/i, cat: "16303" },
  { re: /panggangan|grill|bbq/i, cat: "16304" },
  { re: /chopper|slicer|parutan|pengiris/i, cat: "16504" },
  // == elektronik / gadget ==
  { re: /cctv|kamera (pengintai|pemantau|ip)/i, cat: "18901" },
  { re: /charger/i, cat: "18872" },
  { re: /earbud|tws/i, cat: "15094" },
  { re: /headphone|headset|earphone/i, cat: "3562" },
  { re: /speaker/i, cat: "10100399" },
  { re: /lamp.*(taman|outdoor)|sorot|solar.*(lampu|light|jepit)/i, cat: "16447" },
  { re: /\blampu|\bled\b|bohlam/i, cat: "10100143" },
  { re: /cooler|heatsink|pendingin hp/i, cat: "3399" },
  { re: /gembok|disc ?lock/i, cat: "10100893" },
  { re: /drill|bor /i, cat: "16625" },
  { re: /cukur|clipper|trimmer/i, cat: "18225" },
  { re: /kipas tai chi|kipas lipat|kipas latihan|kipas(?! (angin|listrik))/i, cat: "10100301" },
  { re: /kipas angin|kipas listrik/i, cat: "10100301" },
  // == game ==
  { re: /gameboy|spare ?part.*game|stick game|batre bl/i, cat: "62473005" },
  { re: /game machine|rhythm|game digital/i, cat: "10100425" },
  { re: /boneka|plush/i, cat: "13878" },
  // == lainnya ==
  { re: /baju|pakaian|fashion/i, cat: "KIDSTEE" },
];

/** Resolve nama produk -> catId (port decide() dari lazada-build-full.cjs). */
function decideLazada(name: string): { catId: string | null; kode: string } {
  for (const r of RULES) {
    if (!r.re.test(name)) continue;
    const cat = r.cat;
    if (cat === "TERN") {
      const sub = typeof r.sub === "string" ? new RegExp(r.sub, "i") : r.sub;
      return sub && sub.test(name)
        ? { catId: "62114804", kode: "ternak-obat" }
        : { catId: "62114404", kode: "ternak-suplemen" };
    }
    const perempuan = /perempuan|cewe|girl|wanita/i.test(name);
    switch (cat) {
      case "KIDSSET":
        return { catId: perempuan ? "42070201" : "62543201", kode: "kidsset" };
      case "KIDSTEE":
        return { catId: perempuan ? "10494" : "10529", kode: "kidstee" };
      case "KIDSPANT":
        return { catId: perempuan ? "10495" : "11948", kode: "kidspant" };
      case "KIDSPJ":
        return { catId: perempuan ? "10501" : "10533", kode: "kidspj" };
      case "SKIRT":
        return { catId: /anak/i.test(name) ? "62544201" : "4963", kode: "skirt" };
      case "TSHIRT":
        return { catId: perempuan ? "2631" : "6537", kode: "tshirt" };
      case "PANTS":
        return { catId: perempuan ? "6560" : "6616", kode: "pants" };
      case "RANSEL":
        return { catId: /pria|laki/i.test(name) ? "10100762" : "17939", kode: "ransel" };
      case "SWEATER":
        return { catId: /pria|laki|cowok/i.test(name) ? "6570" : "6548", kode: "sweater" };
      case "PARFUM":
        return { catId: /oud al faris/i.test(name) ? "18061" : "18062", kode: "parfum" };
      case "DETERGENT":
        return /bubuk|powder/i.test(name)
          ? { catId: "18377", kode: "det-bubuk" }
          : { catId: "18371", kode: "det-cair" };
      default:
        return { catId: cat, kode: "rule" };
    }
  }
  return { catId: null, kode: "UNRESOLVED" };
}

/** Kategori Lazada untuk satu nama produk; null bila tidak terpetakan. */
export function kategoriLazada(
  name: string,
): { catId: string; enPath: string } | null {
  const { catId } = decideLazada(name);
  if (!catId) return null;
  const enPath = CATMAP[catId];
  if (!enPath) return null;
  return { catId, enPath };
}

// ─── Sanitasi deskripsi (pedoman konten Lazada) ─────────────────────────────
// Reviewer Lazada menolak deskripsi dengan disclaimer liabilitas, instruksi
// upload internal, ajakan menyamarkan brand, manipulasi ulasan, dan sebutan
// marketplace LAIN (kata "lazada" sendiri boleh; shopee/tokopedia dll tidak).
const DESC_DROP_LINE = [
  /META ADS/i,
  /panduan aman upload/i,
  /pelanggaran high quality \(hq\)|duplikasi produk/i,
  /modifikasi judul & deskripsi|lakukan parafrase/i,
  /variasi visual gambar|edit ulang gambar produk/i,
  /marketing kit/i,
  /di luar tanggung jawab/i,
  /shopee|blibli|tokopedia|bukalapak|tiktok|jd\.id|zalora|traveloka/i,
  /ulasan positif|review positif|penilaian terbaik|jangan lupa|lupakan untuk|untuk pelayanan kami/i,
];
const DESC_DROP_SENTENCE = [
  /video unboxing/i,
  /kerusakan akibat ekspedisi/i,
  /upload di marketplace/i,
];

export function sanitasiDeskripsiLazada(text: string): string {
  if (!text) return text;
  const out: string[] = [];
  for (let line of String(text).split("\n")) {
    // Klausa menyatu "packing aman ... kerusakan akibat ekspedisi" -> sisakan
    // bagian packing.
    if (/kerusakan akibat ekspedisi/i.test(line) && /packing aman/i.test(line)) {
      line = line
        .replace(/\s*[,.]?\s*(namun|dan)?\s*kerusakan akibat ekspedisi[^.]*\.?\s*$/i, "")
        .trim();
      if (line && !/[.!]$/.test(line)) line += ".";
      if (line) out.push(line);
      continue;
    }
    if (DESC_DROP_LINE.some((re) => re.test(line))) continue;
    if (DESC_DROP_SENTENCE.some((re) => re.test(line))) {
      const kept = line
        .split(/(?<=[.!?])\s+/)
        .filter((s) => s.trim() && !DESC_DROP_SENTENCE.some((re) => re.test(s)));
      line = kept.join(" ").trim();
      if (!line) continue;
    }
    out.push(line);
  }
  return out.join("\n").replace(/\n{2,}/g, "\n").trim();
}

// ─── Peta lokasi seller -> nama gudang Lazada ───────────────────────────────

const LOC_TO_GUDANG = new Map<string, string>();
for (const e of PLAN.new) for (const l of e.location) LOC_TO_GUDANG.set(l, e.name);
for (const e of PLAN.existing)
  for (const l of e.location || []) LOC_TO_GUDANG.set(l, e.name);
// Existing entry Cengkareng: nama gudang Lazada-nya "KTD Store".
LOC_TO_GUDANG.set("Jakarta Barat", "KTD Store");
// Lokasi korup "X Cm" (1297): alias nama gudang 'Jawa Tengah'.
LOC_TO_GUDANG.set("X Cm", LOC_TO_GUDANG.get("Jawa Tengah") || "Jawa Tengah");

let whColPromise: Promise<Record<string, number>> | null = null;

/** Nama gudang -> indeks kolom (0-based) di baris header sheet template
 *  (kolom 27-66 = 40 kolom per-gudang). Diparse dari template base64 dan
 *  di-cache dalam memori proses. */
function kolomGudang(): Promise<Record<string, number>> {
  if (!whColPromise) {
    whColPromise = (async () => {
      const mod = await import("./lazada-upload-template");
      const wb = XLSX.read(Buffer.from(mod.TEMPLATE_LAZADA_XLSX_B64, "base64"), {
        type: "buffer",
      });
      const ws = wb.Sheets["template"];
      if (!ws) throw new Error('Sheet "template" tidak ditemukan di template.');
      const whCol: Record<string, number> = {};
      for (let c = 27; c <= 66; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
        if (cell && cell.v) whCol[String(cell.v)] = c;
      }
      return whCol;
    })();
  }
  return whColPromise;
}

/** Gudang tempat stok produk ditulis. Bila lokasi tidak punya kolom gudang
 *  di template, fallback ke kolom "KTD Store". */
function gudangUntukLokasi(
  lokasi: string,
  whCol: Record<string, number>,
): { nama: string; fallback: boolean } {
  const nama =
    LOC_TO_GUDANG.get(lokasi) || LOC_TO_GUDANG.get((lokasi || "").trim());
  if (nama && whCol[nama] !== undefined) return { nama, fallback: false };
  if (whCol["KTD Store"] !== undefined) return { nama: "KTD Store", fallback: true };
  return { nama: "", fallback: true };
}

// ─── Berat & dimensi default (port dari lazada-build-full.cjs) ──────────────

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
  const m = vol.match(/(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)/i);
  if (!m) return null;
  const nums = [m[1], m[2], m[3]].map((v) => Math.round(parseFloat(v.replace(",", "."))));
  if (nums.some((n) => !Number.isFinite(n) || n <= 0)) return null;
  return nums;
}

function brandOf(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("nesilly")) return "NESILLY";
  if (n.includes("glow home") || n.includes("glowhome")) return "Glow Home";
  if (n.includes("jevarine")) return "Jevarine";
  if (n.includes("koyo")) return "KOYO";
  if (n.includes("kurma")) return "kurma";
  return "No Brand";
}

const prox = (u: string) =>
  "https://wsrv.nl/?url=" + encodeURIComponent(u) + "&output=jpg&w=800&h=800&fit=cover";

// Produk yang pernah gagal migrasi gambar di batch pilot: URL divariasikan
// (q=87) supaya tidak kena cache/dedupe sisi server.
const FAILIDS = new Set(["1556", "1332", "1328", "1305"]);

// ─── Kandidat upload (produk master belum terpetakan di Lazada) ─────────────

export type KandidatLazada = {
  id: string;
  name: string;
  lokasi: string;
  gudang: string;
  gudangFallback: boolean;
  hargaJual: number;
  stok: number;
  /** Verdict rule engine Tahap 5 untuk kanal Lazada. */
  statusAturan: "aman" | "perhatian" | "review" | "blokir";
  jumlahVarian: number;
  catId: string;
  enPath: string;
  adaDeskripsi: boolean;
  jumlahGambar: number;
  /** Alasan TIDAK layak diikutkan file; kosong = layak. */
  alasan: string[];
  layak: boolean;
};

export type RingkasanKandidatLazada = {
  totalMaster: number;
  sudahTerpetakan: number;
  baru: number;
  mati404: number;
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

/** Daftar produk master yang belum ada di lazada_product_map + verdict
 *  rule engine + kategori target. Produk status "404" (mati di Aneka)
 *  dikeluarkan dari daftar tapi dihitung di ringkasan. */
export async function kandidatUploadLazada(): Promise<{
  kandidat: KandidatLazada[];
  ringkasan: RingkasanKandidatLazada;
}> {
  const maps = await listLazadaProductMaps();
  const terpetakan = new Set(maps.map((r) => String(r.aneka_product_id ?? "")));
  const semua = listAnekaMaster();
  const whCol = await kolomGudang();

  const ringkasan: RingkasanKandidatLazada = {
    totalMaster: semua.length,
    sudahTerpetakan: terpetakan.size,
    baru: 0,
    mati404: 0,
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

  const kandidat: KandidatLazada[] = [];
  for (const p of semua) {
    if (terpetakan.has(String(p.id))) continue;
    ringkasan.baru++;
    if (p.status === "404") {
      ringkasan.mati404++;
      continue;
    }

    const hasil = cekAturanProduk(p.name, p.kategori);
    const statusAturan = hasil.perKanal.lazada;
    const kat = kategoriLazada(p.name);
    const detail = DETAIL[String(p.id)];
    const varianAktif = (p.varian || []).filter((v) => v.aktif);
    const jumlahVarian = p.hasVarian ? varianAktif.length : 0;
    const gd = gudangUntukLokasi(p.lokasi || "", whCol);
    const adaDeskripsi = Boolean(detail?.description);

    ringkasan[statusAturan]++;
    if (p.hasVarian) ringkasan.varian++;
    else ringkasan.tanpaVarian++;
    if (!kat) ringkasan.kategoriKosong++;
    if (adaDeskripsi) ringkasan.denganDeskripsi++;
    else ringkasan.tanpaDeskripsi++;
    if (gd.fallback) ringkasan.lokasiFallback++;

    const alasan: string[] = [];
    if (statusAturan === "blokir" || statusAturan === "review") {
      alasan.push(
        `aturan ${hasil.temuan
          .filter((t) => t.perKanal.lazada === statusAturan)
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
      gudang: gd.nama,
      gudangFallback: gd.fallback,
      hargaJual: p.rekomendasiJual || 0,
      stok: p.stok || 0,
      statusAturan,
      jumlahVarian,
      catId: kat?.catId || "",
      enPath: kat?.enPath || "",
      adaDeskripsi,
      jumlahGambar: (detail?.images || [p.image]).filter(Boolean).length,
      alasan,
      layak,
    });
  }

  return { kandidat, ringkasan };
}

// ─── Baris upload + penulisan xlsx ──────────────────────────────────────────

type KonteksBaris = {
  whCol: Record<string, number>;
  usedImg: Set<string>;
  groupNo: number;
};

type CatatanBaris = {
  gudangFallback: boolean;
  gambarKurang: boolean;
  tanpaDeskripsi: boolean;
};

/** Bangun satu baris data (67 kolom) untuk satu produk master. Prasyarat:
 *  gerbang aturan/kategori/404 sudah lolos di buatFileUploadLazada. */
function barisUntukProduk(
  p: AnekaMasterProduct,
  ctx: KonteksBaris,
): { baris: (string | number)[]; catatan: CatatanBaris } {
  const kat = kategoriLazada(p.name) as { catId: string; enPath: string };
  const detail = DETAIL[String(p.id)];
  const name = (p.name || "")
    .trim()
    .replace(/^[-\s]+/, "")
    .replace(/\s+/g, " ")
    .slice(0, 255);

  let desc = sanitasiDeskripsiLazada(detail?.description || "")
    .replace(/\r/g, "")
    .trim();
  const tanpaDeskripsi = !desc;
  if (desc.length > 3000) desc = desc.slice(0, 3000);
  // Template mensyaratkan deskripsi min 20 karakter -> awali nama produk;
  // bila masih pendek (nama singkat tanpa deskripsi scrape), tambahkan
  // path kategori (faktual, bukan klaim) sampai memenuhi syarat.
  if (desc.length < 20) {
    desc = (name + ". " + desc).trim();
    if (desc.length < 20) desc = (desc + ". Kategori: " + kat.enPath).trim();
  }
  desc = desc.slice(0, 3000);

  const srcs = ((detail?.images?.length ? detail.images : [p.image]).filter(
    Boolean,
  ) as string[]).map((img) => (/^https?:\/\//i.test(img) ? img : SITE_URL + img));
  const fix = FAILIDS.has(String(p.id));
  const imgs: string[] = [];
  for (const u of srcs) {
    if (imgs.length >= 8) break;
    if (ctx.usedImg.has(u)) continue;
    ctx.usedImg.add(u);
    imgs.push(fix ? prox(u) + "&q=87" : prox(u));
  }
  // Isi sampai min 3 gambar (URL divariasikan q/w agar tidak kena dedupe).
  let bi = 0;
  while (imgs.length < 3 && bi < srcs.length) {
    const u = srcs[bi++];
    imgs.push(
      "https://wsrv.nl/?url=" + encodeURIComponent(u) + "&output=jpg&q=85&w=795&h=795&fit=cover",
    );
  }
  const gambarKurang = imgs.length < 3;

  const def = defaultsUntuk(name);
  const gram = +(p.beratGram || 0) > 0 ? +p.beratGram : def.gram;
  const kg = Math.min(300, Math.max(0.01, Math.round((gram / 1000) * 100) / 100));
  const dims = parseVolumeToCm(p.volume || "") || def.dims;
  const [L, W, H] = dims;
  const price = Math.max(0, Math.round(+(p.rekomendasiJual) || 0));
  let stockN = Math.max(1, Math.round(+(p.stok) || 1));
  if (stockN > 99999) stockN = 99999;

  const gd = gudangUntukLokasi(p.lokasi || "", ctx.whCol);

  // 67 kolom: 0=GroupNo, 1=catId, 2=enPath, 3=nama, 4=nama EN, 5-12=8 foto,
  // 13=brand, 14=deskripsi, 15-20=kolom varian (draft), 21=H, 22=W, 23=L,
  // 24=kg, 25=harga, 26=SellerSKU, 27-66=stok per gudang.
  const row: (string | number)[] = new Array(67).fill("");
  row[0] = String(ctx.groupNo);
  row[1] = kat.catId;
  row[2] = kat.enPath;
  row[3] = name;
  row[4] = "";
  for (let i = 0; i < 8; i++) row[5 + i] = imgs[i] || "";
  row[13] = brandOf(name);
  row[14] = desc;
  row[21] = H;
  row[22] = W;
  row[23] = L;
  row[24] = kg;
  row[25] = price;
  row[26] = "KTD-" + p.id;
  if (gd.nama && ctx.whCol[gd.nama] !== undefined) {
    row[ctx.whCol[gd.nama]] = stockN;
  }

  return { baris: row, catatan: { gudangFallback: gd.fallback, gambarKurang, tanpaDeskripsi } };
}

export type HasilBuatFileLazada = {
  buffer: Buffer;
  namaFile: string;
  jumlahProduk: number;
  jumlahBaris: number;
  peringatan: string[];
};

/** Validasi + bangun file xlsx untuk daftar id produk master. Melempar
 *  Error berpesan jelas bila ada id yang tidak valid / tidak layak. */
export async function buatFileUploadLazada(
  ids: string[],
): Promise<HasilBuatFileLazada> {
  if (!Array.isArray(ids) || !ids.length) {
    throw new Error("Pilih minimal satu produk.");
  }
  const unik = [...new Set(ids.map(String))];
  if (unik.length > 500) {
    throw new Error("Maksimal 500 produk per file.");
  }

  const masalah: string[] = [];
  const produk: AnekaMasterProduct[] = [];
  for (const id of unik) {
    const p = getAnekaMasterById(id);
    if (!p) {
      masalah.push(`id ${id}: tidak ada di master Aneka`);
      continue;
    }
    const hasil = cekAturanProduk(p.name, p.kategori);
    const statusAturan = hasil.perKanal.lazada;
    if (statusAturan === "blokir" || statusAturan === "review") {
      masalah.push(`${p.name}: ${statusAturan} aturan (${hasil.temuan
        .filter((t) => t.perKanal.lazada === statusAturan)
        .map((t) => t.kode)
        .join(", ")})`);
      continue;
    }
    if (!kategoriLazada(p.name)) {
      masalah.push(`${p.name}: kategori tidak terpetakan`);
      continue;
    }
    if (p.status === "404") {
      masalah.push(`${p.name}: produk nonaktif di Aneka (404)`);
      continue;
    }
    produk.push(p);
  }
  if (masalah.length) {
    throw new Error(`Produk tidak dapat diikutkan file:\n- ${masalah.join("\n- ")}`);
  }
  if (!produk.length) throw new Error("Tidak ada produk yang layak.");

  const whCol = await kolomGudang();
  const usedImg = new Set<string>();
  const barisSemua: (string | number)[][] = [];
  let groupNo = 1;
  let jumlahGudangFallback = 0;
  let jumlahGambarKurang = 0;
  let jumlahTanpaDeskripsi = 0;
  let jumlahHargaRendah = 0;
  let jumlahVarian = 0;

  for (const p of produk) {
    const { baris, catatan } = barisUntukProduk(p, { whCol, usedImg, groupNo });
    barisSemua.push(baris);
    groupNo++;
    if (catatan.gudangFallback) jumlahGudangFallback++;
    if (catatan.gambarKurang) jumlahGambarKurang++;
    if (catatan.tanpaDeskripsi) jumlahTanpaDeskripsi++;
    if ((Number(p.rekomendasiJual) || 0) < 100) jumlahHargaRendah++;
    if (p.hasVarian) jumlahVarian++;
  }

  const peringatan: string[] = [];
  if (jumlahVarian) {
    peringatan.push(
      `${jumlahVarian} produk punya varian: file memuat 1 baris per produk — hasil upload adalah DRAFT; pilih ukuran/warna per-draft di Seller Center sebelum dikirim.`,
    );
  }
  if (jumlahGudangFallback) {
    peringatan.push(
      `${jumlahGudangFallback} produk lokasinya tanpa kolom gudang di template (stok ditulis di kolom "KTD Store").`,
    );
  }
  if (jumlahTanpaDeskripsi) {
    peringatan.push(
      `${jumlahTanpaDeskripsi} produk memakai deskripsi fallback dari nama produk karena belum pernah di-scrape.`,
    );
  }
  if (jumlahGambarKurang) {
    peringatan.push(`${jumlahGambarKurang} produk punya kurang dari 3 gambar.`);
  }
  if (jumlahHargaRendah) {
    peringatan.push(`${jumlahHargaRendah} produk harga jual < Rp 100 (cek ulang harga).`);
  }
  peringatan.push(
    'Kolom stok per-gudang diabaikan Lazada saat draft dibuat — draft lahir dengan stok 0; isi stok lewat "Perbarui Produk" massal setelah produk aktif.',
  );

  const mod = await import("./lazada-upload-template");
  const wb = XLSX.read(Buffer.from(mod.TEMPLATE_LAZADA_XLSX_B64, "base64"), {
    type: "buffer",
  });
  const ws = wb.Sheets["template"];
  if (!ws) throw new Error('Sheet "template" tidak ditemukan di template.');
  XLSX.utils.sheet_add_aoa(ws, barisSemua, { origin: -1 });
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const tgl = new Date();
  const stempel = `${tgl.getFullYear()}${String(tgl.getMonth() + 1).padStart(2, "0")}${String(
    tgl.getDate(),
  ).padStart(2, "0")}-${String(tgl.getHours()).padStart(2, "0")}${String(
    tgl.getMinutes(),
  ).padStart(2, "0")}`;

  return {
    buffer,
    namaFile: `lazada-upload-baru-${stempel}.xlsx`,
    jumlahProduk: produk.length,
    jumlahBaris: barisSemua.length,
    peringatan,
  };
}
