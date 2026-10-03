// Percakapan dengan satu pelanggan — tampilan chat ala WhatsApp dengan
// kolom balasan manual. Membuka halaman ini menandai pesan sudah dibaca.
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { listConversationMessages, markConversationRead } from "@/lib/db";
import { formatWa } from "@/lib/format";
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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link
          href="/pesan"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
          title="Kembali ke daftar pesan"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-600">
          {wa_from.slice(-2)}
        </div>
        <div>
          <h1 className="text-base font-bold text-slate-900">
            {formatWa(wa_from)}
          </h1>
          <p className="text-xs text-slate-400">Pelanggan</p>
        </div>
      </div>

      {messages.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Tidak ada percakapan dengan nomor ini.
        </p>
      ) : (
        <ChatThread waFrom={wa_from} messages={messages} />
      )}
    </div>
  );
}
