// Pesan Masuk — daftar percakapan per nomor pelanggan, gaya daftar chat
// WhatsApp: klik satu baris untuk membuka percakapan dan membalas.
import Link from "next/link";
import { listConversations } from "@/lib/db";
import { formatWa, timeHM } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pesan Masuk" };

/** Pratinjau baris: pesan keluar diawali "Anda: " seperti di WhatsApp. */
function preview(c: {
  direction: "in" | "out";
  body: string;
  reply: string;
}): string {
  if (c.direction === "out") return `Anda: ${c.body}`;
  if (c.reply) return c.reply.replace(/\n/g, " ");
  return c.body.replace(/\n/g, " ");
}

export default async function PesanPage() {
  const conversations = await listConversations();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Pesan Masuk</h1>
        <p className="text-sm text-slate-500">
          Klik percakapan untuk membuka dan membalas chat pelanggan
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {conversations.length === 0 ? (
          <p className="p-10 text-center text-sm text-slate-600">
            Belum ada pesan masuk. Chat pelanggan yang masuk ke nomor WhatsApp
            API (0821-7342-7249) otomatis muncul di sini.
          </p>
        ) : (
          <ul>
            {conversations.map((c) => (
              <li key={c.wa_from}>
                <Link
                  href={`/pesan/${c.wa_from}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50"
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-600">
                    {c.wa_from.slice(-2)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-slate-900">
                        {formatWa(c.wa_from)}
                      </span>
                      <span className="shrink-0 text-[11px] text-slate-400">
                        {timeHM(c.last_at)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] text-slate-500">
                        {preview(c)}
                      </span>
                      {c.unread > 0 && (
                        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-semibold text-white">
                          {c.unread}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
