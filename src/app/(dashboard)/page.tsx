// Dasbor — ringkasan aktivitas KTD Hub.
import Link from "next/link";
import {
  countContacts,
  countMessages,
  listBroadcasts,
  listMessages,
} from "@/lib/db";
import { Users, Send, MessageSquare, Megaphone } from "lucide-react";

export const dynamic = "force-dynamic";

// Label ramah untuk klasifikasi balasan bot di badge pesan masuk.
const KIND_LABELS: Record<string, string> = {
  general: "Umum",
  order: "Pesanan",
  ad: "Iklan",
  faq: "FAQ",
  question: "Pertanyaan",
  proof: "Bukti TF",
};

export default async function DashboardPage() {
  const [contacts, messages, broadcasts, latest] = await Promise.all([
    countContacts(),
    countMessages(),
    listBroadcasts(),
    listMessages(5),
  ]);
  const sentTotal = broadcasts.reduce((a, b) => a + b.sent, 0);

  const stats = [
    { label: "Kontak", value: contacts, Icon: Users, href: "/kontak" },
    {
      label: "Pesan Terkirim (broadcast)",
      value: sentTotal,
      Icon: Megaphone,
      href: "/broadcast",
    },
    {
      label: "Pesan Masuk",
      value: messages,
      Icon: MessageSquare,
      href: "/pesan",
    },
    {
      label: "Kampanye Broadcast",
      value: broadcasts.length,
      Icon: Send,
      href: "/broadcast",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Dasbor</h1>
        <p className="text-sm text-slate-500">
          Ringkasan aktivitas WhatsApp KTD Store
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map(({ label, value, Icon, href }) => (
          <Link
            key={label}
            href={href}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-emerald-300"
          >
            <Icon className="mb-2 h-5 w-5 text-emerald-600" />
            <div className="text-2xl font-bold text-slate-900">{value}</div>
            <div className="text-xs text-slate-500">{label}</div>
          </Link>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            Pesan masuk terbaru
          </h2>
          <Link href="/pesan" className="text-xs text-emerald-600 hover:underline">
            Lihat semua
          </Link>
        </div>
        {latest.length === 0 ? (
          <p className="text-sm text-slate-500">
            Belum ada pesan masuk. Chat pelanggan akan tampil di sini setelah
            webhook KTD Hub diaktifkan.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {latest.map((m) => (
              <li key={m.id} className="flex items-start gap-3 py-2 text-sm">
                <span className="mt-0.5 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-500">
                  {KIND_LABELS[m.kind] ?? m.kind}
                </span>
                <div className="min-w-0">
                  <div className="font-mono text-xs text-slate-400">{m.wa_from}</div>
                  <div className="truncate text-slate-700">{m.body}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
