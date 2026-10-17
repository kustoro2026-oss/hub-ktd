// Rule engine produk dilarang (Tahap 5) — murni fungsi, bisa diimpor dari
// komponen client maupun kode server (upload Tahap 6). Dua lapis aturan
// sesuai docs/aturan-produk-marketplace.md:
//   1. Lapis umum (U-*) — berlaku untuk SEMUA marketplace.
//   2. Lapis per marketplace (T-*/B-*/L-*) — kekhasan tiap channel.
// KTD Store (situs sendiri) sengaja tidak diperiksa — kebijakan internal.
//
// Mesin bekerja pada NAMA produk (moderasi marketplace juga berbasis kata),
// plus pola URL/nomor HP. Status per kanal:
//   aman       — boleh upload otomatis
//   perhatian  — boleh upload, ada catatan kepatuhan
//   review     — WAJIB tinjau manual sebelum upload
//   blokir     — jangan upload ke kanal itu (strip kata/rename dulu)
//
// Pengetahuan kalibrasi (probe 792 nama master, 17 Okt 2026):
//   - "kobata" mengandung substring "obat", "muslim" mengandung "slim",
//     "jamur" mengandung "jamu" — kata-kata umum yang rawan salah-tembak
//     dipasang sebagai kataBatas (regex \b).
//   - "perangsang bunga/buah" (pupuk) bukan pelanggaran; yang dilarang
//     konteks seksual. Ditangani pola konteks, bukan kata polos.
//   - "pelumas" di katalog ini semua gemuk mesin — tidak dijadikan aturan.
//   - Kata "vitalitas" lolos moderasi Blibli; hanya kombinasi dengan
//     "pria/stamina/daya tahan" yang berisiko.

export type KanalPasar = "tiktok" | "blibli" | "lazada";

export const DAFTAR_KANAL: KanalPasar[] = ["tiktok", "blibli", "lazada"];

export const LABEL_KANAL: Record<KanalPasar, string> = {
  tiktok: "TikTok",
  blibli: "Blibli",
  lazada: "Lazada",
};

export type StatusAturan = "aman" | "perhatian" | "review" | "blokir";

export type StatusPerKanal = Record<KanalPasar, StatusAturan>;

const TINGKAT: Record<StatusAturan, number> = {
  aman: 0,
  perhatian: 1,
  review: 2,
  blokir: 3,
};

const TINGKAT_KE_NAMA: Record<number, StatusAturan> = {
  0: "aman",
  1: "perhatian",
  2: "review",
  3: "blokir",
};

export type TemuanAturan = {
  kode: string;
  aturan: string;
  sumber: string;
  /** Kata/pola yang memicu aturan ini. */
  pemicu: string;
  /** Tingkat tertinggi aturan ini (untuk chip). */
  status: StatusAturan;
  perKanal: StatusPerKanal;
};

export type HasilCekAturan = {
  nama: string;
  keseluruhan: StatusAturan;
  perKanal: StatusPerKanal;
  temuan: TemuanAturan[];
  jumlahTemuan: number;
};

type Aturan = {
  kode: string;
  aturan: string;
  sumber: string;
  /** Pencocokan substring (lowercase, tanpa batas kata). */
  kata?: string[];
  /** Pencocokan kata utuh (\b…\b) untuk kata yang rawan salah-tembak. */
  kataBatas?: string[];
  /** Pola regex diuji terhadap nama asli (bukan lowercase). */
  pola?: RegExp[];
  /** Jika salah satu kata ini ketemu → aturan dibatalkan. */
  kecuali?: string[];
  status: StatusAturan | Partial<StatusPerKanal>;
};

/** Merek pihak ketiga yang umum — judul menyebut merek = risiko HKI. */
const MEREK = [
  "realme", "xiaomi", "redmi", "iphone", "samsung", "oppo", "infinix",
  "tecno", "adidas", "nike", "puma", "gucci", "chanel", "dior", "versace",
  "armani", "bvlgari", "prada", "hermes", "burberry", "calvin klein",
  "ralph lauren", "givenchy", "tommy hilfiger", "guess", "balenciaga",
  "fendi", "michael kors", "coach", "tory burch", "casio", "garmin", "jbl",
  "sony", "logitech", "razer", "dyson", "jennifer lopez", "victoria secret",
  "zara", "levi", "converse", "vans", "lacoste", "new balance",
  "under armour", "bonia", "fossil", "swatch", "rolex", "omega", "hublot",
  "hugo boss", "dkny", "celine", "loewe", "mango", "uniqlo",
];

const URL_RE = /(https?:\/\/|www\.|wa\.me|bit\.ly|s\.id|linktr\.ee|maps\.app\.goo\.gl|goo\.gl\/maps|\.(com|id|co|net|shop|store|xyz|site)(\b|\/))/i;

const NOMOR_HP_RE = /(?:08\d{8,11}|\+?62\s?8\d{7,10})/;

const ATURAN: Aturan[] = [
  // ===== LAPIS 1 — UMUM (semua marketplace) =====
  {
    kode: "U-1",
    aturan: "Produk palsu / replika / tiruan merek",
    sumber: "TikTok 1.1#12, Blibli #3, Lazada HKI",
    kata: ["replika", "kw super", "super copy", "premium kw", "mirip asli", "oripalsu", "grade ori"],
    status: "blokir",
  },
  {
    kode: "U-1B",
    aturan: "Nama merek pihak ketiga di judul (risiko HKI) — strip merek dari judul",
    sumber: "Audit Lazada HKI (P47 Realme), Blibli #3",
    kataBatas: MEREK,
    status: "blokir",
  },
  {
    kode: "U-2",
    aturan: "Klaim medis pada produk non-obat (menyembuhkan/mengobati)",
    sumber: "TikTok 1.2, Lazada terlarang",
    kata: [
      "menyembuhkan", "mengobati", "menyembuh", "terapi pengobatan",
      "obat kuat", "obat sifilis", "obat sipilis", "obat diabetes",
      "obat asam urat", "anti diabetes", "penurun gula darah",
      "penurun kolesterol", "penurun darah tinggi",
    ],
    status: "blokir",
  },
  {
    kode: "U-2B",
    aturan: "Kata \"obat\" — cek jenis: obat manusia dilarang; obat hewan/tanaman cek kategori channel",
    sumber: "TikTok 5.1-5.2, Lazada terlarang",
    kataBatas: ["obat"],
    status: "review",
  },
  {
    kode: "U-3",
    aturan: "Klaim afrodisiak / performa seksual / organ intim",
    sumber: "TikTok 1.1#5 + 5.1, audit Lazada & Blibli (ereksi/ejakulasi)",
    kata: [
      "afrodisiak", "peningkat gairah", "gairah wanita", "gairah pria",
      "vitalitas pria", "kejantanan", "keperkasaan", "pembesar payudara",
      "pengencang payudara", "pembesar alat vital", "pengencang miss v",
      "miss v", "pemuas wanita", "pemuas pria", "alat bantu dewasa",
      "mainan dewasa", "sex toy", "vibrator", "dildo", "ereksi",
      "ejakulasi", "obat perangsang",
    ],
    status: "blokir",
  },
  {
    kode: "U-3B",
    aturan: "Produk teridentifikasi berisiko dari karantina audit sebelumnya",
    sumber: "Karantina Lazada 3 Okt 2026 (20 produk dihapus)",
    kata: [
      "eros serum", "4g joss", "4g lucky", "pasak bumi", "wamena",
      "purwogreng", "moist bust", "tiga jari",
    ],
    status: "blokir",
  },
  {
    kode: "U-3C",
    aturan: "Klaim vitalitas/stamina/daya tahan khusus pria",
    sumber: "Blibli moderasi kata (kata \"vitalitas\" lolos, kombinasi pria berisiko)",
    pola: [
      /vitalitas.{0,12}pria/i,
      /stamina.{0,12}pria/i,
      /daya tahan.{0,12}pria/i,
    ],
    status: { tiktok: "blokir", blibli: "review", lazada: "review" },
  },
  {
    kode: "U-4",
    aturan: "Produk manajemen berat badan (pil/bubuk/gummies klaim menurunkan berat)",
    sumber: "TikTok 5.15",
    kata: [
      "pelangsing", "penurun berat", "menurunkan berat", "slimming",
      "body slim", "bakar lemak", "fat burner", "penghancur lemak",
      "diet detox", "diet detoks", "sekar slim",
    ],
    status: { tiktok: "blokir", blibli: "review", lazada: "review" },
  },
  {
    kode: "U-5",
    aturan: "Link eksternal / shareloc / WA di judul (ajakan transaksi di luar platform)",
    sumber: "Blibli #1, Lazada 48 poin",
    kata: [
      "shareloc", "share loc", "whatsapp", "cek lokasi", "alamat gudang",
      "google maps", "maps.google", "wa.me", "linktr", "bit.ly", "s.id",
    ],
    status: "blokir",
  },
  {
    kode: "U-5B",
    aturan: "Pola URL / nomor HP di judul",
    sumber: "Blibli #1",
    pola: [URL_RE, NOMOR_HP_RE],
    status: "blokir",
  },
  {
    kode: "U-5C",
    aturan: "Menyebut nama marketplace lain di judul",
    sumber: "Blibli #1",
    kata: ["shopee", "tokopedia", "bukalapak", "olx", "jdid"],
    status: "review",
  },
  {
    kode: "U-6",
    aturan: "Bahan berbahaya: racun, pestisida, herbisida, antibiotik, korosif/mudah terbakar",
    sumber: "TikTok 1.1#2 + 5.16, Blibli #2 moderasi kata, Lazada terlarang",
    kata: [
      "racun", "pestisida", "herbisida", "rodentisida", "insektisida",
      "fungisida", "akarisida", "antibiotik", "natrium hipoklorit",
      "sodium hipoklorit", "soda kaustik", "asam sulfat",
      "hidrogen peroksida", "aseton", "terpentin", "isopropil", "metanol",
      "minyak tanah", "spirtus",
    ],
    status: { tiktok: "blokir", blibli: "blokir", lazada: "review" },
  },
  {
    kode: "U-7",
    aturan: "Judi / kekerasan hewan (ayam aduan)",
    sumber: "Blibli audit ART-00170 (ayam aduan), TikTok",
    kata: [
      "ayam aduan", "sabung ayam", "adu ayam", "taji ayam", "pisau taji",
      "bertarung",
    ],
    kataBatas: ["jalu"],
    status: "blokir",
  },
  {
    kode: "U-8",
    aturan: "Obat resep / obat keras / alat kesehatan tanpa izin edar",
    sumber: "TikTok 5.1-5.2, Lazada terlarang",
    kata: ["obat resep", "obat dokter", "obat keras", "obat medis", "alat kesehatan"],
    status: "blokir",
  },
  {
    kode: "U-9",
    aturan: "Senjata & benda berbilah (kecuali peralatan dapur/rumah tangga)",
    sumber: "TikTok 1.1#1",
    kata: [
      "pedang", "keris", "golok", "parang", "belati", "samurai", "katana",
      "tombak", "busur panah", "ketapel", "airsoft", "air gun", "airgun",
      "senapan", "senjata", "pistol", "amunisi", "taser",
      "brass knuckle", "pisau lipat",
    ],
    // "peluru" dipasang kataBatas: "peluruh" (mis. peluruh batu ginjal)
    // mengandung substring-nya dan bukan senjata.
    kataBatas: ["peluru"],
    status: "blokir",
  },
  {
    kode: "U-9B",
    aturan: "Pisau tanpa konteks dapur/rumah tangga",
    sumber: "TikTok 1.1#1",
    kataBatas: ["pisau"],
    kecuali: [
      "asahan", "dapur", "masak", "roti", "kue", "buah", "sayur", "meja",
      "potong", "pengupas", "katering", "kitchen",
    ],
    status: "blokir",
  },
  {
    kode: "U-11",
    aturan: "Produk kedaluwarsa / tanpa label / dikemas ulang (konsumsi)",
    sumber: "TikTok 1.1#11",
    kata: ["dikemas ulang", "kemasan ulang", "tanpa label", "kedaluwarsa", "kadaluarsa", "expired"],
    status: "blokir",
  },
  {
    kode: "U-12",
    aturan: "Barang bekas / tanaman-hewan hidup / produk virtual & layanan",
    sumber: "TikTok 5.4-5.9",
    kata: [
      "barang bekas", "second", "preloved", "tanaman hidup", "hewan hidup",
      "bibit tanaman", "benih tanaman", "saldo", "top up", "topup", "pulsa",
      "paket data", "voucher game", "akun premium", "chip game",
    ],
    status: "blokir",
  },

  // ===== LAPIS 2 — PER MARKETPLACE =====
  {
    kode: "T-1",
    aturan: "Herbal/suplemen/vitamin wajib nomor BPOM/PIRT di TikTok — pastikan tercantum di deskripsi",
    sumber: "TikTok 1.2 (kecantikan/makanan/suplemen)",
    kataBatas: ["herbal", "kapsul", "suplemen", "vitamin", "jamu"],
    kecuali: ["bpom", "pirt"],
    status: { tiktok: "review", blibli: "perhatian", lazada: "perhatian" },
  },
  {
    kode: "T-2",
    aturan: "Kotak misteri / mystery box dilarang di TikTok",
    sumber: "TikTok 5.16",
    kata: ["kotak misteri", "mystery box", "mystery gift", "box misteri"],
    status: { tiktok: "blokir", blibli: "perhatian", lazada: "perhatian" },
  },
  {
    kode: "T-3",
    aturan: "Logam mulia / SIM / pulsa invite-only di TikTok",
    sumber: "TikTok 1.4",
    kata: ["emas murni", "emas batangan", "logam mulia", "emas 24k"],
    status: { tiktok: "review", blibli: "perhatian", lazada: "perhatian" },
  },
];

const kataBatasTerkompilasi = new Map<string, RegExp>();

function reKataBatas(kata: string): RegExp {
  const ada = kataBatasTerkompilasi.get(kata);
  if (ada) return ada;
  const lolos = kata.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${lolos}\\b`, "i");
  kataBatasTerkompilasi.set(kata, re);
  return re;
}

function cariPemicu(r: Aturan, nama: string): string {
  const n = nama.toLowerCase();
  for (const k of r.kata ?? []) if (n.includes(k)) return k;
  for (const k of r.kataBatas ?? []) if (reKataBatas(k).test(nama)) return k;
  for (const p of r.pola ?? []) {
    const m = nama.match(p);
    if (m && m[0]) return m[0];
  }
  return "";
}

function gabung(a: StatusAturan, b: StatusAturan): StatusAturan {
  return TINGKAT[a] >= TINGKAT[b] ? a : b;
}

function statusUntuk(status: StatusAturan | Partial<StatusPerKanal>, kanal: KanalPasar): StatusAturan {
  if (typeof status === "string") return status;
  return status[kanal] ?? "aman";
}

/**
 * Periksa satu nama produk terhadap seluruh aturan.
 * `kategori` saat ini hanya disimpan untuk masa depan — deteksi berbasis nama.
 */
export function cekAturanProduk(nama: string, kategori = ""): HasilCekAturan {
  const temuan: TemuanAturan[] = [];
  const perKanal: StatusPerKanal = { tiktok: "aman", blibli: "aman", lazada: "aman" };
  for (const r of ATURAN) {
    if ((r.kecuali ?? []).some((k) => nama.toLowerCase().includes(k))) continue;
    const pemicu = cariPemicu(r, nama);
    if (!pemicu) continue;
    const pk: StatusPerKanal = { tiktok: "aman", blibli: "aman", lazada: "aman" };
    let tertinggi = 0;
    for (const kanal of DAFTAR_KANAL) {
      const s = statusUntuk(r.status, kanal);
      pk[kanal] = s;
      perKanal[kanal] = gabung(perKanal[kanal], s);
      if (TINGKAT[s] > tertinggi) tertinggi = TINGKAT[s];
    }
    temuan.push({
      kode: r.kode,
      aturan: r.aturan,
      sumber: r.sumber,
      pemicu,
      status: TINGKAT_KE_NAMA[tertinggi],
      perKanal: pk,
    });
  }
  const keseluruhan = DAFTAR_KANAL.reduce(
    (m, kanal) => gabung(m, perKanal[kanal]),
    "aman" as StatusAturan,
  );
  return {
    nama,
    keseluruhan,
    perKanal,
    temuan,
    jumlahTemuan: temuan.length,
  };
}

export type RingkasanAturan = {
  total: number;
  aman: number;
  perhatian: number;
  review: number;
  blokir: number;
  perKanal: Record<KanalPasar, { aman: number; perhatian: number; review: number; blokir: number }>;
};

/** Agregasi banyak hasil cek menjadi ringkasan untuk kartu statistik. */
export function ringkasHasil(hasil: HasilCekAturan[]): RingkasanAturan {
  const ringkas: RingkasanAturan = {
    total: hasil.length,
    aman: 0,
    perhatian: 0,
    review: 0,
    blokir: 0,
    perKanal: {
      tiktok: { aman: 0, perhatian: 0, review: 0, blokir: 0 },
      blibli: { aman: 0, perhatian: 0, review: 0, blokir: 0 },
      lazada: { aman: 0, perhatian: 0, review: 0, blokir: 0 },
    },
  };
  for (const h of hasil) {
    ringkas[h.keseluruhan] += 1;
    for (const kanal of DAFTAR_KANAL) {
      ringkas.perKanal[kanal][h.perKanal[kanal]] += 1;
    }
  }
  return ringkas;
}

/** Kelayakan upload otomatis per kanal (dipakai Tahap 6). */
export function kelayakanKanal(h: HasilCekAturan, kanal: KanalPasar): "boleh" | "perhatian" | "review" | "blokir" {
  return h.perKanal[kanal] === "aman" ? "boleh" : h.perKanal[kanal];
}
