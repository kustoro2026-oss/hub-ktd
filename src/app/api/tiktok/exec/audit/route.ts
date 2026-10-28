// Audit kesiapan eksekusi TikTok (tombol "Periksa Kesiapan" di halaman
// Eksekusi): jalankan ulang pemeriksaan varian Aneka + label resmi + saldo,
// simpan hasilnya ke payload.audit baris eksekusi. Perlu sesi admin.
import { isAuthed } from "@/lib/auth";
import { auditKesiapanTiktok } from "@/lib/aneka-exec";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    order_id?: string;
  };
  const orderId = String(body.order_id ?? "");
  if (!orderId) {
    return Response.json({ error: "order_id tidak ada" }, { status: 400 });
  }

  try {
    const audit = await auditKesiapanTiktok(orderId);
    // Di production, body 5xx bisa diganti Cloudflare dengan halaman 502
    // generik — balas 200 + pesan supaya alasan aslinya sampai ke browser.
    return Response.json({ ok: true, audit });
  } catch (e) {
    const detail = `Kesalahan server: ${
      e instanceof Error ? e.message : "tidak dikenal"
    }`;
    const status = process.env.NODE_ENV === "production" ? 200 : 502;
    return Response.json({ ok: false, detail }, { status });
  }
}
