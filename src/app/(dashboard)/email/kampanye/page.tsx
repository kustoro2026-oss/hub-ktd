// Halaman Kampanye Email — form "buat & kirim satu klik", ringkasan
// pemakaian tiap akun SMTP, dan riwayat kampanye.
//
// Pengaturan akun SMTP dipindah ke halaman /email/smtp supaya halaman ini
// fokus ke pengiriman.
import Link from "next/link";
import {
  countEmailsSentTodayByAccounts,
  listEmailCampaigns,
  listEmailGroups,
  listEmailSmtpAccounts,
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
  paused: "Dijeda",
  done: "Selesai",
};

export default async function EmailKampanyePage() {
  const [campaigns, groups, templates, smtpAccounts] = await Promise.all([
    listEmailCampaigns(),
    listEmailGroups(),
    listEmailTemplates(),
    listEmailSmtpAccounts(false),
  ]);

  const usage = await countEmailsSentTodayByAccounts(
    smtpAccounts.map((a) => a.id),
  );
  const accountsWithUsage = smtpAccounts.map((a) => ({
    ...a,
    sentToday: usage[a.id] ?? 0,
  }));
  const accountName = new Map(smtpAccounts.map((a) => [a.id, a.name]));
  const groupName = new Map(groups.map((g) => [g.id, g.name]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kampanye Email"
        subtitle="Satu klik untuk ratusan email — aturan batch tiap akun SMTP dijalankan otomatis"
      />

      <EmailSendLimitPanel />

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">
            Kampanye baru
          </h2>
          <Link
            href="/email/smtp"
            className="text-xs font-medium text-emerald-700 hover:underline"
          >
            Kelola akun SMTP →
          </Link>
        </div>
        <EmailCampaignCreate
          groups={groups}
          templates={templates}
          smtpAccounts={accountsWithUsage}
        />
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
              const isPausedCooldown =
                c.status === "paused" && c.pause_reason === "cooldown";
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
                          ? `Dijadwalkan: ${toWib(c.scheduled_at)} WIB`
                          : c.created_at}{" "}
                        — {c.total} penerima
                        {c.group_id
                          ? ` · ${groupName.get(c.group_id) ?? "grup terhapus"}`
                          : ""}
                        {c.smtp_account_id
                          ? ` · ${accountName.get(c.smtp_account_id) ?? "akun SMTP terhapus"}`
                          : ""}
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
                                ? "bg-sky-100 text-sky-700"
                                : c.status === "paused"
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {isScheduled
                          ? "Terjadwal"
                          : isPausedCooldown
                            ? "Jeda batch"
                            : STATUS_LABEL[c.status] ?? c.status}
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
