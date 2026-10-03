// Percakapan dengan satu pelanggan — tampilan chat ala WhatsApp dengan
// kolom balasan manual. Membuka halaman ini menandai pesan sudah dibaca.
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { listConversationMessages, markConversationRead } from "@/lib/db";
import { formatWa } from "@/lib/format";
import {
  handoverUntilLabel,
  isBotHandoverActive,
  lastManualOut,
} from "@/lib/handover";
import ChatThread from "@/components/chat-thread";

export const dynamic = "force-dynamic";
export const metadata = { title: "Percakapan" };

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ wa_from: string }>;
}) {
  const { wa_from } = await params;
  const messages = await listConversationMessages(wa_from);
  await markConversationRead(wa_from);
  const lastOut = lastManualOut(messages);
  const botPaused = isBotHandoverActive(lastOut);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* Kepala chat hijau ala WhatsApp */}
      <header className="flex items-center gap-3 bg-emerald-700 px-3 py-3 sm:px-4">
        <Link
          href="/pesan"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          title="Kembali ke daftar pesan"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/20 text-sm font-semibold text-white">
          {wa_from.slice(-2)}
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-base font-bold text-white">
            {formatWa(wa_from)}
          </h1>
          <p className="text-xs text-emerald-100">Pelanggan</p>
        </div>
      </header>

      {botPaused && lastOut && (
        <div className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          <span className="font-semibold">Bot dijeda.</span> Percakapan ini sedang
          ditangani manual — bot tidak membalas otomatis sampai pukul{" "}
          {handoverUntilLabel(lastOut)} (selama tidak ada balasan manual baru).
        </div>
      )}

      {messages.length === 0 ? (
        <p className="p-8 text-center text-sm text-slate-500">
          Tidak ada percakapan dengan nomor ini.
        </p>
      ) : (
        <ChatThread waFrom={wa_from} messages={messages} />
      )}
    </div>
  );
}
