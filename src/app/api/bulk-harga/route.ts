// Aturan harga massal (TikTok Shop & Blibli) — satu route konsolidasi untuk
// kedua marketplace. Hanya untuk sesi admin.
//
// GET  /api/bulk-harga?marketplace=tiktok&op=aturan    → daftar aturan
// GET  /api/bulk-harga?marketplace=tiktok&op=pratinjau → baris pratinjau
// POST {marketplace, op:"simpan-aturan", aturan[]}     → ganti seluruh aturan
// POST {marketplace, op:"terapkan", pilihan[]}         → eksekusi harga baru
// POST {marketplace, op:"reset"}                       → pulihkan snapshot
import { randomUUID } from "crypto";
import { isAuthed } from "@/lib/auth";
import {
  pratinjauBlibli,
  pratinjauTiktok,
  resetBlibli,
  resetTiktok,
  terapkanBlibli,
  terapkanTiktok,
  validasiAturanSimpan,
  type AturanSimpan,
  type Marketplace,
} from "@/lib/bulk-harga";
import { listAturanHarga, replaceAturanHarga } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function bad(detail: string) {
  return Response.json({ ok: false, detail }, { status: 400 });
}

/** Pastikan nilai marketplace valid ("tiktok" | "blibli"). */
function pas(s: unknown): Marketplace | null {
  return s === "tiktok" || s === "blibli" ? s : null;
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
  const marketplace = pas(url.searchParams.get("marketplace"));
  if (!marketplace) return bad("marketplace wajib tiktok atau blibli.");
  const op = url.searchParams.get("op") ?? "pratinjau";

  if (op === "aturan") {
    try {
      const aturan = await listAturanHarga(marketplace);
      return Response.json({
        ok: true,
        aturan: aturan.map((a) => ({
          id: a.id,
          posisi: a.posisi,
          minProfit: a.min_profit,
          maxProfit: a.max_profit,
          aksi: a.aksi,
          jenis: a.jenis,
          nilai: a.nilai,
          aktif: a.aktif === 1,
        })),
      });
    } catch (e) {
      return balasRusak(e);
    }
  }

  if (op === "pratinjau") {
    try {
      const r =
        marketplace === "tiktok" ? await pratinjauTiktok() : await pratinjauBlibli();
      return Response.json(r);
    } catch (e) {
      return balasRusak(e);
    }
  }

  return bad("op tidak dikenal (aturan/pratinjau).");
}

export async function POST(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const marketplace = pas(body.marketplace);
  if (!marketplace) return bad("marketplace wajib tiktok atau blibli.");
  const op = String(body.op ?? "");

  if (op === "simpan-aturan") {
    try {
      const mentah = (body.aturan ?? []) as unknown[];
      if (!Array.isArray(mentah)) return bad("aturan wajib berupa daftar.");
      const aturan: AturanSimpan[] = mentah.map((m, i) => {
        const r = (m ?? {}) as Record<string, unknown>;
        const maxMentah = r.maxProfit;
        return {
          id: String(r.id ?? "") || randomUUID(),
          posisi: Number(r.posisi ?? i),
          minProfit: Number(r.minProfit ?? 0),
          maxProfit:
            maxMentah === null ||
            maxMentah === "" ||
            maxMentah === undefined
              ? null
              : Number(maxMentah),
          aksi: r.aksi === "naik" ? "naik" : "potong",
          jenis: r.jenis === "persen" ? "persen" : "rp",
          nilai: Number(r.nilai ?? 0),
          aktif: Boolean(r.aktif),
        };
      });
      const err = validasiAturanSimpan(aturan);
      if (err) return bad(err);
      await replaceAturanHarga(
        marketplace,
        aturan.map((a, i) => ({
          id: a.id,
          posisi: i,
          min_profit: Math.round(a.minProfit),
          max_profit: a.maxProfit === null ? null : Math.round(a.maxProfit),
          aksi: a.aksi,
          jenis: a.jenis,
          nilai: Math.round(a.nilai),
          aktif: a.aktif ? 1 : 0,
        })),
      );
      return Response.json({ ok: true, tersimpan: aturan.length });
    } catch (e) {
      return balasRusak(e);
    }
  }

  if (op === "terapkan") {
    try {
      const pilihan = Array.isArray(body.pilihan)
        ? (body.pilihan as unknown[])
            .map((x) => String(x))
            .filter((x) => x !== "")
        : [];
      if (pilihan.length === 0) return bad("pilihan wajib diisi.");
      const r =
        marketplace === "tiktok"
          ? await terapkanTiktok(pilihan)
          : await terapkanBlibli(pilihan);
      return Response.json(r);
    } catch (e) {
      return balasRusak(e);
    }
  }

  if (op === "reset") {
    try {
      const r =
        marketplace === "tiktok" ? await resetTiktok() : await resetBlibli();
      return Response.json(r);
    } catch (e) {
      return balasRusak(e);
    }
  }

  return bad("op tidak dikenal (simpan-aturan/terapkan/reset).");
}
