"use client";

// Buat kampanye email: nama + template (dari DB Hub) + subjek + sasaran
// (semua kontak berlangganan atau satu grup). Variabel {{...}} di template
// memunculkan kolom nilai (mis. link produk) yang dipakai untuk semua
// penerima kampanye — {{nama}} dan {{email}} otomatis per penerima, tidak
// perlu diisi. Bisa kirim uji dulu, kirim sekarang, atau jadwalkan.
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { EmailGroup, EmailTemplate } from "@/lib/db";

function detectedVars(text: string): string[] {
  return [
    ...new Set(
      [...text.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map(
        (m) => m[1],
      ),
    ),
  ];
}

export default function EmailCampaignCreate({
  contactCount,
  groups,
  templates,
}: {
  contactCount: number;
  groups: EmailGroup[];
  templates: EmailTemplate[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState(0);
  const [subject, setSubject] = useState("");
  const [varValues, setVarValues] = useState<Record<string, string>>({});
  const [target, setTarget] = useState<"all" | "group">("all");
  const [groupId, setGroupId] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [limitInfo, setLimitInfo] = useState<{
    ok?: boolean;
    limit?: number;
    sentToday?: number;
    remaining?: number;
  } | null>(null);
  const [sendMode, setSendMode] = useState<"manual" | "jadwal">("manual");
  const [scheduleAt, setScheduleAt] = useState("");
  const [testEmail, setTestEmail] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  // Penjaga kuota: baca kiriman Hub hari ini vs batas Gmail 500/hari.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/email/send-limit");
        const d = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          limit?: number;
          sentToday?: number;
          remaining?: number;
        };
        if (res.ok) setLimitInfo(d);
      } catch {
        // Kuota tidak terbaca — form tetap jalan tanpa peringatan.
      }
    })();
  }, []);

  const selectedTpl = templates.find((t) => t.id === templateId);

  // Ganti template → subjek default dari template + kosongkan nilai
  // variabel kampanye lama.
  useEffect(() => {
    if (selectedTpl) setSubject(selectedTpl.subject);
    setVarValues({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

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

  const selectedGroup = groups.find((g) => g.id === groupId);
  const recipients =
    target === "group" ? (selectedGroup?.member_count ?? 0) : contactCount;

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
    if (!templateId) return;
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
      };
      if (d.ok) {
        setTestResult({
          ok: true,
          text: `${d.detail ?? "Terkirim"}${d.to ? ` (ke ${d.to})` : ""}`,
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
    if (!templateId) {
      setError("Pilih template dulu");
      return;
    }
    if (!subject.trim()) {
      setError("Subjek email wajib diisi");
      return;
    }
    if (target === "group" && groupId === 0) {
      setError("Pilih grup dulu");
      return;
    }
    if (sendMode === "jadwal" && !scheduleAt) {
      setError("Pilih tanggal dan jam kirim dulu");
      return;
    }
    if (vars.some((v) => !(varValues[v] ?? "").trim())) {
      setError(`Isi semua nilai variabel dulu (${vars.map((v) => `{{${v}}}`).join(", ")})`);
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
          groupId: target === "group" ? groupId : undefined,
          vars: Object.fromEntries(
            vars.map((v) => [v, (varValues[v] ?? "").trim()]),
          ),
          scheduledAt: sendMode === "jadwal" ? scheduleUtc() : undefined,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { campaign: { id: number } };
        router.push(`/email/kampanye/${data.campaign.id}`);
        router.refresh();
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Gagal membuat kampanye");
      }
    } catch {
      setError("Tidak dapat terhubung ke server");
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500";

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
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
              className={inputCls + " w-full"}
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
                className={inputCls + " w-full"}
              />
              <span className="mt-1 block text-[11px] text-slate-500">
                Nilai ini dipakai untuk SEMUA penerima kampanye ini.{" "}
                {`{{nama}}`} dan {`{{email}}`} otomatis terisi per penerima.
              </span>
            </label>
          ))}

          <div className="rounded-lg border border-slate-200 px-3 py-2">
            <p className="mb-1 text-xs font-medium text-slate-600">
              Kirim uji dulu
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="Email uji (kosongkan = email pengirim)"
                className={inputCls}
              />
              <button
                type="button"
                onClick={sendTest}
                disabled={testBusy || !templateId}
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

      <div>
        <span className="mb-1 block text-xs font-medium text-slate-600">
          Sasaran penerima (berlangganan saja)
        </span>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input
              type="radio"
              checked={target === "all"}
              onChange={() => setTarget("all")}
            />
            Semua kontak ({contactCount})
          </label>
          {groups.length > 0 && (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                checked={target === "group"}
                onChange={() => setTarget("group")}
              />
              Grup
            </label>
          )}
          {target === "group" && (
            <select
              value={groupId}
              onChange={(e) => setGroupId(Number(e.target.value))}
              className={inputCls}
            >
              <option value={0}>Pilih grup…</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.member_count})
                </option>
              ))}
            </select>
          )}
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          Kontak berstatus Berhenti / Bounce otomatis dilewati.
        </p>
      </div>

      {limitInfo?.ok && (
        <div
          className={`rounded-lg px-3 py-2 text-xs ${
            recipients > (limitInfo.remaining ?? 0)
              ? "border border-red-200 bg-red-50 text-red-700"
              : "bg-slate-50 text-slate-600"
          }`}
        >
          {recipients > (limitInfo.remaining ?? 0) ? (
            <>
              <strong>Perhatian kuota:</strong> penerima ({recipients})
              melebihi sisa kuota harian Gmail ({limitInfo.remaining} —
              terpakai {limitInfo.sentToday} dari {limitInfo.limit}). Email
              yang tembus batas akan <strong>ditolak Gmail</strong> dan
              tercatat Gagal. Saran: pecah jadi dua kampanye atau jadwalkan
              besok.
            </>
          ) : (
            <>
              Sisa kuota harian Gmail: <strong>{limitInfo.remaining}</strong>{" "}
              email (terpakai {limitInfo.sentToday} dari {limitInfo.limit}) —{" "}
              {recipients} penerima masih aman.
            </>
          )}
        </div>
      )}

      <div>
        <span className="mb-1 block text-xs font-medium text-slate-600">
          Waktu kirim
        </span>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input
              type="radio"
              checked={sendMode === "manual"}
              onChange={() => setSendMode("manual")}
            />
            Kirim manual (tombol di halaman kampanye)
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input
              type="radio"
              checked={sendMode === "jadwal"}
              onChange={() => setSendMode("jadwal")}
            />
            Kirim otomatis pada
          </label>
          {sendMode === "jadwal" && (
            <input
              type="datetime-local"
              value={scheduleAt}
              onChange={(e) => setScheduleAt(e.target.value)}
              className={inputCls}
            />
          )}
        </div>
        {sendMode === "jadwal" && (
          <p className="mt-1 text-[11px] text-slate-500">
            Jam memakai WIB. Kiriman berjalan otomatis selama ada tab Hub yang
            terbuka, plus jaring pengaman cron harian Vercel.
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
            (target === "group" && groupId === 0)
          }
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          title={recipients === 0 ? "Tambahkan kontak dulu" : undefined}
        >
          {busy
            ? "Membuat…"
            : sendMode === "jadwal"
              ? `Jadwalkan (${recipients} penerima)`
              : `Buat (${recipients} penerima)`}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </form>
  );
}
