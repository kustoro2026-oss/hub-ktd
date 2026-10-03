// Halaman Broadcast — daftar kampanye + buat kampanye baru.
import Link from "next/link";
import { countContacts, listBroadcasts } from "@/lib/db";
import BroadcastCreate from "@/components/broadcast-create";

export const dynamic = "force-dynamic";
export const metadata = { title: "Broadcast" };

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  sending: "Sedang dikirim",
  done: "Selesai",
};

export default function BroadcastPage() {
  const broadcasts = listBroadcasts();
  const contactCount = countContacts();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Broadcast</h1>
        <p className="text-sm text-slate-500">
          Kirim pesan massal memakai template WhatsApp
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">
          Kampanye baru
        </h2>
        <BroadcastCreate contactCount={contactCount} />
        <p className="mt-3 text-xs text-slate-400">
          Menggunakan template <code>info_promo</code> yang sudah disetujui Meta.
          Semua kontak menjadi penerima.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">
          Riwayat kampanye
        </h2>
        {broadcasts.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">
            Belum ada kampanye.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {broadcasts.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/broadcast/${b.id}`}
                  className="flex items-center justify-between gap-4 py-3 text-sm hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900">{b.name}</div>
                    <div className="text-xs text-slate-400">
                      {b.created_at} — {b.total} penerima
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-xs text-slate-500">
                      {b.sent} terkirim · {b.failed} gagal
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        b.status === "done"
                          ? "bg-emerald-100 text-emerald-700"
                          : b.status === "sending"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {STATUS_LABEL[b.status] ?? b.status}
                    </span>
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
