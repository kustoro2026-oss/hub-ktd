// Mesin pencarian basis pengetahuan bot — modul MURNI tanpa import supaya
// bisa diuji langsung lewat `node` (type stripping Node 24), sama seperti
// faq.ts dan handover.ts.
//
// Menerima objek basis pengetahuan (bot-knowledge.json) sebagai parameter
// dan mengembalikan potongan pengetahuan yang relevan dengan satu pertanyaan
// pelanggan. Skor dihitung dari jumlah kata kunci pertanyaan yang muncul di
// nama/deskripsi produk atau nama provider top-up.

export type KnProduct = {
  id: string;
  name: string;
  price: string;
  stok: string;
  berat: string;
  desc: string;
  link: string;
};

export type KnTopup = {
  slug: string;
  brand: string;
  label: string;
  category: string;
  count: number;
  priceMin: number;
  priceMax: number;
  examples: string[];
  customerNoLabel: string;
  link: string;
};

export type BotKnowledge = {
  generatedAt: string;
  store: string;
  products: KnProduct[];
  topup: KnTopup[];
};

/** Pecah pertanyaan menjadi kata kunci (huruf kecil, minimal 3 huruf,
 *  angka murni dibuang). */
export function tokenize(question: string): string[] {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w));
}

/** Kata kunci khas domain top-up — menaikkan prioritas provider top-up
 *  bila muncul di pertanyaan (mis. "top up ff berapa"). */
const TOPUP_HINTS =
  /\b(top ?up|topup|pulsa|paket data|kuota|token listrik|pln|e-?money|saldo|diamond|voucher|game|mlbb|genshin|free ?fire|valorant|mobile legend|higgs|aov|codm|pubg|konversi)\b/i;

/** Kata henti Indonesia — kata tanya, sapaan, dan kata umum yang tidak
 *  mengidentifikasi produk (substring 3 huruf seperti "ada" atau "dana"
 *  sering menempel di kata lain, mis. "ada" dalam "kebutuhan" atau
 *  "dana" dalam "Cendana"). */
const STOPWORDS = new Set([
  "yang", "dan", "dengan", "untuk", "saya", "aku", "mau", "ingin",
  "bisa", "boleh", "apa", "apakah", "ada", "kah", "ya", "dong", "sih",
  "pak", "bu", "kak", "min", "gan", "bang", "mbak", "mas", "bro", "sis",
  "gak", "ga", "tidak", "nggak", "berapa", "brp", "harga", "harganya",
  "kapan", "gimana", "gmn", "bagaimana", "kenapa", "mengapa", "dimana",
  "mana", "siapa", "indonesia", "ribu", "rb", "top", "up", "cek", "deh",
  "lah", "aja", "saja", "juga", "ini", "itu", "nya", "dari", "atau",
  "mohon", "tolong", "minta", "beli", "pesan", "order", "disini",
  "sini", "disitu", "situ",
]);

/** Ubah kata kunci jadi fungsi pencocok teks. Kata pendek (3-4 huruf)
 *  dicocokkan dengan batas kata supaya tidak menempel ke kata lain
 *  (mis. "list" tidak dianggap cocok dengan "listrik"); kata panjang tetap
 *  substring supaya bentuk jamak/imbuhan tertangkap ("diamond" vs
 *  "diamonds"). */
function matcherFor(w: string): (hay: string) => boolean {
  const esc = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (w.length <= 4) {
    const re = new RegExp(`\\b${esc}\\b`, "i");
    return (hay) => re.test(hay);
  }
  const re = new RegExp(esc, "i");
  return (hay) => re.test(hay);
}

function scoreProducts(kb: BotKnowledge, words: string[]) {
  return kb.products
    .map((p) => {
      const name = p.name.toLowerCase();
      const desc = p.desc.toLowerCase();
      let s = 0;
      for (const w of words) {
        const hit = matcherFor(w);
        if (hit(name)) s += 3;
        else if (hit(desc)) s += 1;
      }
      return { p, s };
    })
    // Ambang final ditentukan retrieve() via strong() — di sini cukup buang
    // yang tidak cocok sama sekali, supaya kecocokan deskripsi (skor 1)
    // pada pertanyaan pendek masih sempat dievaluasi.
    .filter((x) => x.s >= 1)
    .sort((a, b) => b.s - a.s)
    .slice(0, 5)
    .map((x) => x.p);
}

function scoreTopup(kb: BotKnowledge, words: string[]) {
  return kb.topup
    .map((t) => {
      const hay = `${t.brand} ${t.label} ${t.category} ${t.examples.join(" ")}`.toLowerCase();
      let s = 0;
      for (const w of words) {
        if (matcherFor(w)(hay)) s += 2;
      }
      return { t, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 2)
    .map((x) => x.t);
}

/** Ambil potongan pengetahuan relevan untuk satu pertanyaan. */
export function retrieve(
  kb: BotKnowledge,
  question: string,
): { products: KnProduct[]; topup: KnTopup[] } {
  const words = tokenize(question).filter((w) => !STOPWORDS.has(w));
  if (!words.length) return { products: [], topup: [] };
  const topupish = TOPUP_HINTS.test(question.toLowerCase());
  // Skor produk dihitung ulang untuk ambang: pertanyaan panjang (3+ kata
  // bermakna) butuh kecocokan kuat (s >= 6) supaya kata umum yang kebetulan
  // menempel tidak memicu produk yang tidak diminta. Pertanyaan pendek
  // (<= 2 kata bermakna) cukup satu kecocokan — baik nama maupun deskripsi —
  // supaya pertanyaan seperti "ada padi" menemukan produk terkait (mis.
  // pupuk padi) dan AI bisa menjawab jujur dengan alternatifnya.
  const n = words.length;
  const strong = (p: KnProduct): boolean => {
    const name = p.name.toLowerCase();
    const desc = p.desc.toLowerCase();
    let s = 0;
    for (const w of words) {
      const hit = matcherFor(w);
      if (hit(name)) s += 3;
      else if (hit(desc)) s += 1;
    }
    return s >= 6 || (s >= 1 && n <= 2);
  };
  const products = scoreProducts(kb, words).filter((p) => strong(p));
  const topup = scoreTopup(kb, words);
  // Domain top-up menang bila disebut eksplisit (produk tidak ikut selama
  // ada hasil top-up); bila tidak ada produk yang cocok sama sekali, hasil
  // top-up tetap ditawarkan sebagai cadangan.
  if (topupish) {
    if (topup.length) return { products: [], topup };
    return { products, topup: [] };
  }
  return { products, topup: products.length ? [] : topup };
}

/** Rangkai potongan pengetahuan jadi teks ringkas untuk prompt AI. */
export function formatContext(ctx: {
  products: KnProduct[];
  topup: KnTopup[];
}): string {
  const parts: string[] = [];
  for (const p of ctx.products) {
    parts.push(
      `Produk: ${p.name} | Harga: ${p.price} | Stok: ${p.stok} | Berat: ${p.berat} | Deskripsi: ${p.desc} | Link: ${p.link}`,
    );
  }
  for (const t of ctx.topup) {
    const range =
      t.priceMin && t.priceMax
        ? ` | Harga nominal: Rp ${t.priceMin} - Rp ${t.priceMax}`
        : "";
    parts.push(
      `Top-up: ${t.label} (${t.brand}) | Kategori: ${t.category} | Jumlah nominal: ${t.count}${range} | Contoh: ${t.examples.slice(0, 8).join(", ")} | Isian yang diminta: ${t.customerNoLabel} | Link: ${t.link}`,
    );
  }
  return parts.join("\n");
}
