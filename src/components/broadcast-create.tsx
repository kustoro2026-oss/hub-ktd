"use client";

// Buat kampanye broadcast: nama + template (dari daftar Meta yang sudah
// DISETUJUI) + sasaran (semua kontak atau satu grup). Template bervariabel
// {{n}} memunculkan kolom nilai (mis. link produk) yang dipakai untuk semua
// penerima kampanye. Setelah dibuat, pengiriman dijalankan dari halaman
// detail kampanye.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ContactGroup } from "@/lib/db";
import type { WaTemplate } from "@/lib/wa";

const STATUS_BADGE: Record<string, string> = {
  APPROVED: "Disetujui",
  PENDING: "Menunggu review",
  REJECTED: "Ditolak",
};

export default function BroadcastCreate({
  contactCount,
  groups,
}: {
  contactCount: number;
  groups: ContactGroup[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [templates, setTemplates] = useState<WaTemplate[] | null>(null);
  const [tplError, setTplError] = useState("");
  const [template, setTemplate] = useState("");
  const [varValues, setVarValues] = useState<Record<number, string>>({});
  const [target, setTarget] = useState<"all" | "group">("all");
  const [groupId, setGroupId] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [limitInfo, setLimitInfo] = useState<{
    ok?: boolean;
    tier?: string;
    limit?: number | null;
    remaining?: number | null;
    unlimited?: boolean;
    sentToday?: number;
  } | null>(null);
  const [sendMode, setSendMode] = useState<"manual" | "jadwal">("manual");
  const [scheduleAt, setScheduleAt] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/wa/templates");
        const d = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          templates?: WaTemplate[];
          detail?: string;
        };
        if (res.ok && d.ok) {
          const list = d.templates ?? [];
          setTemplates(list);
          const approved = list.filter((t) => t.status === "APPROVED");
          if (approved.length > 0) {
            const pref = approved.find((t) => t.name === "info_promo_v2");
            setTemplate((pref ?? approved[0]).name);
          }
        } else {
          setTplError(d.detail ?? "Gagal membaca template dari Meta");
        }
      } catch {
        setTplError("Tidak dapat terhubung ke server");
      }
    })();
  }, []);

  // Ganti template → kosongkan nilai variabel kampanye lama.
  useEffect(() => setVarValues({}), [template]);

  // Penjaga kuota: baca sisa kuota harian live dari Meta + kiriman Hub.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/wa/send-limit");
        const d = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          limit?: number | null;
          remaining?: number | null;
          unlimited?: boolean;
          sentToday?: number;
        };
        if (res.ok) setLimitInfo(d);
      } catch {
        // Kuota tidak terbaca — form tetap jalan tanpa peringatan.
      }
    })();
  }, []);

  const approvedTemplates = (templates ?? []).filter(
    (t) => t.status === "APPROVED",
  );

  const selectedTpl = approvedTemplates.find((t) => t.name === template);
  const tplBody =
    selectedTpl?.components?.find((c) => c.type === "BODY")?.text ?? "";
  // Nomor variabel {{1}}, {{2}}… yang muncul di teks BODY template.
  const varNumbers = [
    ...new Set(
      [...tplBody.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1])),
    ),
  ].sort((a, b) => a - b);
  // Pratinjau: variabel yang sudah diisi tampil sebagai teks, yang belum
  // sebagai penanda "(isi nilai n)".
  const preview = tplBody.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n: string) => {
    const v = (varValues[Number(n)] ?? "").trim();
    return v || `(isi nilai ${n})`;
  });
  const varTag = (n: number) => `{{${n}}}`;

  const selectedGroup = groups.find((g) => g.id === groupId);
  const recipients = target === "group" ? (selectedGroup?.member_count ?? 0) : contactCount;

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
    if (!template) return;
    if (varNumbers.some((n) => !(varValues[n] ?? "").trim())) {
      setTestResult({
        ok: false,
        text: "Isi semua nilai variabel dulu sebelum uji kirim",
      });
      return;
    }
    setTestBusy(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/wa/test-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template,
          lang: selectedTpl?.language ?? "id",
          vars: varNumbers.map((n) => (varValues[n] ?? "").trim()),
          phone: testPhone.trim(),
        }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        detail?: string;
        error?: string;
        to?: string;
      };
      if (d.ok) {
        setTestResult({ ok: true, text: `${d.detail ?? "Terkirim"} (ke ${d.to})` });
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
    if (!template) {
      setError("Belum ada template yang disetujui Meta");
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
    if (varNumbers.some((n) => !(varValues[n] ?? "").trim())) {
      setError(`Isi semua nilai variabel dulu (tanda ${varTag(varNumbers[0])} di dalam pesan)`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/broadcasts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          template,
          groupId: target === "group" ? groupId : undefined,
          vars: varNumbers.map((n) => (varValues[n] ?? "").trim()),
          lang: selectedTpl?.language ?? "id",
          scheduledAt: sendMode === "jadwal" ? scheduleUtc() : undefined,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { broadcast: { id: number } };
        router.push(`/broadcast/${data.broadcast.id}`);
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
            placeholder="Promo 4 Oktober"
            required
            className={inputCls}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            Template (disetujui Meta)
          </span>
          {templates === null && !tplError ? (
            <span className="block py-2 text-xs text-slate-400">
              Membaca template…
            </span>
          ) : (
            <select
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              required
              className={inputCls}
            >
              {approvedTemplates.length === 0 && (
                <option value="">Tidak ada template disetujui</option>
              )}
              {approvedTemplates.map((t) => (
                <option key={t.id} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </label>
      </div>

      {selectedTpl && tplBody && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="mb-1 text-xs font-medium text-slate-600">
            Pratinjau isi pesan
          </p>
          <p className="whitespace-pre-wrap text-sm text-slate-800">{preview}</p>
        </div>
      )}
      {varNumbers.map((n) => (
        <label key={n} className="block max-w-xl">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            Nilai {varTag(n)}
          </span>
          <input
            value={varValues[n] ?? ""}
            onChange={(e) =>
              setVarValues((p) => ({ ...p, [n]: e.target.value }))
            }
            placeholder="mis. https://toko.kustoro2026.com/produk/11"
            className={inputCls + " w-full"}
          />
          <span className="mt-1 block text-[11px] text-slate-500">
            Nilai ini dipakai untuk SEMUA penerima kampanye ini. Kampanye
            berikutnya cukup ganti angkanya di link produk — template tidak
            perlu dibuat ulang.
          </span>
        </label>
      ))}

      {template && (
        <div className="rounded-lg border border-slate-200 px-3 py-2">
          <p className="mb-1 text-xs font-medium text-slate-600">
            Kirim uji dulu
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              placeholder="Nomor uji (kosongkan = nomor admin)"
              className={inputCls}
            />
            <button
              type="button"
              onClick={sendTest}
              disabled={testBusy || !template}
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
      )}

      {tplError && (
        <p className="text-xs text-red-600">{tplError}</p>
      )}
      {templates !== null && approvedTemplates.length === 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Belum ada template berstatus <strong>Disetujui</strong> — buat dulu
          di halaman Template dan tunggu review Meta.
        </p>
      )}

      <div>
        <span className="mb-1 block text-xs font-medium text-slate-600">
          Sasaran penerima
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
      </div>

      {limitInfo?.ok && !limitInfo.unlimited && (
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
              melebihi sisa kuota harian ({limitInfo.remaining} nomor —
              terpakai {limitInfo.sentToday} dari {limitInfo.limit}). Kiriman
              yang tembus batas akan <strong>ditolak Meta (kode 131049)</strong>{" "}
              dan tercatat Gagal. Saran: pecah jadi dua kampanye atau
              jadwalkan besok.
            </>
          ) : (
            <>
              Sisa kuota harian: <strong>{limitInfo.remaining}</strong> nomor
              (terpakai {limitInfo.sentToday} dari {limitInfo.limit}) —{" "}
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
            terbuka atau saat ada pesan masuk (webhook), plus jaring pengaman
            cron harian Vercel.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={
            busy ||
            recipients === 0 ||
            !template ||
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
