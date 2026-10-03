// Webhook WhatsApp Cloud API KTD Hub — titik masuk pesan pelanggan.
//
// GET  : verifikasi webhook Meta (hub.mode=subscribe → kembalikan hub.challenge)
// POST : payload pesan masuk → klasifikasi → balas otomatis + simpan ke log.
//
// Catatan: Meta hanya mengizinkan SATU callback URL per app. Saat KTD Hub
// siap produksi, ganti Callback URL di Meta App ke domain Hub dan endpoint
// ini; endpoint lama di situs toko tetap dibiarkan sebagai cadangan.
import { insertMessage } from "@/lib/db";
import { pickReply, type WaMessage } from "@/lib/replies";
import { sendText } from "@/lib/wa";

type WaValue = {
  metadata?: { phone_number_id?: string };
  messages?: WaMessage[];
};

type WaEntry = { changes?: { field?: string; value?: WaValue }[] };

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");
  const expected = process.env.WA_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && token === expected && challenge) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Gagal verifikasi webhook", { status: 403 });
}

export async function POST(request: Request) {
  let payload: { entry?: WaEntry[] };
  try {
    payload = (await request.json()) as { entry?: WaEntry[] };
  } catch {
    return Response.json({ error: "payload JSON tidak valid" }, { status: 400 });
  }

  try {
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const messages = change.value?.messages ?? [];
        for (const m of messages) {
          if (m.type !== "text" || !m.from || !m.id || !m.text?.body) continue;
          const { kind, reply } = pickReply(m);
          // Kirim balasan, tapi tetap catat pesan masuk meski kiriman gagal
          // (mis. nomor tidak valid atau window 24 jam habis).
          let sent = false;
          try {
            const res = await sendText(m.from, reply);
            sent = res.ok;
          } catch (e) {
            console.error(`[wa-webhook] gagal kirim balasan ke ${m.from}:`, e);
          }
          insertMessage({
            id: m.id,
            wa_from: m.from,
            body: m.text.body,
            reply: sent ? reply : `[GAGAL KIRIM] ${reply}`,
            kind,
            ad_id: m.context?.ad_id ?? "",
          });
        }
      }
    }
  } catch (e) {
    console.error("[wa-webhook] gagal memproses payload:", e);
    return Response.json({ error: "gagal memproses payload" }, { status: 500 });
  }

  return new Response("OK", { status: 200 });
}
