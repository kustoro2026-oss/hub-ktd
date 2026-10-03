// Pesan Masuk — riwayat chat pelanggan + balasan bot, tampilan gaya chat
// aplikasi pesan pada umumnya (bubble kiri = pelanggan, kanan = bot).
import { listMessages } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pesan Masuk" };

const KIND_LABEL: Record<string, string> = {
  general: "Chat biasa",
  order: "Pesanan",
  ad: "Dari iklan",
};

const KIND_CLASS: Record<string, string> = {
  general: "bg-slate-200/80 text-slate-600",
  order: "bg-emerald-200/80 text-emerald-800",
  ad: "bg-purple-200/80 text-purple-800",
};

const GAGAL = "[GAGAL KIRIM] ";

export default async function PesanPage() {
  const messages = await listMessages(200);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Pesan Masuk</h1>
          <p className="text-sm text-slate-500">
            Riwayat chat pelanggan dan balasan otomatis bot
          </p>
        </div>
        <p className="text-xs text-slate-400">
          Pesan terbaru di atas — muat ulang halaman untuk memuat pesan baru
        </p>
      </div>

      <div
        className="overflow-hidden rounded-xl border border-slate-200 shadow-sm"
        style={{
          backgroundColor: "#efe7db",
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(0,0,0,0.05) 1px, transparent 0)",
          backgroundSize: "18px 18px",
        }}
      >
        {messages.length === 0 ? (
          <p className="p-10 text-center text-sm text-slate-600">
            Belum ada pesan masuk. Chat pelanggan yang masuk ke nomor WhatsApp
            API (0821-7342-7249) otomatis muncul di sini beserta balasan bot.
          </p>
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6 sm:px-6">
            {messages.map((m) => {
              const failed = m.reply.startsWith(GAGAL);
              const replyText = failed ? m.reply.slice(GAGAL.length) : m.reply;
              return (
                <div key={m.id}>
                  {/* Pembatas percakapan: nomor, jenis chat, waktu */}
                  <div className="mb-3 flex justify-center">
                    <div className="flex flex-wrap items-center justify-center gap-2 rounded-full bg-white/90 px-3 py-1 shadow-sm">
                      <span className="font-mono text-[11px] text-slate-500">
                        {m.wa_from}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${KIND_CLASS[m.kind] ?? KIND_CLASS.general}`}
                      >
                        {KIND_LABEL[m.kind] ?? m.kind}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {m.created_at}
                      </span>
                    </div>
                  </div>

                  {/* Bubble pelanggan (kiri) */}
                  <div className="flex items-end gap-2">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-500 text-xs font-semibold text-white">
                      P
                    </div>
                    <div className="max-w-[78%] rounded-2xl rounded-bl-md bg-white px-3.5 py-2 shadow-sm">
                      <p className="whitespace-pre-line break-words text-sm leading-relaxed text-slate-800">
                        {m.body}
                      </p>
                      <div className="mt-1 text-right text-[10px] text-slate-400">
                        {m.created_at}
                      </div>
                    </div>
                  </div>

                  {/* Bubble balasan bot (kanan) */}
                  {m.reply && (
                    <div className="mt-1.5 flex justify-end pl-9">
                      <div
                        className={`max-w-[78%] rounded-2xl rounded-br-md px-3.5 py-2 shadow-sm ${
                          failed
                            ? "border border-red-200 bg-red-50"
                            : "bg-[#d9fdd3]"
                        }`}
                      >
                        <div
                          className={`mb-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                            failed ? "text-red-600" : "text-emerald-700"
                          }`}
                        >
                          {failed ? "Balasan bot — gagal terkirim" : "Balasan bot"}
                        </div>
                        <p className="whitespace-pre-line break-words text-sm leading-relaxed text-slate-800">
                          {replyText}
                        </p>
                        <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-slate-400">
                          {m.created_at}
                          {!failed && (
                            <span className="text-slate-500" title="Terkirim">
                              ✓
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
