// KTD Hub Tahap 6 — pembangkit file bulk-upload Blibli dari master Aneka.
//
// Port dari scripts/build-blibli-upload.cjs (alur file bulk yang SUDAH
// TERBUKTI lolos moderasi Blibli: 586 produk, 584/586 sukses per Sep 2026).
// Perbedaan dengan script asli:
//   - Sumber data = aneka-master.json (snapshot sweep) + blibli-detail.json
//     (deskripsi & gambar hasil scrape, lihat scripts/_gen-blibli-assets.cjs)
//     — tidak ada login/scrape saat runtime.
//   - Template xlsx = modul base64 (blibli-upload-template.ts) supaya ikut
//     ter-bundle di deploy Vercel (fs.readFileSync saat runtime tidak
//     dijamin tersedia di serverless).
//   - Varian dari master.varian (warna/ukuran terstruktur); sinkronisasi
//     enum resmi Blibli (blibli-variant-enums.json, 22MB) BELUM dipakai —
//     nilai ditulis apa adanya + peringatan bila ada baris varian.
//   - Gerbang aturan Tahap 5: status blibli "blokir"/"review" menolak.
//
// Penyimpanan file: fungsi ini MURNI menghasilkan Buffer; penulisan ke
// disk/log DB dilakukan oleh route /api/aneka/upload.
import { inflateRawSync, deflateRawSync } from "node:zlib";
import {
  listAnekaMaster,
  getAnekaMasterById,
  type AnekaMasterProduct,
} from "@/lib/aneka-master";
import { cekAturanProduk } from "@/lib/aturan-produk";
import { listBlibliProductMaps } from "@/lib/db";
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
const DEFAULT_PICKUP_POINT = "PP-3587819";
const PLAN = planRaw as unknown as RencanaPickup;
const DETAIL: Record<string, DetailAneka> = detailRaw as Record<
  string,
  DetailAneka
>;

// ─── Pemetaan kategori Blibli (keyword nama produk -> "c1 > c2 > cn") ──────
// c1 harus salah satu kategori resmi; cn boleh berisi chain "->". Urutan
// rule = prioritas (first match wins), rule spesifik di atas rule generik.
// Target sudah divalidasi terhadap blibli-category-tree.json (0 invalid).
type RuleKategori = { k: string[]; c: string; m?: string[]; x?: string[] };

const CATEGORY_MAP: RuleKategori[] = [
  { k: ["sabun cuci piring", "cuci piring", "dish soap", "pembersih dapur", "kitchen cleaner", "pembersih kompor", "pembersih stainless", "stainless cleaner"], c: "Bliblimart > Perawatan Rumah Tangga > Pembersih Dapur->Cairan Pembersih Dapur" },
  { k: ["sabun cuci tangan", "sabun tangan", "hand soap", "hand sanitizer", "sanitizer", "sanitasi tangan"], c: "Bliblimart > Perawatan Kulit Tubuh > Perawatan Kulit Badan->Perawatan Kulit Tangan->Sabun Pencuci Tangan" },
  { k: ["pengharum ruangan", "air freshener", "pewangi ruangan", "penghilang bau", "odor", "kamper", "kapur barus"], c: "Bliblimart > Perawatan Rumah Tangga > Pengharum Ruangan->Cairan Pengharum Ruangan" },
  { k: ["detergen", "deterjen", "sabun cuci", "pemutih", "bleach", "pelembut pakaian", "pelicin pakaian", "penghilang noda", "luntur", "sodium chloride", "pewangi pakaian", "sidoarjo"], c: "Bliblimart > Perawatan Rumah Tangga > Pembersih Pakaian->Deterjen" },
  { k: ["pembersih toilet", "toilet cleaner", "pembersih kamar mandi", "anti kerak", "anti jamur", "pembersih saluran", "anti sumbat", "wc mampet", "saluran", "mampet", "tersumbat", "bubuk ajaib", "sedot wc", "pipa", "drain"], c: "Bliblimart > Perawatan Rumah Tangga > Pembersih Kamar Mandi" },
  { k: ["pembersih lantai", "floor cleaner", "pembersih kaca", "glass cleaner", "pembersih serbaguna", "multipurpose", "disinfektan", "desinfektan", "karbol", "anti noda", "glow home", "glowhome"], c: "Bliblimart > Perawatan Rumah Tangga > Pembersih Lantai" },
  { k: ["pupuk", "nutrisi tanaman", "vitamin tanaman", "perangsang bunga", "perangsang buah", "benih", "bibit", "pestisida", "calsira", "hormon tanaman", "humat", "humic", "penyubur tanah", "pembenah tanah"], c: "Home & Living > Peralatan Taman & Luar Ruang > Tanaman" },
  { k: ["paranet", "shade net", "jaring tanaman", "net tanaman"], c: "Home & Living > Peralatan Taman & Luar Ruang > Perlengkapan Taman Lainnya" },
  { k: ["umpan", "umpan pancing", "umpan ikan", "fish attractant", "fishing", "additive", "essen", "esssen", "mancing", "pancing", "joran", "senar", "kail", "mata kail"], c: "Home & Living > Hobby & Interest > Memancing->Aksesoris Memancing" },
  { k: ["ikan", "udang", "pakan ikan", "pelet ikan", "penggemuk ikan", "kolam", "lele", "gurame", "nila", "bawal", "mujair", "akuarium", "aquarium", "aquascape", "ikan koi", "cupang"], c: "Home & Living > Hewan Peliharaan/Pet Supplies > Aquatic->Makanan, Vitamin & Obat Ikan" },
  { k: ["hewan", "pet", "kucing", "anjing", "kandang", "ternak", "unggas", "sapi", "kambing", "ayam", "bebek", "puyuh", "burung", "penggemuk ternak", "penggemuk hewan", "penggemuk ayam", "perawatan hewan", "kesehatan hewan", "vitamin hewan", "vitamin ternak", "suplemen ternak", "suplemen hewan", "max centin", "pemerah telur", "xantaxenthin"], x: ["sepatu", "sandal", "sneakers", "boots", "slipper", "tas", "dompet", "jaket", "sabuk"], c: "Home & Living > Hewan Peliharaan/Pet Supplies > Hewan Lainnya->Perawatan Kesehatan Hewan Lainnya" },
  { k: ["anti rayap", "anti tungau", "pengusir semut", "pengusir kecoa", "anti tikus", "racun tikus", "hantavirus", "pembasmi serangga", "pengusir serangga", "naphtalene", "katakill", "pembasmi kutu", "kutu tungau", "pembasmi rumput", "herbisida", "rumput liar", "obat rumput"], c: "Bliblimart > Perawatan Rumah Tangga > Pembasmi Hama & Serangga->Cairan Pembasmi Hama & Serangga" },
  { k: ["madu"], c: "Bliblimart > Minuman > Sirup & Madu->Madu" },
  { k: ["sari lemon", "sari buah", "jus", "juice"], c: "Bliblimart > Minuman > Jus" },
  { k: ["4g lucky", "perawatan pria", "herbal pria", "minyak pria", "pria perkasa", "vitalitas pria", "kesuburan pria", "ejakulasi", "penguat pria", "obat kuat", "kejantanan"], c: "Kesehatan & Kecantikan > Perawatan Pria > Perawatan Tubuh" },
  { k: ["minyak angin", "balsem", "koyo", "salep", "ointment", "minyak urut", "minyak gosok", "minyak kayu putih", "minyak telon", "minyak oles", "minyak tawon", "pegal", "linu", "nyeri otot", "nyeri sendi", "herbal spray"], c: "Kesehatan & Kecantikan > P3K > Pereda Nyeri Otot" },
  { k: ["suplemen", "vitamin", "mineral", "herbal", "kapsul", "tablet", "imun", "daya tahan", "stamina", "nafsu makan", "penambah nafsu", "habbatussauda", "habbat", "propolis", "royal jelly", "susu kambing", "orthomil", "geebumin", "kolagen", "collagen", "sheshine", "penambah berat badan", "penggemuk badan"], c: "Kesehatan & Kecantikan > Vitamin & Suplemen > Herbal->Suplemen" },
  { k: ["kaki tabib", "rendaman kaki", "foot soak", "perawatan kaki", "kaki pecah", "kaki kasar", "kaki kapalan", "callus", "kapalan", "mata ikan", "heel", "tumit", "pedicure", "krim kaki", "foot cream", "foot mask"], c: "Kesehatan & Kecantikan > Perawatan Tubuh > Perawatan Kaki->Foot Creams & Lotions" },
  { k: ["sabun wajah", "facial soap", "facial wash", "sabun muka", "sabun herbal", "sabun natural", "beauty soap", "probiotic soap", "sabun kecantikan", "pembersih wajah"], c: "Bliblimart > Perawatan Kulit Tubuh > Perawatan Kulit Wajah->Pembersih Kulit Wajah->Sabun Wajah" },
  { k: ["shampoo", "sampo", "conditioner", "hair mask", "hair serum", "hair oil", "hair tonic", "hair treatment", "hair vitamin", "hair care", "penumbuh rambut", "penyubur rambut", "anti rontok", "rambut rontok", "ketombe"], c: "Kesehatan & Kecantikan > Perawatan Rambut > Shampoo" },
  { k: ["scentnice", "hair spray", "pomade", "hair wax", "hair gel", "styling", "penata rambut", "gel rambut"], c: "Bliblimart > Perawatan Kulit Tubuh > Kesehatan Rambut->Styling Rambut->Gels, Pomades, Mousses, Wax" },
  { k: ["sabun mandi", "body wash", "shower gel", "body lotion", "body butter", "body cream", "body scrub", "body serum", "hand cream", "hand body", "deodorant", "deodoran", "body care"], c: "Kesehatan & Kecantikan > Perawatan Tubuh > Sabun Mandi" },
  { k: ["cream", "serum", "pelembab", "moisturizer", "toner", "facial", "wajah", "glowing", "firming", "retinol", "skincare", "kecantikan", "kosmetik", "makeup", "lipstick", "bedak", "foundation", "masker", "sunscreen", "bb cream", "cc cream", "lotion", "whitening", "brightening", "anti aging", "anti jerawat", "acne", "pimple", "cleanser", "micellar", "cleansing", "lao li shi", "nutricream", "meili"], x: ["kemeja", "blouse", "blus", "dress", "daster", "gamis", "kaftan", "tunik", "koko", "kaos", "baju", "rok", "celana", "jaket", "hoodie", "sweater", "cardigan", "vest", "polo", "hem", "batik", "atasan", "bawahan", "outer", "sepatu", "sandal"], c: "Bliblimart > Perawatan Kulit Tubuh > Perawatan Kulit Wajah->Perawatan Intensif Wajah->Serum Wajah" },
  { k: ["parfum", "wewangian", "fragrance", "minyak wangi", "perfume", "cologne", "body mist", "hair mist"], c: "Kesehatan & Kecantikan > Pengharum & Parfum > Parfum Wanita->Eau De Perfume & Perfume" },
  { k: ["kuku", "nail", "cat kuku", "kutek", "manicure", "nail art"], c: "Kesehatan & Kecantikan > Kutek & Perawatan Kuku > Perawatan Kuku" },
  { k: ["gigi", "tooth", "dental", "pasta gigi", "toothpaste", "sikat gigi", "mouthwash", "obat kumur", "floss", "pemutih gigi"], c: "Bliblimart > Perawatan Kulit Tubuh > Kesehatan Mulut & Gigi->Pasta Gigi Umum" },
  { k: ["mata", "eyelash", "bulu mata", "alis", "eyebrow", "eyeliner", "mascara", "eye shadow", "softlens", "lensa kontak"], c: "Kesehatan & Kecantikan > Perawatan Wajah > Perawatan Mata->Perawatan Bulu Mata & Alis" },
  { k: ["3d nose", "nose", "pemancung hidung", "hidung", "nose secret", "nose up", "nose shaper"], c: "Kesehatan & Kecantikan > Perangkat Kecantikan > Perangkat Kecantikan Lainnya" },
  { k: ["alat pijat", "pijat", "refleksi", "urut", "relaksasi", "terapi", "tai chi", "pernapasan", "akupresur", "akupunktur"], c: "Kesehatan & Kecantikan > Peralatan Medis > Perlengkapan Medis->Perban & Alat Terapi" },
  { k: ["sarung tangan"], c: "Fashion & Accessories > Wanita > Tas & Aksesoris Wanita->Aksesoris Wanita Lainnya" },
  { k: ["pelumas", "r-46", "grease", "gemuk mesin"], c: "Otomotif > Perawatan Kendaraan > Pelumas Mobil" },
  { k: ["semir ban", "tire shine", "poles ban", "pembersih ban"], c: "Otomotif > Perawatan Kendaraan > Cairan Pembersih Ban" },
  { k: ["interior cleaner", "pembersih interior", "instant coating", "dashboard", "semir", "wax leather", "leather care", "shoes cleaner", "perawatan sepatu"], c: "Otomotif > Perawatan Kendaraan > Cairan Pembersih Interior Kendaraan" },
  { k: ["rubbing compound", "glass coating", "pengkilap", "penghapus baret", "baret", "cat mobil", "poles", "polish", "black magic", "body mobil", "snow wash"], c: "Otomotif > Perawatan Kendaraan > Cairan Pembersih Eksterior Kendaraan" },
  { k: ["aksesoris mobil", "stiker mobil", "stiker kaca", "mobil", "motor", "otomotif", "kampas", "oli", "sparepart", "spare part", "klakson"], c: "Otomotif > Aksesoris Mobil > Eksterior Mobil->Aksesories Bodi Mobil" },
  { k: ["senter", "flashlight"], c: "Perkakas & Elektrikal > Penerangan > Senter" },
  { k: ["lampu", "led", "bohlam", "lighting", "night light", "lampu tidur", "lampu meja", "lampu hias", "lampu emergency", "lampu taman", "lampu solar", "strip led", "downlight", "spotlight", "panel light", "lampu sorot", "lampu gantung", "chandelier", "lampu dinding", "lampu plafon", "ceiling light", "lampu rgb", "lampu h4", "lampu h7", "lampu h11", "lampu mobil", "lampu motor", "headlamp", "proyektor"], c: "Perkakas & Elektrikal > Penerangan > Bohlam Lampu" },
  { k: ["kipas"], c: "Peralatan Elektronik > Cooling, Heating & Air Quality > Kipas Angin->Kipas Multi Fungsi" },
  { k: ["dompet", "wallet"], c: "Fashion & Accessories > Wanita > Tas & Aksesoris Wanita->Dompet Wanita" },
  { k: ["tas", "bag", "sling", "backpack", "ransel", "tote", "clutch", "handbag", "selempang"], c: "Fashion & Accessories > Wanita > Tas & Aksesoris Wanita->Tas Ransel Wanita" },
  { k: ["sandal", "slipper"], c: "Fashion & Accessories > Pria > Sepatu & Sandal Pria->Sandal Pria" },
  { k: ["boots", "boot"], c: "Fashion & Accessories > Pria > Sepatu & Sandal Pria->Boots Pria" },
  { k: ["sepatu", "flat shoes", "flatshoes", "heels", "sneakers"], c: "Fashion & Accessories > Pria > Sepatu & Sandal Pria->Formal Pria" },
  { k: ["hijab", "jilbab", "khimar", "pashmina", "ciput", "turban", "cadar"], c: "Fashion Muslim > Hijab & Jilbab > Jilbab Instant" },
  { k: ["mukena"], c: "Fashion Muslim > Perlengkapan Ibadah > Mukena Dewasa" },
  { k: ["sprei", "bed cover", "bedcover", "seprai", "sarung bantal", "sarung guling", "linen", "bed sheet", "selimut"], c: "Home & Living > Perlengkapan Kamar Tidur > Sprei, Sarung Bantal, & Sarung Guling->Sprei" },
  { k: ["sarung anak"], c: "Fashion Muslim > Perlengkapan Ibadah > Sarung Anak" },
  { k: ["sarung"], c: "Fashion Muslim > Perlengkapan Ibadah > Sarung Dewasa" },
  { k: ["boneka", "doll", "plush"], c: "Mainan, Buku & Stationery > Aneka Boneka > Boneka Karakter" },
  { k: ["mainan", "toys", "puzzle", "lego", "board game", "remote control", "edukasi"], c: "Mainan, Buku & Stationery > Mainan Edukasi dan Seni > Permainan Edukasi Lainnya" },
  // Rule DEWASA (koreksi rule anak yang terlalu luas: keyword "katun"/
  // "cotton combed"/"gamis"/"tidur" dipindah ke rule khusus dengan m/x).
  { k: ["baju koko", "koko"], x: ["anak", "bayi", "kids"], c: "Fashion Muslim > Pakaian Muslim Pria > Baju Koko" },
  { k: ["batik"], m: ["pria"], x: ["anak", "bayi", "kids", "daster"], c: "Fashion & Accessories > Pria > Pakaian & Bawahan Pria->Batik Pria" },
  { k: ["kaftan"], x: ["anak", "bayi", "kids"], c: "Fashion Muslim > Dress Muslim Wanita > Kaftan" },
  { k: ["kaos polos", "graphic tee", "kaos anime"], m: ["pria"], x: ["anak", "bayi", "kids", "usia"], c: "Fashion & Accessories > Pria > Pakaian & Bawahan Pria->Kaos Pria" },
  { k: ["daster", "baju tidur", "nightgown", "sleepwear"], x: ["anak", "bayi", "kids", "usia"], c: "Fashion & Accessories > Wanita > Pakaian & Bawahan Wanita->Baju Tidur Wanita" },
  { k: ["blouse"], m: ["wanita"], x: ["anak", "bayi", "kids"], c: "Fashion & Accessories > Wanita > Pakaian & Bawahan Wanita->Blouse & Kemeja Wanita" },
  { k: ["setelan", "jumba", "onset", "anak", "piyama", "set anak", "boy series", "jubah", "gamis", "anak laki", "anak perempuan", "tidur", "usia", "cotton combed", "katun", "pakaian anak", "baju anak", "kaos anak", "celana anak"], c: "Fashion & Accessories > Anak > Pakaian & Bawahan Anak->Atasan Anak" },
  { k: ["celana dalam", "underwear", "lingerie", "pakaian dalam", "bra", "panty"], c: "Fashion & Accessories > Wanita > Pakaian & Bawahan Wanita->Pakaian Dalam Wanita" },
  { k: ["hot pants", "celana pendek", "celana", "short"], c: "Fashion & Accessories > Wanita > Pakaian & Bawahan Wanita->Celana Wanita" },
  { k: ["baju", "kaos", "kemeja", "dress", "jaket", "rok", "pakaian", "fashion", "gamish", "atasan", "blouse", "outer"], c: "Fashion & Accessories > Wanita > Pakaian & Bawahan Wanita->Blouse & Kemeja Wanita" },
  { k: ["gelang", "kalung", "cincin", "anting", "liontin", "perhiasan", "giok", "tibet", "feng shui", "pixiu", "hematite", "gantungan kunci", "kunigan", "titanium", "batu akik", "om mani"], c: "Fashion & Accessories > Wanita > Tas & Aksesoris Wanita->Perhiasan Wanita" },
  { k: ["cuka apel", "cuka nanas", "apple cider", "vinegar", "with mother", "nutrivit", "glutamin", "penyedap", "probiotik", "vanilla bean", "vanilla extract", "vanila", "gourmet", "chia seed", "black chia", "kurma", "dates"], c: "Bliblimart > Sembako & Bumbu Masak > Bumbu Masak->Cuka" },
  { k: ["makanan", "minuman", "snack", "cemilan", "kopi", "teh", "sereal", "cokelat", "biskuit", "kue", "sirup", "bumbu", "rempah", "susu", "minyak goreng", "beras"], c: "Bliblimart > Aneka Cemilan > Biskuit & Snack->Biskuit & Snack Lainnya" },
  { k: ["alat dapur", "panci", "wajan", "pisau", "sendok", "garpu", "talenan", "dapur", "wadah", "botol", "tupperware", "lunch box", "tumbler", "cookware", "parutan", "pengiris", "mandoline", "slicer", "panggangan", "grill", "bbq", "pemanggang", "barbecue", "non stick", "gelas", "piring", "mangkuk", "peralatan masak"], c: "Home & Living > Perlengkapan Dapur > Peralatan Memasak & Memanggang" },
  { k: ["charger", "kabel", "type-c", "usb", "powerbank", "fast charging", "adapter", "adaptor", "cable"], c: "Handphone, Tablet & Wearable Gadget > Aksesoris Handphone & Tablet > Charger" },
  { k: ["cooler hp", "pendingin hp", "heatsink", "pendingin handphone", "cooling pad", "casing", "tempered glass", "screen protector"], c: "Handphone, Tablet & Wearable Gadget > Aksesoris Handphone & Tablet > Aksesoris Lainnya" },
  { k: ["cctv", "kamera", "wifi", "pengintai", "pengawas", "pemantau", "keamanan", "ip camera", "webcam", "surveillance"], c: "Peralatan Elektronik > Smart Home & Security > Security & CCTV->Kamera CCTV" },
  { k: ["speaker", "sound system", "home theater"], c: "Peralatan Elektronik > Audio > Speaker->Active Speaker" },
  { k: ["headphone", "earphone", "headset", "tws", "earbuds", "handsfree"], c: "Peralatan Elektronik > Audio > Earphone & Headphone->Earphone->Wireless In Ear" },
  { k: ["bor", "drill", "screwdriver", "obeng", "cordless", "alat tambal", "kaca retak", "windshield", "glass repair", "alat sisir", "vacum", "vakum", "v comb", "lem"], c: "Perkakas & Elektrikal > Perkakas > Perkakas Tangan" },
  { k: ["pembersih"], c: "Bliblimart > Perawatan Rumah Tangga > Pembersih Lantai" },
];

// Precompile pola keyword dengan batas kata (hindari salah-match substring,
// mis. "gan" pada "Perlindungan" atau "tas" pada "Ramtus").
const kwToRe = (kw: string) =>
  new RegExp(`(^|[^a-z0-9])${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`);

type AturanKategori = { c: string; res: RegExp[]; must: RegExp[]; not: RegExp[] };

const CATEGORY_RULES: AturanKategori[] = CATEGORY_MAP.map((rule) => ({
  c: rule.c,
  res: rule.k.map(kwToRe),
  must: (rule.m || []).map(kwToRe),
  not: (rule.x || []).map(kwToRe),
}));

/** Petakan nama produk ke kategori Blibli ("c1 > c2 > cn"); "" bila tidak ada. */
export function mapKategoriBlibli(name: string): string {
  const n = (name || "").toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.not.length && rule.not.some((re) => re.test(n))) continue;
    if (rule.must.length && !rule.must.every((re) => re.test(n))) continue;
    for (const re of rule.res) {
      if (re.test(n)) return rule.c;
    }
  }
  return "";
}

// ─── Sanitasi deskripsi (pedoman konten marketplace) ───────────────────────
// Reviewer Blibli menolak deskripsi dengan disclaimer liabilitas, instruksi
// upload internal, ajakan menyamarkan brand, manipulasi ulasan, dan sebutan
// marketplace lain (shopee/lazada/tokopedia = kata terlarang di Blibli).
const DESC_DROP_LINE = [
  /META ADS/i,
  /panduan aman upload/i,
  /pelanggaran high quality \(hq\)|duplikasi produk/i,
  /modifikasi judul & deskripsi|lakukan parafrase/i,
  /variasi visual gambar|edit ulang gambar produk/i,
  /marketing kit/i,
  /di luar tanggung jawab/i,
  /shopee|lazada|tokopedia|bukalapak|jd\.id|zalora|traveloka/i,
  /ulasan positif|review positif|penilaian terbaik|jangan lupa|lupakan untuk|untuk pelayanan kami/i,
];
const DESC_DROP_SENTENCE = [
  /video unboxing/i,
  /kerusakan akibat ekspedisi/i,
  /upload di marketplace/i,
];

export function sanitasiDeskripsiBlibli(text: string): string {
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

// ─── Inferensi axis varian dari nama varian ─────────────────────────────────
// "Varian" bukan atribut resmi kategori -> Blibli menolak dgn error "Varian
// yang sama tidak dapat dibuat untuk pickup point yang sama". Nama diparse
// jadi Warna/Ukuran (mis. "Hitam Size S", "CLS7 Hitam - 39").
const SIZE_TOKENS = new Set([
  "xxs", "xs", "s", "m", "l", "xl", "xxl", "xxxl", "2xl", "3xl", "4xl", "5xl",
  "allsize", "all size", "all size m", "one size", "onesize", "free size",
  "freesize", "jumbo", "fitall", "plus size", "big size",
]);

function isSizeTok(tok: string): boolean {
  const s = String(tok || "").trim().toLowerCase().replace(/[.,]$/, "");
  if (!s) return false;
  if (SIZE_TOKENS.has(s)) return true;
  return /^\d{2}$/.test(s); // mis. 39-45 (sepatu), 42/43 (anak)
}

function inferVarianAkses(rawName: string): { ukuran: string; warna: string } {
  const s = String(rawName || "").trim();
  let ukuran = "";
  let warna = "";
  const mParen = s.match(/^([A-Za-z0-9]+)\s*\(([^)]*)\)$/);
  const mDash = s.match(/^(.*?)\s+-\s+(\S+)$/);
  const mSize = s.match(/^(.*?)\bsize\b\s+(\S+)$/i);
  if (mParen && isSizeTok(mParen[1])) ukuran = mParen[1];
  else if (mDash && isSizeTok(mDash[2])) {
    ukuran = mDash[2];
    warna = mDash[1];
  } else if (mSize && isSizeTok(mSize[2])) {
    ukuran = mSize[2];
    warna = mSize[1];
  } else {
    const toks = s.split(/\s+/);
    if (toks.length === 1 && isSizeTok(toks[0])) ukuran = toks[0];
    else if (toks.length > 1 && isSizeTok(toks[toks.length - 1])) {
      ukuran = toks[toks.length - 1];
      warna = toks.slice(0, -1).join(" ");
    } else if (toks.length > 1 && isSizeTok(toks[0])) {
      ukuran = toks[0];
      warna = toks.slice(1).join(" ");
    } else warna = s;
  }
  // Buang kode model di depan warna (mis. "CLS7 Hitam" -> "Hitam") dan
  // daftar warna campur yang bukan satu warna.
  warna = warna
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^((?=[^\s]*[a-z])(?=[^\s]*\d)[a-z0-9]{2,10}\s+)+/i, "");
  if (warna.includes("|") || (warna.match(/,/g) || []).length >= 3) warna = "";
  return { ukuran: ukuran.trim(), warna };
}

// ─── Parse volume "7 x 7 x 23 CM" -> [7,7,23] ──────────────────────────────
function parseVolumeToCm(vol: string): number[] | null {
  if (!vol) return null;
  const m = vol.match(/(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)/i);
  if (!m) return null;
  const nums = [m[1], m[2], m[3]].map((v) => Math.round(parseFloat(v.replace(",", "."))));
  if (nums.some((n) => !Number.isFinite(n) || n <= 0)) return null;
  return nums; // [panjang, lebar, tinggi]
}

// ─── Peta lokasi seller -> kode pickup point Blibli ────────────────────────
const LOC_TO_PP = new Map<string, TitikPickup>();
for (const e of PLAN.existing) for (const l of e.location) LOC_TO_PP.set(l.toLowerCase(), e);
for (const e of PLAN.new) for (const l of e.location) LOC_TO_PP.set(l.toLowerCase(), e);

function ppUntukLokasi(lokasi: string): { ppCode: string; ppNama: string; fallback: boolean } {
  const hit = LOC_TO_PP.get((lokasi || "").trim().toLowerCase());
  if (hit) return { ppCode: hit.ppCode, ppNama: hit.name, fallback: false };
  return { ppCode: DEFAULT_PICKUP_POINT, ppNama: "(default)", fallback: true };
}

// ─── Kandidat upload (produk master belum terpetakan di Blibli) ─────────────

export type KandidatBlibli = {
  id: string;
  name: string;
  lokasi: string;
  ppCode: string;
  ppNama: string;
  ppFallback: boolean;
  hargaJual: number;
  stok: number;
  /** Verdict rule engine Tahap 5 untuk kanal Blibli. */
  statusAturan: "aman" | "perhatian" | "review" | "blokir";
  jumlahVarian: number;
  kategori: string;
  adaDeskripsi: boolean;
  jumlahGambar: number;
  /** Alasan TIDAK layak diikutkan file; kosong = layak. */
  alasan: string[];
  layak: boolean;
};

export type RingkasanKandidatBlibli = {
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

/** Daftar produk master yang belum ada di blibli_product_map + verdict
 *  rule engine + kategori target. Produk status "404" (mati di Aneka)
 *  dikeluarkan dari daftar tapi dihitung di ringkasan. */
export async function kandidatUploadBlibli(): Promise<{
  kandidat: KandidatBlibli[];
  ringkasan: RingkasanKandidatBlibli;
}> {
  const maps = await listBlibliProductMaps();
  const terpetakan = new Set(maps.map((r) => String(r.aneka_product_id ?? "")));
  const semua = listAnekaMaster();

  const ringkasan: RingkasanKandidatBlibli = {
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

  const kandidat: KandidatBlibli[] = [];
  for (const p of semua) {
    if (terpetakan.has(String(p.id))) continue;
    ringkasan.baru++;
    if (p.status === "404") {
      ringkasan.mati404++;
      continue;
    }

    const hasil = cekAturanProduk(p.name, p.kategori);
    const statusAturan = hasil.perKanal.blibli;
    const kategori = mapKategoriBlibli(p.name);
    const detail = DETAIL[String(p.id)];
    const varianAktif = (p.varian || []).filter((v) => v.aktif);
    const jumlahVarian = p.hasVarian ? varianAktif.length : 0;
    const pp = ppUntukLokasi(p.lokasi);
    const adaDeskripsi = Boolean(detail?.description);

    ringkasan[statusAturan]++;
    if (p.hasVarian) ringkasan.varian++;
    else ringkasan.tanpaVarian++;
    if (!kategori) ringkasan.kategoriKosong++;
    if (adaDeskripsi) ringkasan.denganDeskripsi++;
    else ringkasan.tanpaDeskripsi++;
    if (pp.fallback) ringkasan.lokasiFallback++;

    const alasan: string[] = [];
    if (statusAturan === "blokir" || statusAturan === "review") {
      alasan.push(
        `aturan ${hasil.temuan
          .filter((t) => t.perKanal.blibli === statusAturan)
          .map((t) => t.kode)
          .join(", ")}`,
      );
    }
    if (!kategori) alasan.push("kategori tidak terpetakan");

    const layak = alasan.length === 0;
    if (layak) ringkasan.layak++;
    else ringkasan.tidakLayak++;

    kandidat.push({
      id: p.id,
      name: p.name,
      lokasi: p.lokasi,
      ppCode: pp.ppCode,
      ppNama: pp.ppNama,
      ppFallback: pp.fallback,
      hargaJual: p.rekomendasiJual || 0,
      stok: p.stok || 0,
      statusAturan,
      jumlahVarian,
      kategori,
      adaDeskripsi,
      jumlahGambar: (detail?.images || [p.image]).filter(Boolean).length,
      alasan,
      layak,
    });
  }

  return { kandidat, ringkasan };
}

// ─── Baris upload + penulisan xlsx ──────────────────────────────────────────

type BarisUpload = Record<string, string | number>;

/** Bangun baris "Template Upload" untuk satu produk master. */
function barisUntukProduk(p: AnekaMasterProduct): {
  baris: BarisUpload[];
  pakaiVarian: boolean;
} {
  const detail = DETAIL[String(p.id)];
  const images = (detail?.images?.length ? detail.images : [p.image]).filter(
    Boolean,
  ) as string[];
  const fullUrls = images.map((img) =>
    /^https?:\/\//i.test(img) ? img : SITE_URL + img,
  );
  const dims = parseVolumeToCm(p.volume) || [10, 10, 10];
  const beratGram = p.beratGram || 500;
  const price = Number(p.rekomendasiJual) || 0;
  const name = p.name;
  const sku = (p.sku || `KTD-${p.id}`).slice(0, 50);
  const kategori = mapKategoriBlibli(name);
  const pp = ppUntukLokasi(p.lokasi);

  const varianAktif = (p.varian || []).filter((v) => v.aktif);
  const pakaiVarian = p.hasVarian && varianAktif.length > 1;

  const variantRows: {
    sku: string;
    namaVarian1: string;
    opsiVarian1: string;
    namaVarian2: string;
    opsiVarian2: string;
    harga: number;
    stock: number;
  }[] = [];

  if (pakaiVarian) {
    const hasWarna = varianAktif.some((v) => v.warna);
    const hasUkuran = varianAktif.some((v) => v.ukuran);
    const inf = varianAktif.map((v) => inferVarianAkses(v.nama || v.label || ""));
    const pairCol = varianAktif.map((v, i) => (v.warna || inf[i].warna || "").trim());
    const pairSize = varianAktif.map((v, i) => (v.ukuran || inf[i].ukuran || "").trim());
    const allCol = pairCol.every(Boolean);
    const allSize = pairSize.every(Boolean);
    let useCol: boolean, useSize: boolean;
    if (hasWarna && hasUkuran) {
      useCol = true;
      useSize = true;
    } else if (hasWarna) {
      useCol = true;
      useSize = allSize;
    } else if (hasUkuran) {
      useSize = true;
      useCol = allCol;
    } else {
      useCol = allCol;
      useSize = allSize;
      if (!useCol && !useSize) useCol = true;
    }
    varianAktif.forEach((v, i) => {
      let namaVarian1 = "",
        opsiVarian1 = "",
        namaVarian2 = "",
        opsiVarian2 = "";
      if (useCol && useSize) {
        namaVarian1 = "Warna";
        opsiVarian1 = pairCol[i] || v.nama || "";
        namaVarian2 = "Ukuran";
        opsiVarian2 = pairSize[i] || "";
      } else if (useCol) {
        namaVarian1 = "Warna";
        opsiVarian1 = pairCol[i] || v.nama || "";
      } else {
        namaVarian1 = "Ukuran";
        opsiVarian1 = pairSize[i] || v.nama || "";
      }
      variantRows.push({
        sku: `${sku}-${i + 1}`.slice(0, 50),
        namaVarian1,
        opsiVarian1,
        namaVarian2,
        opsiVarian2,
        harga: price,
        stock: Number(v.stok) || 0,
      });
    });
    // Kombinasi (axis+opsi) kembar digabung stoknya supaya Blibli tidak
    // menolak dgn "Varian yang sama tidak dapat dibuat...".
    const seenCombo = new Map<string, (typeof variantRows)[number]>();
    for (const vr of variantRows) {
      const key = [vr.namaVarian1, vr.opsiVarian1, vr.namaVarian2, vr.opsiVarian2].join("|");
      const prev = seenCombo.get(key);
      if (prev) {
        prev.stock = (Number(prev.stock) || 0) + (Number(vr.stock) || 0);
      } else seenCombo.set(key, vr);
    }
    variantRows.length = 0;
    variantRows.push(...seenCombo.values());
    variantRows.forEach((vr, i) => {
      vr.sku = `${sku}-${i + 1}`.slice(0, 50);
    });
  } else {
    variantRows.push({
      sku,
      namaVarian1: "",
      opsiVarian1: "",
      namaVarian2: "",
      opsiVarian2: "",
      harga: price,
      stock: Number(p.stok) || 0,
    });
  }

  const deskripsi =
    sanitasiDeskripsiBlibli(detail?.description || "") || `Produk: ${name}`;

  return {
    pakaiVarian,
    baris: variantRows.map((vr) => ({
      Kategori: kategori,
      "Nama Produk": name,
      Deskripsi: deskripsi,
      "Model/EAN/UPC": "",
      "Seller SKU": vr.sku || sku,
      Merek: "No Brand",
      "Kode Panduan Ukuran": "",
      "Kode Grup Varian": pakaiVarian ? `V-${p.id}` : "",
      "Nama Varian 1": vr.namaVarian1,
      "Opsi Varian 1": vr.opsiVarian1,
      "Foto Varian 1": "",
      "Nama Varian 2": vr.namaVarian2,
      "Opsi Varian 2": vr.opsiVarian2,
      "Kode Toko/Gudang": pp.ppCode,
      "Harga Penjualan (Rp)": vr.harga,
      Stok: vr.stock,
      "Status Pengiriman": 1,
      "Foto Utama": fullUrls[0] || "",
      "Foto-2": fullUrls[1] || "",
      "Foto-3": fullUrls[2] || "",
      "Foto-4": fullUrls[3] || "",
      "Foto-5": fullUrls[4] || "",
      "Foto-6": fullUrls[5] || "",
      "Foto-7": fullUrls[6] || "",
      "URL Video": "",
      "Tipe Penanganan": "",
      "Panjang (cm)": dims[0],
      "Lebar (cm)": dims[1],
      "Tinggi (cm)": dims[2],
      "Berat (gram)": beratGram,
      "Spesifikasi 1": "",
      "Isi Spesifikasi 1": "",
      "Spesifikasi 2": "",
      "Isi Spesifikasi 2": "",
      "Spesifikasi 3": "",
      "Isi Spesifikasi 3": "",
      "Spesifikasi 4": "",
      "Isi Spesifikasi 4": "",
      "Spesifikasi 5": "",
      "Isi Spesifikasi 5": "",
    })),
  };
}

// ─── Manipulasi ZIP level-rendah (pertahankan template byte-per-byte) ───────

type ZipEntry = { name: string; method: number; data: Buffer };

function readZip(buf: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Bukan file ZIP yang valid");
  const cdCount = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Entri central directory rusak");
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
    const data = method === 0 ? comp : inflateRawSync(comp);
    entries.push({ name, method, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function writeZip(entries: ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const cd: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, "utf8");
    const comp = e.method === 0 ? e.data : deflateRawSync(e.data);
    const crc = crc32Buf(e.data);
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // flag UTF-8
    local.writeUInt16LE(e.method, 8);
    local.writeUInt32LE(0, 10); // waktu/tipe modifikasi
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);
    parts.push(local, comp);
    const cde = Buffer.alloc(46 + nameBuf.length);
    cde.writeUInt32LE(0x02014b50, 0);
    cde.writeUInt16LE(20, 4);
    cde.writeUInt16LE(20, 6);
    cde.writeUInt16LE(0x0800, 8);
    cde.writeUInt16LE(e.method, 10);
    cde.writeUInt32LE(0, 12);
    cde.writeUInt32LE(crc, 16);
    cde.writeUInt32LE(comp.length, 20);
    cde.writeUInt32LE(e.data.length, 24);
    cde.writeUInt16LE(nameBuf.length, 28);
    cde.writeUInt16LE(0, 30);
    cde.writeUInt16LE(0, 32);
    cde.writeUInt16LE(0, 34);
    cde.writeUInt16LE(0, 36);
    cde.writeUInt32LE(0, 38);
    cde.writeUInt32LE(offset, 42);
    nameBuf.copy(cde, 46);
    cd.push(cde);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cdBuf = Buffer.concat(cd);
  const cdStart = offset;
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

/** CRC32 standar (zlib.crc32 hanya ada di Node >= 22.2 — dihitung manual
 *  agar kompatibel dengan runtime mana pun). */
function crc32Buf(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Entitas XML dibangun runtime ("&"+"amp;") supaya file ini tidak rusak oleh
// pipeline tool yang meng-decode entitas (pernah kejadian di script asli).
const XML_AMP = "&" + "amp;";
const XML_LT = "&" + "lt;";
const XML_GT = "&" + "gt;";

function xmlEscape(s: string): string {
  return String(s)
    .replace(/&/g, XML_AMP)
    .replace(/</g, XML_LT)
    .replace(/>/g, XML_GT)
    .replace(/\x00/g, "");
}

/** Huruf kolom Excel untuk nomor kolom 1-indexed (1=A, 2=B, ... 43=AQ). */
function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

async function muatTemplate(): Promise<Buffer> {
  const mod = await import("./blibli-upload-template");
  return Buffer.from(mod.TEMPLATE_XLSX_B64, "base64");
}

// ─── API publik ─────────────────────────────────────────────────────────────

export type HasilBuatFileBlibli = {
  buffer: Buffer;
  namaFile: string;
  jumlahProduk: number;
  jumlahBaris: number;
  pakaiVarian: boolean;
  peringatan: string[];
};

/** Validasi + bangun file xlsx untuk daftar id produk master. Melempar
 *  Error berpesan jelas bila ada id yang tidak valid / tidak layak. */
export async function buatFileUploadBlibli(
  ids: string[],
): Promise<HasilBuatFileBlibli> {
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
    const statusAturan = hasil.perKanal.blibli;
    if (statusAturan === "blokir" || statusAturan === "review") {
      masalah.push(`${p.name}: ${statusAturan} aturan (${hasil.temuan
        .filter((t) => t.perKanal.blibli === statusAturan)
        .map((t) => t.kode)
        .join(", ")})`);
      continue;
    }
    if (!mapKategoriBlibli(p.name)) {
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

  const barisSemua: BarisUpload[] = [];
  let pakaiVarian = false;
  const ppTerpakai = new Map<string, number>();
  const lokasiFallback = new Set<string>();
  for (const p of produk) {
    const { baris, pakaiVarian: pv } = barisUntukProduk(p);
    if (pv) pakaiVarian = true;
    barisSemua.push(...baris);
    const pp = ppUntukLokasi(p.lokasi);
    ppTerpakai.set(pp.ppCode, (ppTerpakai.get(pp.ppCode) || 0) + 1);
    if (pp.fallback) lokasiFallback.add(p.lokasi || "(kosong)");
  }

  const peringatan: string[] = [];
  if (pakaiVarian) {
    peringatan.push(
      "File memuat produk varian: nilai Warna/Ukuran belum diselaraskan dengan enum resmi Blibli (blibli-variant-enums.json). Bila ada baris ditolak karena nilai varian, perbaiki manual di Seller Center.",
    );
  }
  if (lokasiFallback.size) {
    peringatan.push(
      `Lokasi tanpa pickup point terdaftar (dikirim ke PP default ${DEFAULT_PICKUP_POINT}): ${[...lokasiFallback].join(", ")}`,
    );
  }
  const tanpaDeskripsi = produk.filter((p) => !DETAIL[String(p.id)]?.description).length;
  if (tanpaDeskripsi) {
    peringatan.push(
      `${tanpaDeskripsi} produk memakai deskripsi fallback "Produk: {nama}" karena belum pernah di-scrape.`,
    );
  }

  const template = await muatTemplate();
  const buffer = tulisXlsxDariTemplate(barisSemua, PLAN, template);

  const tgl = new Date();
  const stempel = `${tgl.getFullYear()}${String(tgl.getMonth() + 1).padStart(2, "0")}${String(
    tgl.getDate(),
  ).padStart(2, "0")}-${String(tgl.getHours()).padStart(2, "0")}${String(
    tgl.getMinutes(),
  ).padStart(2, "0")}`;

  return {
    buffer,
    namaFile: `blibli-upload-baru-${stempel}.xlsx`,
    jumlahProduk: produk.length,
    jumlahBaris: barisSemua.length,
    pakaiVarian,
    peringatan,
  };
}

// ─── Penulisan xlsx dari template ───────────────────────────────────────────

function tulisXlsxDariTemplate(
  rows: BarisUpload[],
  plan: RencanaPickup,
  templateBuf: Buffer,
): Buffer {
  const entries = readZip(templateBuf);

  const sheetEntry = entries.find((e) => e.name === "xl/worksheets/sheet2.xml");
  if (!sheetEntry) throw new Error("Sheet Template Upload (sheet2.xml) tidak ditemukan");

  // Parser backend Blibli hanya mengekstrak elemen <v>; cell t="inlineStr"
  // dianggap KOSONG. Semua cell teks ditulis t="s" + <v>index</v> seperti
  // template asli: string baru di-append ke sharedStrings.xml.
  const sstEntry = entries.find((e) => e.name === "xl/sharedStrings.xml");
  if (!sstEntry) throw new Error("sharedStrings.xml tidak ditemukan");
  const sstBaseXml = sstEntry.data.toString("utf8");
  const sstOpenTag = sstBaseXml.match(/<sst\b[^>]*>/)?.[0] ?? "";
  const sstBaseCount = Number((sstOpenTag.match(/\scount="(\d+)"/) || [])[1] ?? NaN);
  const sstBaseUnique = Number((sstOpenTag.match(/\suniqueCount="(\d+)"/) || [])[1] ?? NaN);
  const sstBaseSiCount = sstBaseXml.split("</si>").length - 1;
  const newSis: string[] = [];
  const siIndex = new Map<string, number>();
  let sstNewRefs = 0;
  const sharedStringIndex = (text: string): number => {
    const ada = siIndex.get(text);
    if (ada !== undefined) return ada;
    const idx = sstBaseSiCount + newSis.length;
    newSis.push(`<si><t xml:space="preserve">${xmlEscape(text)}</t></si>`);
    siIndex.set(text, idx);
    return idx;
  };
  /** Cell teks -> shared string (t="s" + <v>), style opsional. */
  const textCell = (ref: string, text: string, style?: number): string => {
    sstNewRefs++;
    const s = style ? ` s="${style}"` : "";
    return `<c r="${ref}" t="s"${s}><v>${sharedStringIndex(text)}</v></c>`;
  };

  // Data mulai baris 11 Excel; kolom A kosong, data B..AQ. vals[]: 0=KatL1,
  // 1=KatL2, 2=KatL3, 3=Nama, 4=Deskripsi, 5=Model, 6=SKU, 7=Merek,
  // 8=PanduanUkuran, 9=GrupVarian, 10=NamaV1, 11=OpsiV1, 12=FotoV1, 13=NamaV2,
  // 14=OpsiV2, 15=KodeToko, 16=Harga, 17=Stok, 18=Status, 19=FotoUtama,
  // 20..25=Foto2..7, 26=URLVideo, 27=TipePenanganan, 28=Panjang, 29=Lebar,
  // 30=Tinggi, 31=Berat, 32..41=Spesifikasi1..Isi5.
  const DATA_START_ROW = 11;
  const NUMERIC_VALS_IDX = new Set([16, 17, 18, 28, 29, 30, 31]);

  const rowXmls: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const cat = (String(r.Kategori || "")).split(" > ").map((s) => s.trim());
    const vals = [
      cat[0] || "", cat[1] || "", cat[2] || "",
      r["Nama Produk"], r.Deskripsi, r["Model/EAN/UPC"], r["Seller SKU"], r.Merek,
      r["Kode Panduan Ukuran"], r["Kode Grup Varian"],
      r["Nama Varian 1"], r["Opsi Varian 1"], r["Foto Varian 1"],
      r["Nama Varian 2"], r["Opsi Varian 2"],
      r["Kode Toko/Gudang"], r["Harga Penjualan (Rp)"], r.Stok, r["Status Pengiriman"],
      r["Foto Utama"], r["Foto-2"], r["Foto-3"], r["Foto-4"], r["Foto-5"], r["Foto-6"], r["Foto-7"],
      r["URL Video"], r["Tipe Penanganan"],
      r["Panjang (cm)"], r["Lebar (cm)"], r["Tinggi (cm)"], r["Berat (gram)"],
      r["Spesifikasi 1"], r["Isi Spesifikasi 1"], r["Spesifikasi 2"], r["Isi Spesifikasi 2"],
      r["Spesifikasi 3"], r["Isi Spesifikasi 3"], r["Spesifikasi 4"], r["Isi Spesifikasi 4"],
      r["Spesifikasi 5"], r["Isi Spesifikasi 5"],
    ];

    const rowNum = DATA_START_ROW + i;
    const cells: string[] = [];
    for (let c = 0; c < vals.length; c++) {
      const text = String(vals[c] ?? "");
      if (text === "" || text === "undefined") continue;
      const ref = colLetter(c + 2) + rowNum;
      if (NUMERIC_VALS_IDX.has(c)) {
        const n = Number(text);
        cells.push(`<c r="${ref}"><v>${Number.isFinite(n) ? n : 0}</v></c>`);
      } else {
        cells.push(textCell(ref, text));
      }
    }
    rowXmls.push(`<row r="${rowNum}" spans="1:43" x14ac:dyDescent="0.2">${cells.join("")}</row>`);
  }

  // Sisipkan baris data sebelum </sheetData>.
  const sheetXml = sheetEntry.data.toString("utf8");
  const sheetDataClose = sheetXml.lastIndexOf("</sheetData>");
  if (sheetDataClose < 0) throw new Error("sheet2.xml tidak punya </sheetData>");
  let newSheetXml =
    sheetXml.slice(0, sheetDataClose) + rowXmls.join("") + sheetXml.slice(sheetDataClose);
  const lastRow = DATA_START_ROW + rows.length - 1;
  newSheetXml = newSheetXml.replace(
    /<dimension ref="[^"]*"/,
    `<dimension ref="A4:AR${lastRow}"`,
  );
  sheetEntry.data = Buffer.from(newSheetXml, "utf8");

  // Sheet "Toko" (sheet11.xml): daftar semua pickup point.
  const tokoEntry = entries.find((e) => e.name === "xl/worksheets/sheet11.xml");
  if (tokoEntry) {
    const pickups = [...plan.existing, ...plan.new];
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const dNow = new Date();
    const tglToko = `${dNow.getDate()}-${MONTHS[dNow.getMonth()]}-${String(dNow.getFullYear()).slice(-2)}`;
    const tr: string[] = [];
    tr.push(`<row r="1">${textCell("A1", "List Alamat Pengambilan /Pickup Point/Gudang", 128)}</row>`);
    tr.push(`<row r="2">${textCell("A2", "update per tanggal")}${textCell("B2", tglToko)}</row>`);
    tr.push(
      `<row r="4">${textCell("A4", "Kode Pickup Point/Gudang", 126)}${textCell("B4", "Nama Pickup Point/Gudang", 126)}${textCell("C4", "Kode Pickup Point/Gudang || Nama Pickup Point/Gudang", 126)}</row>`,
    );
    pickups.forEach((pk, i) => {
      const rr = 5 + i;
      tr.push(
        `<row r="${rr}">${textCell(`A${rr}`, pk.ppCode, 127)}${textCell(`B${rr}`, pk.name, 127)}${textCell(`C${rr}`, `${pk.ppCode} || ${pk.name}`, 127)}</row>`,
      );
    });
    let tokoXml = tokoEntry.data.toString("utf8");
    tokoXml = tokoXml.replace(/<sheetData>[\s\S]*<\/sheetData>/, `<sheetData>${tr.join("")}</sheetData>`);
    tokoXml = tokoXml.replace(/<dimension ref="[^"]*"/, `<dimension ref="A1:D${4 + pickups.length}"`);
    tokoEntry.data = Buffer.from(tokoXml, "utf8");
  }

  // Finalisasi sharedStrings.xml.
  if (newSis.length) {
    const finalCount = (Number.isFinite(sstBaseCount) ? sstBaseCount : sstBaseSiCount) + sstNewRefs;
    const finalUnique = (Number.isFinite(sstBaseUnique) ? sstBaseUnique : sstBaseSiCount) + newSis.length;
    let sstXml = sstBaseXml.replace("</sst>", newSis.join("") + "</sst>");
    sstXml = sstXml.replace(/<sst\b[^>]*>/, (tag) => {
      let t = tag;
      t = /\scount="\d+"/.test(t)
        ? t.replace(/\scount="\d+"/, ` count="${finalCount}"`)
        : t.replace(/>$/, ` count="${finalCount}">`);
      t = /\suniqueCount="\d+"/.test(t)
        ? t.replace(/\suniqueCount="\d+"/, ` uniqueCount="${finalUnique}"`)
        : t.replace(/>$/, ` uniqueCount="${finalUnique}">`);
      return t;
    });
    sstEntry.data = Buffer.from(sstXml, "utf8");
  }

  return writeZip(entries);
}
