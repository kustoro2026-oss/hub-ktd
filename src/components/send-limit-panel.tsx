// Panel "Status kirim & batas harian" — data live dari Meta (batas level
// portofolio, rating kualitas, throughput) digabung hitungan kiriman Hub
// hari ini / bulan ini dari database lokal. Server component: nilai segar
// tiap kali halaman dibuka.
import { countSentThisMonth, countSentToday } from "@/lib/db";
import { getPhoneNumberStatus } from "@/lib/wa";

const TIER_MAX: Record<string, number> = {
  TIER_250: 250,
  TIER_2K: 2000,
  TIER_10K: 10000,
  TIER_100K: 100000,
  UNLIMITED: -1,
};

const TIER_LABEL: Record<string, string> = {
  TIER_250: "250 nomor unik",
  TIER_2K: "2.000 nomor unik",
  TIER_10K: "10.000 nomor unik",
  TIER_100K: "100.000 nomor unik",
  UNLIMITED: "Tanpa batas",
};

const QUALITY_LABEL: Record<string, string> = {
  GREEN: "Baik",
  YELLOW: "Sedang",
  RED: "Buruk",
  HIGH: "Baik",
  MEDIUM: "Sedang",
  LOW: "Buruk",
};

function qualityBadge(quality: string): string {
  const q = quality.toUpperCase();
  if (q === "GREEN" || q === "HIGH") return "bg-emerald-100 text-emerald-700";
  if (q === "MEDIUM" || q === "YELLOW") return "bg-amber-100 text-amber-700";
  if (q === "LOW" || q === "RED") return "bg-red-100 text-red-700";
  return "bg-slate-100 text-slate-600";
}

function Card({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-bold text-slate-900">{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

export default async function SendLimitPanel() {
  const [st, today, month] = await Promise.all([
    getPhoneNumberStatus(),
    countSentToday(),
    countSentThisMonth(),
  ]);
  const s = st.status;
  const tier = s?.whatsapp_business_manager_messaging_limit ?? "";
  const limit = TIER_MAX[tier];
  const remaining =
    limit !== undefined && limit >= 0 ? Math.max(0, limit - today) : null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">
          Status kirim &amp; batas harian
        </h2>
        <span className="flex items-center gap-1.5 text-xs text-emerald-700">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
          live dari Meta
        </span>
      </div>

      {!st.ok ? (
        <p className="text-sm text-red-600">
          Tidak dapat membaca status batas kirim dari Meta: {st.detail}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card
              label="Batas kirim harian"
              value={TIER_LABEL[tier] ?? tier ?? "?"}
              sub="level portofolio, 24 jam berjalan"
            />
            <Card
              label="Terkirim dari Hub"
              value={String(today)}
              sub={`hari ini (sisa ${remaining === null ? "?" : remaining})`}
            />
            <Card
              label="Bulan ini (Hub)"
              value={String(month)}
              sub="pesan template terkirim"
            />
            <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                Kualitas &amp; kecepatan
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${qualityBadge(s?.quality_rating ?? "")}`}
                >
                  {QUALITY_LABEL[(s?.quality_rating ?? "").toUpperCase()] ??
                    s?.quality_rating ??
                    "?"}
                </span>
                <span className="text-xs text-slate-500">
                  {s?.throughput?.level === "HIGH" ? "Kecepatan tinggi" : "Kecepatan standar"}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                {s?.verified_name ?? "?"} · {s?.display_phone_number ?? "?"}
              </div>
            </div>
          </div>

          <details className="mt-3 rounded-lg bg-slate-50 px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-slate-600">
              Cara kerja batas, apa yang terjadi bila tembus, dan cara menaikkannya
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-slate-500">
              <li>
                <strong>Batas harian</strong> = jumlah <em>nomor unik</em> yang
                boleh menerima pesan template (di luar window 24 jam) dalam
                24 jam berjalan. Dihitung per portofolio Meta — semua nomor
                bisnis dalam portofolio berbagi kuota yang sama.
              </li>
              <li>
                <strong>Bila tembus:</strong> Meta menolak kiriman berikutnya
                (kode 131049) sampai kuota pulih seiring 24 jam berjalan. Hub
                menandai barisnya <strong>Gagal</strong> beserta alasannya.
              </li>
              <li>
                <strong>Naik level:</strong> 250 → 2.000 lewat verifikasi
                bisnis; setelah itu naik otomatis bertahap 10.000 → 100.000 →
                tanpa batas bila 7 hari terakhir memakai setidaknya separuh
                batas dan kualitas pesan terjaga (naik dalam ±6 jam).
              </li>
              <li>
                <strong>Kualitas pesan:</strong> rating Baik membuat batas
                cepat naik; rating Buruk (banyak diblokir/dilaporkan) menahan
                kenaikan bahkan bisa menurunkan batas.
              </li>
              <li>
                <strong>Biaya per bulan:</strong> tidak ada jatah bulanan tetap
                — kiriman template dihitung per pesan: gratis 1.000 pesan
                layanan per bulan (balasan dalam window 24 jam), template
                marketing ±Rp586/pesan dan utility ±Rp357/pesan (Indonesia,
                dibebankan saat pesan terkirim).
              </li>
              <li>
                <strong>Bayar tidak menaikkan batas harian</strong> — batas
                hanya naik lewat verifikasi, pemakaian rutin, dan kualitas
                pesan. Pembayaran menjamin biaya pesan tertagih, bukan kuota
                tambahan.
              </li>
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
