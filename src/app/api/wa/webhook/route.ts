// Webhook WhatsApp Cloud API KTD Hub — titik masuk pesan pelanggan.
//
// GET  : verifikasi webhook Meta (hub.mode=subscribe → kembalikan hub.challenge)
// POST : payload pesan masuk (balas otomatis + log) dan event status kiriman
//        (sent/delivered/read/failed) untuk pelacakan broadcast.
//
// Catatan: Meta hanya mengizinkan SATU callback URL per app. Saat KTD Hub
// siap produksi, ganti Callback URL di Meta App ke domain Hub dan endpoint
// ini; endpoint lama di situs toko tetap dibiarkan sebagai cadangan.
import {
  applyBroadcastDeliveryStatus,
  getLatestInMessage,
  getLatestOutMessage,
  insertMessage,
  messageExists,
} from "@/lib/db";
import { isBotHandoverActive } from "@/lib/handover";
import {
  isProofOfTransfer,
  paymentMethodOfOrder,
  pickReply,
  REPLY_ORDER,
  type ReplyKind,
  type WaMessage,
} from "@/lib/replies";
import { notifyOrderOwner, sendText } from "@/lib/wa";
import { runDueScheduledBroadcasts } from "@/lib/broadcast-send";
import { after } from "next/server";

type WaStatusEvent = {
  id?: string;
  status?: string;
  errors?: { message?: string }[];
};

type WaValue = {
  metadata?: { phone_number_id?: string };
  messages?: WaMessage[];
  statuses?: WaStatusEvent[];
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
          const body = m.text?.body ?? "";
          const isText = m.type === "text";
          const isMedia = m.type === "image" || m.type === "document";
          if ((!isText && !isMedia) || !m.from || !m.id) continue;
          // Meta kadang mengirim ulang payload — lewati bila sudah tercatat
          // supaya pelanggan/admin tidak menerima kiriman ganda.
          if (await messageExists(m.id)) continue;

          let kind: ReplyKind;
          let reply: string;
          if (isText) {
            ({ kind, reply } = pickReply(m));
          } else {
            // Foto/dokumen: dicatat tanpa balasan otomatis, kecuali dianggap
            // bukti transfer (lihat pengecekan di bawah).
            kind = "general";
            reply = "";
          }

          // Bukti transfer: pesan sebelumnya dari nomor ini adalah order
          // ber-metode transfer, dan pesan sekarang berupa foto/screenshot
          // atau teks bukti → kirim konfirmasi pesanan resmi.
          const lastIn = await getLatestInMessage(m.from);
          if (
            lastIn &&
            paymentMethodOfOrder(lastIn.body) === "transfer" &&
            isProofOfTransfer(m)
          ) {
            kind = "proof";
            reply = REPLY_ORDER;
          }

          // Notifikasi pesanan ke nomor admin: tetap jalan meski bot dijeda,
          // supaya orderan tidak pernah terlewat oleh manusia.
          const notify =
            kind === "order" ? await notifyOrderOwner(m.from, body) : "";
          // Jeda bot: kalau admin baru saja membalas manual nomor ini, biarkan
          // manusia yang menangani — pesan tetap dicatat tanpa balasan otomatis.
          const lastOut = await getLatestOutMessage(m.from);
          if (isBotHandoverActive(lastOut)) {
            await insertMessage({
              id: m.id,
              wa_from: m.from,
              body,
              reply: "",
              kind,
              ad_id: m.context?.ad_id ?? "",
              notify,
            });
            continue;
          }
          if (!reply) {
            // Media tanpa konteks bukti transfer — cukup dicatat.
            await insertMessage({
              id: m.id,
              wa_from: m.from,
              body,
              reply: "",
              kind,
              ad_id: m.context?.ad_id ?? "",
              notify,
            });
            continue;
          }
          // Kirim balasan, tapi tetap catat pesan masuk meski kiriman gagal
          // (mis. nomor tidak valid atau window 24 jam habis).
          let sent = false;
          try {
            const res = await sendText(m.from, reply);
            sent = res.ok;
          } catch (e) {
            console.error(`[wa-webhook] gagal kirim balasan ke ${m.from}:`, e);
          }
          await insertMessage({
            id: m.id,
            wa_from: m.from,
            body,
            reply: sent ? reply : `[GAGAL KIRIM] ${reply}`,
            kind,
            ad_id: m.context?.ad_id ?? "",
            notify,
          });
        }

        // Event status pesan keluar (sent / delivered / read / failed) —
        // cocokkan dengan item broadcast lewat wa_id agar status per
        // penerima naik bertahap sampai "Dibaca".
        const statuses = change.value?.statuses ?? [];
        for (const s of statuses) {
          if (!s.id || !s.status) continue;
          await applyBroadcastDeliveryStatus(
            s.id,
            s.status,
            s.errors?.[0]?.message ?? "",
          );
        }
      }
    }
  } catch (e) {
    console.error("[wa-webhook] gagal memproses payload:", e);
    return Response.json({ error: "gagal memproses payload" }, { status: 500 });
  }

  // Tick penjadwal: setiap payload webhook juga memeriksa kampanye terjadwal
  // yang waktunya sudah tiba. Dijalankan lewat after() supaya respon webhook
  // tetap cepat (Meta mensyaratkan balasan kilat) tanpa membatalkan tick.
  after(() => {
    runDueScheduledBroadcasts().catch((e) =>
      console.error("[wa-webhook] tick jadwal gagal:", e),
    );
  });

  return new Response("OK", { status: 200 });
}
