// Detail kampanye broadcast — progress pengiriman + daftar penerima.
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  broadcastProgress,
  getBroadcast,
  listBroadcastItems,
} from "@/lib/db";
import SendButton from "@/components/send-button";
import { getTemplateStatus, getWaEnv } from "@/lib/wa";

export const dynamic = "force-dynamic";

export default async function BroadcastDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const broadcast = await getBroadcast(Number(id));
  if (!broadcast) notFound();

  const progress = await broadcastProgress(broadcast.id);
  const items = await listBroadcastItems(broadcast.id);
  const envReady = getWaEnv() !== null;
  const templateStatus = envReady
    ? await getTemplateStatus(broadcast.template)
    : null;

  const failedItems = items.filter((i) => i.status === "failed");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/broadcast"
            className="text-xs text-emerald-600 hover:underline"
          >
            ← Kembali ke daftar
          </Link>
          <h1 className="text-xl font-bold text-slate-900">{broadcast.name}</h1>
          <p className="text-sm text-slate-500">
            Template {broadcast.template} · dibuat {broadcast.created_at}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-2xl font-bold text-slate-900">{progress.sent}</div>
          <div className="text-xs text-slate-500">Terkirim</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-2xl font-bold text-red-600">{progress.failed}</div>
          <div className="text-xs text-slate-500">Gagal</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-2xl font-bold text-amber-600">{progress.pending}</div>
          <div className="text-xs text-slate-500">Menunggu kirim</div>
        </div>
      </div>

      {envReady && templateStatus && templateStatus !== "APPROVED" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Template <strong>{broadcast.template}</strong> masih berstatus{" "}
          <strong>{templateStatus}</strong> di Meta — pesan tidak bisa dikirim
          sampai template disetujui. Pantau statusnya di WhatsApp Manager →
          Template pesan.
        </div>
      )}

      {!envReady ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          WA_TOKEN / WA_PHONE_NUMBER_ID belum diatur di env — isi dulu di
          .env.local (atau Vercel Settings) sebelum mengirim.
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <SendButton
            broadcastId={broadcast.id}
            pending={progress.pending}
            disabled={progress.pending === 0}
          />
          <p className="mt-3 text-xs text-slate-400">
            Tiap klik memproses satu batch (±40 penerima, jeda antar pesan
            untuk hormati batas Meta). Klik tombol lagi sampai semua terkirim.
          </p>
        </div>
      )}

      {failedItems.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <div className="mb-2 font-semibold">Gagal terkirim</div>
          <ul className="space-y-1">
            {failedItems.map((i) => (
              <li key={i.id} className="font-mono text-xs">
                {i.phone}: {i.error || "error"}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">
          Penerima ({items.length})
        </h2>
        <p className="mb-3 text-xs text-slate-400">
          Terkirim = diterima API Meta · Sampai = tiba di HP penerima · Dibaca =
          dibuka oleh penerima.
        </p>
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                <th className="py-2 pr-4 font-medium">Nomor</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((i) => (
                <tr key={i.id}>
                  <td className="py-1.5 pr-4 font-mono text-slate-600">{i.phone}</td>
                  <td className="py-1.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        i.status === "read"
                          ? "bg-sky-100 text-sky-700"
                          : i.status === "delivered"
                            ? "bg-emerald-100 text-emerald-700"
                            : i.status === "sent"
                              ? "bg-teal-100 text-teal-700"
                              : i.status === "failed"
                                ? "bg-red-100 text-red-700"
                                : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {i.status === "read"
                        ? "Dibaca"
                        : i.status === "delivered"
                          ? "Sampai"
                          : i.status === "sent"
                            ? "Terkirim"
                            : i.status === "failed"
                              ? "Gagal"
                              : "Menunggu"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
