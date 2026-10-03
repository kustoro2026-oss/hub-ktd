// Pesan Masuk — log chat pelanggan + balasan bot.
import { listMessages } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pesan Masuk" };

const KIND_LABEL: Record<string, string> = {
  general: "Chat biasa",
  order: "Pesanan",
  ad: "Dari iklan",
};

export default function PesanPage() {
  const messages = listMessages(200);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Pesan Masuk</h1>
        <p className="text-sm text-slate-500">
          Riwayat chat pelanggan dan balasan otomatis bot
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        {messages.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">
            Belum ada pesan masuk. Log ini terisi setelah webhook KTD Hub
            diaktifkan di Meta App (Callback URL diarahkan ke endpoint
            /api/wa/webhook pada domain Hub).
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {messages.map((m) => (
              <li key={m.id} className="p-4">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-mono text-slate-400">{m.wa_from}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 font-medium ${
                      m.kind === "order"
                        ? "bg-emerald-100 text-emerald-700"
                        : m.kind === "ad"
                          ? "bg-purple-100 text-purple-700"
                          : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {KIND_LABEL[m.kind] ?? m.kind}
                  </span>
                  <span className="text-slate-400">{m.created_at}</span>
                </div>
                <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-800">
                  {m.body}
                </div>
                {m.reply && (
                  <div className="mt-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
                    <div className="mb-1 text-[11px] font-medium uppercase text-emerald-600">
                      Balasan bot
                    </div>
                    <p className="whitespace-pre-line">{m.reply}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
