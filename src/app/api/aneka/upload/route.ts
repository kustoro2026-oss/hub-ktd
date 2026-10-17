// Upload produk baru ke channel (Tahap 6) — kanal Blibli, Lazada & TikTok
// (file bulk, upload manual ke Seller Center oleh user; alur terbukti).
//
// GET  /api/aneka/upload?op=kandidat[&kanal=blibli|lazada|tiktok]
//      → produk master yang belum terpetakan di kanal + verdict aturan
// GET  /api/aneka/upload?op=riwayat
//      → log pembuatan file (tabel aneka_upload)
// GET  /api/aneka/upload?op=unduh&id={logId}
//      → bangun ulang file xlsx dari daftar_id tersimpan (stateless — aman
//        di Vercel tanpa penyimpanan file); kanal diambil dari log.channel
// POST /api/aneka/upload  body {op:"buat-file", kanal?, ids:[...]}
//      → validasi gerbang aturan + bangun xlsx → balas file biner
//        (Content-Disposition) + catat log. TIDAK menyentuh API channel —
//        upload manual ke Seller Center tetap oleh user.
import { isAuthed } from "@/lib/auth";
import {
  kandidatUploadBlibli,
  buatFileUploadBlibli,
} from "@/lib/upload-blibli";
import {
  kandidatUploadLazada,
  buatFileUploadLazada,
} from "@/lib/upload-lazada";
import {
  kandidatUploadTikTok,
  buatFileUploadTikTok,
} from "@/lib/upload-tiktok";
import {
  listAnekaUploads,
  getAnekaUploadById,
  insertAnekaUpload,
} from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function bad(detail: string, status = 400) {
  return Response.json({ ok: false, detail }, { status });
}

function idLog(): string {
  return `up-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type KanalUpload = "blibli" | "lazada" | "tiktok";

function kanalDari(q: string | null): KanalUpload {
  if (q === "lazada") return "lazada";
  if (q === "tiktok") return "tiktok";
  return "blibli";
}

function balasFile(
  hasil: { buffer: Buffer; namaFile: string },
  tipe: string,
): Response {
  return new Response(new Uint8Array(hasil.buffer), {
    headers: {
      "Content-Type": tipe,
      "Content-Disposition": `attachment; filename="${hasil.namaFile}"`,
    },
  });
}

// Tipe konten unduhan per kanal (TikTok = ZIP berisi xlsx per template).
const TIPE_FILE: Record<KanalUpload, string> = {
  blibli: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  lazada: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  tiktok: "application/zip",
};

export async function GET(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const url = new URL(request.url);
  const op = url.searchParams.get("op") ?? "kandidat";

  try {
    if (op === "riwayat") {
      return Response.json({ ok: true, riwayat: await listAnekaUploads(30) });
    }

    if (op === "unduh") {
      const id = (url.searchParams.get("id") ?? "").trim();
      if (!id) return bad("id log wajib diisi.");
      const log = await getAnekaUploadById(id);
      if (!log) return bad("Entri riwayat tidak ditemukan.", 404);
      if (
        log.channel !== "blibli" &&
        log.channel !== "lazada" &&
        log.channel !== "tiktok"
      ) {
        return bad(`Channel ${log.channel} belum mendukung unduh ulang.`);
      }
      let ids: string[] = [];
      try {
        ids = JSON.parse(log.daftar_id || "[]");
      } catch {
        return bad("daftar_id di log rusak.");
      }
      const kanalLog = kanalDari(log.channel);
      const hasil =
        kanalLog === "lazada"
          ? await buatFileUploadLazada(ids)
          : kanalLog === "tiktok"
            ? await buatFileUploadTikTok(ids)
            : await buatFileUploadBlibli(ids);
      return balasFile(hasil, TIPE_FILE[kanalLog]);
    }

    const kanal = kanalDari(url.searchParams.get("kanal"));
    const { kandidat, ringkasan } =
      kanal === "lazada"
        ? await kandidatUploadLazada()
        : kanal === "tiktok"
          ? await kandidatUploadTikTok()
          : await kandidatUploadBlibli();
    return Response.json({ ok: true, kanal, ringkasan, kandidat });
  } catch (e) {
    const detail = `Kesalahan server: ${
      e instanceof Error ? e.message : "tidak dikenal"
    }`;
    const status = process.env.NODE_ENV === "production" ? 200 : 502;
    return Response.json({ ok: false, detail }, { status });
  }
}

export async function POST(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }

  let body: { op?: string; ids?: unknown; kanal?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Body JSON tidak valid.");
  }

  if (body.op !== "buat-file") return bad("op tidak dikenal.");
  if (!Array.isArray(body.ids) || !body.ids.length) {
    return bad("ids wajib diisi (array id produk).");
  }
  const ids = body.ids.map((x) => String(x));
  const kanal = kanalDari(typeof body.kanal === "string" ? body.kanal : null);

  try {
    const hasil =
      kanal === "lazada"
        ? await buatFileUploadLazada(ids)
        : kanal === "tiktok"
          ? await buatFileUploadTikTok(ids)
          : await buatFileUploadBlibli(ids);

    await insertAnekaUpload({
      id: idLog(),
      channel: kanal,
      nama_file: hasil.namaFile,
      jumlah_produk: hasil.jumlahProduk,
      jumlah_baris: hasil.jumlahBaris,
      daftar_id: JSON.stringify(ids),
      keterangan: hasil.peringatan.join(" | "),
    });

    const res = balasFile(hasil, TIPE_FILE[kanal]);
    res.headers.set(
      "X-Upload-Peringatan",
      encodeURIComponent(hasil.peringatan.join(" | ")),
    );
    return res;
  } catch (e) {
    return bad(
      e instanceof Error ? e.message : "Kesalahan membangun file upload.",
    );
  }
}
