// Detail kampanye email — ringkasan statistik (terkirim, gagal, dibuka,
// berhenti berlangganan) + tombol kirim batch + daftar penerima. Gmail
// tidak menyediakan webhook statistik: "dibuka" dilacak via pixel 1x1,
// sedangkan sampai/klik/bounce tidak tersedia.
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  emailCampaignProgress,
  getEmailCampaign,
  getEmailTemplate,
  listEmailCampaignItems,
} from "@/lib/db";
import { toWib } from "@/lib/format";
import EmailSendButton from "@/components/email-send-button";

export const dynamic = "force-dynamic";

function pct(n: number, total: number): string {
  if (total <= 0) return "—";
  return `${((n / total) * 100).toFixed(1)}%`;
}

function StatCard({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "red" | "amber";
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div
        className={`text-2xl font-bold ${
          tone === "red"
            ? "text-red-600"
            : tone === "amber"
              ? "text-amber-600"
              : "text-slate-900"
        }`}
      >
        {value}
      </div>
      <div className="text-xs text-slate-500">{label}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}

export default async function EmailCampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const campaign = await getEmailCampaign(Number(id));
  if (!campaign) notFound();

  const [progress, items, template] = await Promise.all([
    emailCampaignProgress(campaign.id),
    listEmailCampaignItems(campaign.id),
    getEmailTemplate(campaign.template_id),
  ]);

  const failedItems = items.filter((i) => i.status === "failed");
  const isScheduled = campaign.status === "draft" && campaign.scheduled_at !== "";

  // Nilai variabel kampanye (mis. link produk) — JSON di kolom vars.
  const vars = (() => {
    try {
      const v = JSON.parse(campaign.vars || "{}");
      return v && typeof v === "object" && !Array.isArray(v)
        ? (v as Record<string, string>)
        : {};
    } catch {
      return {};
    }
  })();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/email/kampanye"
            className="text-xs text-emerald-600 hover:underline"
          >
            ← Kembali ke daftar
          </Link>
          <h1 className="text-xl font-bold text-slate-900">{campaign.name}</h1>
          <p className="text-sm text-slate-500">
            {template ? `Template ${template.name}` : "Template terhapus"} ·{" "}
            {isScheduled
              ? `dijadwalkan ${toWib(campaign.scheduled_at)} WIB`
              : `dibuat ${campaign.created_at}`}
          </p>
          {Object.keys(vars).length > 0 && (
            <p className="break-all text-xs text-slate-500">
              Nilai variabel:{" "}
              {Object.entries(vars)
                .map(([k, v]) => `${k}=${v}`)
                .join(", ")}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Terkirim" value={String(progress.sent)} sub="diterima SMTP Gmail" />
        <StatCard
          label="Dibuka"
          value={String(campaign.opened)}
          sub={`open rate ${pct(campaign.opened, progress.sent)} · pixel 1x1`}
        />
        <StatCard
          label="Gagal"
          value={String(progress.failed)}
          tone="red"
          sub="ditolak SMTP Gmail"
        />
        <StatCard
          label="Berhenti"
          value={String(campaign.unsubscribed)}
          tone="amber"
          sub="klik link unsubscribe"
        />
      </div>

      {isScheduled ? (
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-800">
          Kampanye ini dijadwalkan kirim otomatis pada{" "}
          <strong>{toWib(campaign.scheduled_at)} WIB</strong>. Penjadwal akan
          mengirimnya saat waktunya tiba — tidak perlu klik apa-apa. Statusnya
          berubah menjadi Selesai di halaman ini.
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <EmailSendButton
            campaignId={campaign.id}
            pending={progress.pending}
            disabled={progress.pending === 0}
          />
          <p className="mt-3 text-xs text-slate-400">
            Tiap klik memproses satu batch (±40 penerima, jeda 1 detik antar
            email). Klik tombol lagi sampai semua terkirim. Statistik dibuka
            masuk otomatis dari pixel buka di badan email (bisa terlambat
            beberapa menit) — Gmail tidak menyediakan data sampai/klik/bounce.
          </p>
        </div>
      )}

      {failedItems.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <div className="mb-2 font-semibold">Gagal terkirim</div>
          <ul className="space-y-1">
            {failedItems.map((i) => (
              <li key={i.id} className="font-mono text-xs">
                {i.email}: {i.error || "error"}
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
          Terkirim = diterima SMTP Gmail · Dibuka = pixel buka di badan email.
          Gmail tidak menyediakan statistik sampai/klik/bounce.
        </p>
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                <th className="py-2 pr-4 font-medium">Penerima</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((i) => (
                <tr key={i.id}>
                  <td className="py-1.5 pr-4">
                    <div className="text-slate-900">{i.name || "—"}</div>
                    <div className="font-mono text-xs text-slate-500">
                      {i.email}
                    </div>
                  </td>
                  <td className="py-1.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        i.status === "clicked"
                          ? "bg-sky-100 text-sky-700"
                          : i.status === "opened"
                            ? "bg-indigo-100 text-indigo-700"
                            : i.status === "delivered"
                              ? "bg-emerald-100 text-emerald-700"
                              : i.status === "sent"
                                ? "bg-teal-100 text-teal-700"
                                : i.status === "failed"
                                  ? "bg-red-100 text-red-700"
                                  : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {i.status === "clicked"
                        ? "Diklik"
                        : i.status === "opened"
                          ? "Dibuka"
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
