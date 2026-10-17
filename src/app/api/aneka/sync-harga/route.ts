// Sinkron harga master Aneka → semua channel (Tahap 3). Hanya admin.
//
// GET  /api/aneka/sync-harga?op=pratinjau&channel=tiktok   → baris pratinjau
//       (channel: tiktok | blibli | lazada | ktd-store; baris memuat anekaId)
// POST {op:"terapkan", channel, pilihan:[{anekaId, harga}]}
//      → dorong harga target ke kanal terpilih (snapshot harga awal otomatis)
import { isAuthed } from "@/lib/auth";
import {
  pratinjauBlibli,
  pratinjauLazada,
  pratinjauTiktok,
  type Marketplace,
} from "@/lib/bulk-harga";
import {
  pratinjauKtdMaster,
  terapkanHargaSync,
  type PilihanHargaSync,
} from "@/lib/harga-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function bad(detail: string) {
  return Response.json({ ok: false, detail }, { status: 400 });
}

/** Pastikan nilai channel valid ("tiktok" | "blibli" | "lazada" |
 *  "ktd-store"). */
function pas(s: unknown): Marketplace | null {
  return s === "tiktok" || s === "blibli" || s === "lazada" || s === "ktd-store"
    ? s
    : null;
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
  const channel = pas(url.searchParams.get("channel"));
  if (!channel) return bad("channel wajib tiktok, blibli, lazada, atau ktd-store.");

  try {
    const r =
      channel === "tiktok"
        ? await pratinjauTiktok()
        : channel === "blibli"
          ? await pratinjauBlibli()
          : channel === "lazada"
            ? await pratinjauLazada()
            : await pratinjauKtdMaster();
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
  const pilihan: PilihanHargaSync[] = mentah.map((m) => {
    const r = (m ?? {}) as Record<string, unknown>;
    return { anekaId: String(r.anekaId ?? ""), harga: Number(r.harga ?? 0) };
  });

  try {
    return Response.json(await terapkanHargaSync(channel, pilihan));
  } catch (e) {
    return balasRusak(e);
  }
}
