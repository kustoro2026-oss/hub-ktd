// Jawaban AI bot WhatsApp — menjawab pertanyaan pelanggan yang TIDAK terjawab
// FAQ dengan basis pengetahuan toko (bot-knowledge.json) + model Gemini.
//
// Alur: pertanyaan → retrieve() memilih potongan pengetahuan relevan →
// prompt dibangun dengan aturan ketat → Gemini menjawab → teks dikirim
// sebagai balasan bot. Bila Gemini menjawab "TIDAK_TAHU" (di luar data,
// keluhan, status pesanan, dll), fungsi mengembalikan null sehingga webhook
// memakai ajakan hubungi CS seperti sebelumnya.
//
// Kredensial: env GEMINI_API_KEY (wajib), GEMINI_MODEL (opsional, default
// gemini-2.5-flash). Tanpa kunci, fungsi langsung mengembalikan null — cabang
// AI nonaktif tanpa mengganggu cabang lain.
import knowledge from "./bot-knowledge.json";
import { formatContext, retrieve, type BotKnowledge } from "./knowledge";

const DEFAULT_MODEL = "gemini-2.5-flash";
/** Batas panjang pertanyaan yang dilayani AI (karakter). */
const MAX_QUESTION = 300;
/** Batas waktu tunggu jawaban (ms) — webhook WA tidak boleh melambat. */
const TIMEOUT_MS = 6000;

const SYSTEM_RULES = `Kamu adalah asisten resmi KTD Store, toko online Indonesia. Jawab pertanyaan pelanggan HANYA berdasarkan data toko di bawah.
Aturan:
1. Jawab singkat, maksimal 3 kalimat, bahasa Indonesia formal, sapaan "Anda", TANPA emoji.
2. Bila menyebut produk/top-up, sertakan link-nya dari data.
3. Jangan mengarang harga, stok, atau fakta yang tidak ada di data. Bila harga persis yang ditanyakan tidak ada di data, sebutkan rentang harga yang tersedia dan arahkan ke link halamannya.
4. Untuk produk kesehatan/suplemen, jangan memberi nasihat medis — arahkan membaca deskripsi produk (legalitas BPOM) dan konsultasi tenaga kesehatan.
5. Untuk keluhan, retur, status pesanan, resi, pembatalan, refund, atau tagihan — balas PERSIS "TIDAK_TAHU" (ditangani CS manusia).
6. Pertanyaan di luar topik toko (politik, umum, candaan, permintaan ngobrol) — balas PERSIS "TIDAK_TAHU".
7. Bila produk persis yang ditanyakan tidak ada di data, jawab JUJUR seperti manusia toko (mis. "Kami tidak menjual padi, tetapi tersedia pupuk untuk tanaman padi") dan tawarkan alternatif terdekat dari data. Bila data relevan kosong, jawab dari DESKRIPSI TOKO (kategori yang dijual, cara beli, link). Balas PERSIS "TIDAK_TAHU" hanya bila pertanyaan benar-benar tidak ada kaitannya dengan toko.
8. Bila ada PESAN PELANGGAN SEBELUMNYA, pakai sebagai konteks untuk memahami pertanyaan singkat atau merujuk (mis. "list nya apa saja" setelah bertanya tentang satu produk).
9. Akhiri jawaban dengan "Hormat kami,\nKTD Store".`;

/** Batas panjang pesan sebelumnya yang ikut dikirim sebagai konteks (karakter). */
const MAX_PRIOR = 200;

function buildPrompt(kb: BotKnowledge, question: string, prior: string): string {
  const ctx = retrieve(kb, question);
  const lines = [
    SYSTEM_RULES,
    "",
    "DESKRIPSI TOKO:",
    kb.store,
    "",
    "DATA RELEVAN (bila kosong berarti tidak ditemukan):",
    formatContext(ctx) || "(tidak ada)",
    "",
  ];
  if (prior) {
    lines.push(
      `PESAN PELANGGAN SEBELUMNYA: ${prior}`,
      "",
    );
  }
  lines.push(`PERTANYAAN PELANGGAN: ${question}`);
  return lines.join("\n");
}

/** Jawab satu pertanyaan dengan AI. Mengembalikan null bila: kunci tidak ada,
 *  pertanyaan terlalu panjang, API gagal/timeout, atau jawabannya TIDAK_TAHU.
 *  `prior` adalah pesan pelanggan sebelumnya (opsional) untuk konteks
 *  pertanyaan lanjutan singkat seperti "list nya apa saja". */
export async function answerWithAi(
  question: string,
  prior = "",
): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const t = question.replace(/\s+/g, " ").trim();
  if (!t || t.length > MAX_QUESTION) return null;

  const kb = knowledge as BotKnowledge;
  const prompt = buildPrompt(
    kb,
    t,
    prior.replace(/\s+/g, " ").trim().slice(0, MAX_PRIOR),
  );
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 350, temperature: 0.4 },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.error(`[bot-ai] gemini HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text =
      data.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? "")
        .join("")
        .trim() ?? "";
    if (!text) return null;
    if (/\bTIDAK_TAHU\b/i.test(text)) return null;
    let cleaned = text.slice(0, 600).trim();
    // Pastikan ada tanda tangan formal khas proyek. Bila AI sudah menulis
    // salam "Hormat kami," tanpa nama toko, buang dulu supaya tidak dobel.
    if (!cleaned.includes("KTD Store")) {
      cleaned = cleaned.replace(/Hormat kami,?\s*$/i, "").trim();
      cleaned += "\n\nHormat kami,\nKTD Store";
    }
    return cleaned;
  } catch (e) {
    console.error(
      "[bot-ai] gemini error:",
      e instanceof Error ? e.message : String(e),
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}
