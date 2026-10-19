// Halaman Kampanye Email — panel kuota harian Brevo, form buat kampanye
// baru, dan riwayat kampanye dengan ringkasan statistik.
import Link from "next/link";
import {
  listEmailCampaigns,
  listEmailContacts,
  listEmailGroups,
  listEmailTemplates,
} from "@/lib/db";
import { toWib } from "@/lib/format";
import EmailCampaignCreate from "@/components/email-campaign-create";
import EmailSendLimitPanel from "@/components/email-send-limit-panel";
import PageHeader from "@/components/page-header";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kampanye Email" };

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  sending: "Sedang dikirim",
  done: "Selesai",
};

export default async function EmailKampanyePage() {
  const [campaigns, contacts, groups, templates] = await Promise.all([
    listEmailCampaigns(),
    listEmailContacts(),
    listEmailGroups(),
    listEmailTemplates(),
  ]);

  // Penerima "semua kontak" = kontak berstatus subscribed saja.
  const subscribedCount = contacts.filter((c) => c.status === "subscribed").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kampanye Email"
        subtitle="Kirim email massal via Brevo (batas gratis 300/hari)"
      />

      <EmailSendLimitPanel />

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">
          Kampanye baru
        </h2>
        <EmailCampaignCreate
          contactCount={subscribedCount}
          groups={groups}
          templates={templates}
        />
        <p className="mt-3 text-xs text-slate-400">
          Kampanye &quot;Kirim manual&quot; berstatus Draft — kirim lewat tombol
          di halaman detail. Kampanye terjadwal berjalan otomatis.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">
          Riwayat kampanye
        </h2>
        {campaigns.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">
            Belum ada kampanye.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {campaigns.map((c) => {
              const isScheduled = c.status === "draft" && c.scheduled_at !== "";
              return (
                <li key={c.id}>
                  <Link
                    href={`/email/kampanye/${c.id}`}
                    className="flex items-center justify-between gap-4 py-3 text-sm hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900">{c.name}</div>
                      <div className="text-xs text-slate-400">
                        {isScheduled
                          ? `Dijadwalkan: ${toWib(c.scheduled_at)} WIB — ${c.total} penerima`
                          : `${c.created_at} — ${c.total} penerima`}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-xs text-slate-500">
                        {c.sent} terkirim · {c.failed} gagal
                        {c.opened > 0 && ` · ${c.opened} dibuka`}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          isScheduled
                            ? "bg-sky-100 text-sky-700"
                            : c.status === "done"
                              ? "bg-emerald-100 text-emerald-700"
                              : c.status === "sending"
                                ? "bg-amber-100 text-amber-700"
                                : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {isScheduled ? "Terjadwal" : STATUS_LABEL[c.status] ?? c.status}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
