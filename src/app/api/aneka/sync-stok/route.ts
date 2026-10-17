// Sinkron stok master Aneka → semua channel (Tahap 4). Hanya admin.
//
// GET  /api/aneka/sync-stok?op=pratinjau&channel=tiktok → baris pratinjau
//       (channel: tiktok | blibli | lazada | ktd-store; baris memuat anekaId)
// GET  /api/aneka/sync-stok?op=riwayat → riwayat penyesuaian stok otomatis
// POST {op:"terapkan", channel, pilihan:[{anekaId, stok}]}
//      → dorong target stok ke kanal terpilih (stok segar dibaca otomatis)
import { isAuthed } from "@/lib/auth";
import {
  pratinjauStokBlibli,
  pratinjauStokKtd,
  pratinjauStokLazada,
  pratinjauStokTiktok,
  terapkanStokSync,
  type PilihanStokSync,
} from "@/lib/stok-sync";
import { listStokPenyesuaianTerbaru } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function bad(detail: string) {
  return Response.json({ ok: false, detail }, { status: 400 });
}

/** Pastikan nilai channel valid ("tiktok" | "blibli" | "lazada" |
 *  "ktd-store" | "ktd"). Kembalikan "ktd" untuk kedua sebutan KTD Store. */
function pas(s: unknown): string | null {
  if (s === "tiktok" || s === "blibli" || s === "lazada") return s;
  if (s === "ktd-store" || s === "ktd") return "ktd";
  return null;
}

/** Di production, body 5xx bisa diganti Cloudflare dengan halaman 502
 *  generik — balas 200 + pesan supaya alasan aslinya sampai ke browser. */
function balasRusak(e: unknown) {
  const detail = `Kesalahan server: ${
    e instanceof Error ? e.message : "tidak dikenal"
  }`;
  const status = process.env.NODE_ENV === "production" ? 200 : 502;
  return Response.json({ ok: false, detail }, { status });
}

export async function GET(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const url = new URL(request.url);
  const op = url.searchParams.get("op") ?? "pratinjau";
  if (op === "riwayat") {
    try {
      return Response.json({ ok: true, rows: await listStokPenyesuaianTerbaru(100) });
    } catch (e) {
      return balasRusak(e);
    }
  }
  const channel = pas(url.searchParams.get("channel"));
  if (!channel) return bad("channel wajib tiktok, blibli, lazada, atau ktd-store.");

  try {
    const r =
      channel === "tiktok"
        ? await pratinjauStokTiktok()
        : channel === "blibli"
          ? await pratinjauStokBlibli()
          : channel === "lazada"
            ? await pratinjauStokLazada()
            : await pratinjauStokKtd();
    return Response.json(r);
  } catch (e) {
    return balasRusak(e);
  }
}

export async function POST(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const channel = pas(body.channel);
  if (!channel) return bad("channel wajib tiktok, blibli, lazada, atau ktd-store.");
  const mentah = Array.isArray(body.pilihan) ? (body.pilihan as unknown[]) : [];
  const pilihan: PilihanStokSync[] = mentah.map((m) => {
    const r = (m ?? {}) as Record<string, unknown>;
    return { anekaId: String(r.anekaId ?? ""), stok: Number(r.stok ?? 0) };
  });

  try {
    return Response.json(await terapkanStokSync(channel, pilihan));
  } catch (e) {
    return balasRusak(e);
  }
}
