"use client";

// Buat kampanye email: nama + template + subjek + SATU grup penerima +
// SATU akun SMTP. Tidak ada sasaran "semua kontak" karena setiap kontak
// wajib punya grup.
//
// Mode default "Kirim sekarang": kampanye dibuat lalu halaman detail
// langsung menjalankan mesin kirim lewat ?start=1 — pengguna cukup satu
// klik berapa pun jumlah penerimanya. Aturan batch/jeda/kuota akun SMTP
// dipatuhi otomatis di belakang layar.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CalendarClock, FileEdit, Send, Zap } from "lucide-react";
import type { EmailGroup, EmailSmtpAccount, EmailTemplate } from "@/lib/db";

type SmtpOption = EmailSmtpAccount & { sentToday?: number };

function detectedVars(text: string): string[] {
  return [
    ...new Set(
      [...text.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => m[1]),
    ),
  ];
}

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500";

const MODES = [
  {
    id: "send" as const,
    label: "Kirim sekarang",
    hint: "Satu klik — langsung diproses di belakang layar",
    Icon: Zap,
  },
  {
    id: "schedule" as const,
    label: "Jadwalkan",
    hint: "Mulai otomatis pada tanggal & jam WIB",
    Icon: CalendarClock,
  },
  {
    id: "draft" as const,
    label: "Simpan draft",
    hint: "Kirim nanti dari halaman detail",
    Icon: FileEdit,
  },
];

export default function EmailCampaignCreate({
  groups,
  templates,
  smtpAccounts,
}: {
  groups: EmailGroup[];
  templates: EmailTemplate[];
  smtpAccounts: SmtpOption[];
}) {
  const router = useRouter();
  const activeAccounts = smtpAccounts.filter((a) => a.active === 1);

  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState(0);
  const [subject, setSubject] = useState("");
  const [varValues, setVarValues] = useState<Record<string, string>>({});
  const [groupId, setGroupId] = useState(groups[0]?.id ?? 0);
  const [smtpAccountId, setSmtpAccountId] = useState(
    activeAccounts[0]?.id ?? 0,
  );
  const [mode, setMode] = useState<"send" | "schedule" | "draft">("send");
  const [scheduleAt, setScheduleAt] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  const selectedTpl = templates.find((t) => t.id === templateId);
  const selectedGroup = groups.find((g) => g.id === groupId);
  const selectedAccount = activeAccounts.find((a) => a.id === smtpAccountId);
  const recipients = selectedGroup?.subscribed_count ?? 0;

  // Ganti template → subjek default dari template + kosongkan nilai
  // variabel kampanye lama.
  useEffect(() => {
    if (selectedTpl) setSubject(selectedTpl.subject);
    setVarValues({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  // Grup / akun yang hilang (mis. dihapus di tab lain) diganti pilihan
  // pertama yang masih valid supaya form tidak mengirim id mati.
  useEffect(() => {
    if (groups.length > 0 && !groups.some((g) => g.id === groupId)) {
      setGroupId(groups[0].id);
    }
  }, [groups, groupId]);
  useEffect(() => {
    if (
      activeAccounts.length > 0 &&
      !activeAccounts.some((a) => a.id === smtpAccountId)
    ) {
      setSmtpAccountId(activeAccounts[0].id);
    }
  }, [activeAccounts, smtpAccountId]);

  // Variabel yang perlu diisi manual: semua yang terdeteksi di subjek +
  // isi template, kecuali {{nama}} / {{email}} (otomatis per penerima).
  const vars = useMemo(
    () =>
      detectedVars(
        `${selectedTpl?.subject ?? ""} ${selectedTpl?.html_body ?? ""}`,
      ).filter((v) => v !== "nama" && v !== "email"),
    [selectedTpl],
  );

  // Pratinjau subjek: variabel yang sudah diisi tampil sebagai teks.
  const subjectPreview = subject.replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (_m, k: string) => (varValues[k] ?? "").trim() || `(isi ${k})`,
  );

  // Konversi pilihan tanggal+jam WIB (input datetime-local) → UTC
  // "YYYY-MM-DD HH:MM:SS" untuk disimpan. Dibangun manual dari komponen
  // angka supaya tidak bergantung zona waktu browser.
  function scheduleUtc(): string {
    const m = scheduleAt.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    if (!m) return "";
    const [, y, mo, d, h, mi] = m;
    const utcMs =
      Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)) -
      7 * 3600_000;
    return new Date(utcMs).toISOString().slice(0, 19).replace("T", " ");
  }

  async function sendTest() {
    if (!templateId || !smtpAccountId) return;
    if (vars.some((v) => !(varValues[v] ?? "").trim())) {
      setTestResult({
        ok: false,
        text: "Isi semua nilai variabel dulu sebelum uji kirim",
      });
      return;
    }
    setTestBusy(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/email/campaigns/0/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId,
          subject,
          smtpAccountId,
          vars: Object.fromEntries(
            vars.map((v) => [v, (varValues[v] ?? "").trim()]),
          ),
          email: testEmail.trim() || undefined,
        }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        detail?: string;
        error?: string;
        to?: string;
        smtpAccount?: string;
      };
      if (d.ok) {
        setTestResult({
          ok: true,
          text: `${d.detail ?? "Terkirim"}${d.to ? ` (ke ${d.to})` : ""}${
            d.smtpAccount ? ` via ${d.smtpAccount}` : ""
          }`,
        });
      } else {
        setTestResult({
          ok: false,
          text: d.error ?? d.detail ?? "Uji kirim gagal",
        });
      }
    } catch {
      setTestResult({ ok: false, text: "Tidak dapat terhubung ke server" });
    } finally {
      setTestBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (activeAccounts.length === 0) {
      setError("Tambahkan akun SMTP aktif dulu di halaman Pengaturan SMTP");
      return;
    }
    if (!templateId) {
      setError("Pilih template dulu");
      return;
    }
    if (!subject.trim()) {
      setError("Subjek email wajib diisi");
      return;
    }
    if (groupId === 0) {
      setError("Pilih grup penerima dulu");
      return;
    }
    if (smtpAccountId === 0) {
      setError("Pilih akun SMTP dulu");
      return;
    }
    if (recipients === 0) {
      setError("Grup ini belum punya kontak berlangganan");
      return;
    }
    if (mode === "schedule" && !scheduleAt) {
      setError("Pilih tanggal dan jam kirim dulu");
      return;
    }
    if (vars.some((v) => !(varValues[v] ?? "").trim())) {
      setError(
        `Isi semua nilai variabel dulu (${vars.map((v) => `{{${v}}}`).join(", ")})`,
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/email/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          templateId,
          subject,
          groupId,
          smtpAccountId,
          mode,
          vars: Object.fromEntries(
            vars.map((v) => [v, (varValues[v] ?? "").trim()]),
          ),
          scheduledAt: mode === "schedule" ? scheduleUtc() : "",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        campaign?: { id: number };
        startNow?: boolean;
        error?: string;
      };
      if (res.ok && data.campaign) {
        router.push(
          `/email/kampanye/${data.campaign.id}${data.startNow ? "?start=1" : ""}`,
        );
        router.refresh();
      } else {
        setError(data.error ?? "Gagal membuat kampanye");
        setBusy(false);
      }
    } catch {
      setError("Tidak dapat terhubung ke server");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            Nama kampanye
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Promo 4 November"
            required
            className={inputCls}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            Template email
          </span>
          {templates.length === 0 ? (
            <span className="block py-2 text-xs text-amber-700">
              Belum ada template — buat dulu di halaman Template Email
            </span>
          ) : (
            <select
              value={templateId}
              onChange={(e) => setTemplateId(Number(e.target.value))}
              required
              className={inputCls}
            >
              <option value={0}>Pilih template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            Grup penerima
          </span>
          {groups.length === 0 ? (
            <span className="block py-2 text-xs text-amber-700">
              Belum ada grup — buat grup di halaman Kontak Email
            </span>
          ) : (
            <select
              value={groupId}
              onChange={(e) => setGroupId(Number(e.target.value))}
              required
              className={inputCls}
            >
              <option value={0}>Pilih grup…</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.subscribed_count} berlangganan)
                </option>
              ))}
            </select>
          )}
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            Akun SMTP
          </span>
          {activeAccounts.length === 0 ? (
            <span className="block py-2 text-xs text-amber-700">
              Belum ada akun aktif —{" "}
              <Link href="/email/smtp" className="underline">
                atur SMTP
              </Link>
            </span>
          ) : (
            <select
              value={smtpAccountId}
              onChange={(e) => setSmtpAccountId(Number(e.target.value))}
              required
              className={inputCls}
            >
              <option value={0}>Pilih akun…</option>
              {activeAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} — {a.username}
                </option>
              ))}
            </select>
          )}
        </label>
      </div>

      {selectedTpl && (
        <>
          <label className="block max-w-2xl">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              Subjek email
            </span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={300}
              required
              className={inputCls}
            />
            {subjectPreview !== subject && (
              <span className="mt-1 block text-xs text-slate-500">
                Pratinjau: {subjectPreview}
              </span>
            )}
          </label>

          {vars.map((v) => (
            <label key={v} className="block max-w-xl">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                Nilai {`{{${v}}}`}
              </span>
              <input
                value={varValues[v] ?? ""}
                onChange={(e) =>
                  setVarValues((p) => ({ ...p, [v]: e.target.value }))
                }
                placeholder="mis. https://toko.kustoro2026.com/produk/11"
                className={inputCls}
              />
              <span className="mt-1 block text-[11px] text-slate-500">
                Nilai ini dipakai untuk SEMUA penerima kampanye ini.{" "}
                {`{{nama}}`} dan {`{{email}}`} otomatis terisi per penerima.
              </span>
            </label>
          ))}

          <div className="rounded-lg border border-slate-200 px-3 py-2">
            <p className="mb-1 text-xs font-medium text-slate-600">
              Kirim uji dulu (memakai akun SMTP terpilih)
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="Email uji (kosongkan = email pengirim)"
                className={inputCls + " max-w-sm"}
              />
              <button
                type="button"
                onClick={sendTest}
                disabled={testBusy || !templateId || !smtpAccountId}
                className="rounded-lg border border-emerald-600 px-3 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
              >
                {testBusy ? "Mengirim…" : "Kirim uji"}
              </button>
            </div>
            {testResult && (
              <p
                className={`mt-1 text-xs ${
                  testResult.ok ? "text-emerald-700" : "text-red-600"
                }`}
              >
                {testResult.text}
              </p>
            )}
          </div>
        </>
      )}

      {selectedAccount && (
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <span className="font-medium text-slate-700">
            Aturan akun {selectedAccount.name}:
          </span>{" "}
          batch {selectedAccount.batch_size} email, jeda{" "}
          {selectedAccount.batch_pause_seconds} dtk antar batch,{" "}
          {selectedAccount.delay_ms} ms antar email, kuota{" "}
          {selectedAccount.daily_limit > 0
            ? `${selectedAccount.daily_limit}/hari (terpakai ${selectedAccount.sentToday ?? 0})`
            : "tanpa batas"}
          .{" "}
          {recipients > 0 &&
            selectedAccount.daily_limit > 0 &&
            recipients >
              Math.max(
                0,
                selectedAccount.daily_limit - (selectedAccount.sentToday ?? 0),
              ) && (
              <span className="text-amber-700">
                Penerima melebihi sisa kuota hari ini — sisa email dilanjutkan
                otomatis setelah kuota pulih.
              </span>
            )}
        </div>
      )}

      <div>
        <span className="mb-1 block text-xs font-medium text-slate-600">
          Waktu kirim — {recipients} penerima berlangganan
        </span>
        <div className="grid gap-2 sm:grid-cols-3">
          {MODES.map((m) => {
            const active = mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${
                  active
                    ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                <m.Icon className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <span className="block font-medium">{m.label}</span>
                  <span className="block text-[11px] text-slate-500">
                    {m.hint}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        {mode === "schedule" && (
          <div className="mt-2">
            <input
              type="datetime-local"
              value={scheduleAt}
              onChange={(e) => setScheduleAt(e.target.value)}
              className={inputCls + " max-w-xs"}
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Jam memakai WIB. Kiriman berjalan otomatis selama ada tab Hub
              yang terbuka, plus jaring pengaman cron harian Vercel.
            </p>
          </div>
        )}
        {mode === "send" && (
          <p className="mt-1 text-[11px] text-slate-500">
            Kontak yang berhenti / bounce otomatis dilewati. Mesin kirim
            memproses batch demi batch sesuai aturan akun SMTP — kamu tidak
            perlu klik berulang.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={
            busy ||
            recipients === 0 ||
            !templateId ||
            !groupId ||
            !smtpAccountId
          }
          className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          title={
            recipients === 0
              ? "Grup ini belum punya kontak berlangganan"
              : undefined
          }
        >
          <Send className="h-4 w-4" />
          {busy
            ? "Memproses…"
            : mode === "schedule"
              ? `Jadwalkan (${recipients} penerima)`
              : mode === "draft"
                ? `Simpan draft (${recipients} penerima)`
                : `Kirim sekarang (${recipients} penerima)`}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </form>
  );
}
