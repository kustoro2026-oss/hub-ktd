// Halaman Eksekusi Pesanan (TikTok Shop → Aneka) — daftar antrean eksekusi
// semi-otomatis. Pesanan baru yang semua produknya sudah dipetakan ke Aneka
// otomatis disiapkan di sini dengan status "menunggu"; pemilik toko menekan
// "Setuju" untuk menjalankan checkout Aneka (bayar saldo + upload label),
// atau "Batalkan" untuk memproses manual. Bagian dari grup Marketplace →
// TikTok Shop.
import AnekaExecClient, { type ExecRow } from "@/components/aneka-exec-client";
import { listTiktokOrderExecs } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Eksekusi Pesanan Aneka" };

/** "Rp18.450" → "Rp18.450" (angka modal). */
function fmtRp(n: number): string {
  return "Rp" + n.toLocaleString("id-ID");
}

/** Timestamp DB (SQLite "YYYY-MM-DD HH:MM:SS" lokal / PG ISO UTC) → WIB. */
function waktuWib(s: string): string {
  if (!s) return "";
  const iso = s.includes("T") ? s : s.replace(" ", "T") + "+07:00";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return s;
  const w = new Date(d.getTime() + 7 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(w.getUTCDate())}/${p(w.getUTCMonth() + 1)}/${w.getUTCFullYear()} ${p(w.getUTCHours())}.${p(w.getUTCMinutes())} WIB`;
}

export default async function EksekusiTikTokPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const sp = await searchParams;
  const rows = await listTiktokOrderExecs();

  type Payload = {
    shop_name?: string;
    tracking_number?: string;
    total_modal?: number;
    items?: {
      qty: number;
      product_name?: string;
      name?: string;
      subtotal: number;
    }[];
  };

  const data: ExecRow[] = rows.map((r) => {
    let payload: Payload | null = null;
    try {
      payload = JSON.parse(r.payload) as Payload;
    } catch {
      payload = null;
    }
    return {
      order_id: r.order_id,
      status: r.status,
      shop_name: payload?.shop_name ?? "",
      total_modal: fmtRp(payload?.total_modal ?? 0),
      items: (payload?.items ?? []).map((it) => ({
        qty: it.qty,
        name: it.product_name ?? it.name ?? "",
        subtotal: fmtRp(it.subtotal),
      })),
      tracking_number: payload?.tracking_number ?? "",
      aneka_order_id: r.aneka_order_id,
      detail: r.detail,
      log: r.log,
      created_at: waktuWib(r.created_at),
      executed_at: waktuWib(r.executed_at),
    };
  });

  const menunggu = data.filter((d) => d.status === "menunggu").length;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
          Marketplace · TikTok Shop
        </p>
        <h1 className="text-xl font-bold text-slate-900">Eksekusi Pesanan</h1>
        <p className="text-sm text-slate-500">
          Pesanan terpetakan otomatis disiapkan di sini — tekan{" "}
          <span className="font-medium">Setuju</span> untuk checkout Aneka
          (bayar saldo + upload label), atau{" "}
          <span className="font-medium">Batalkan</span> untuk proses manual.
        </p>
        {menunggu > 0 ? (
          <p className="mt-2 inline-block rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
            {menunggu} pesanan menunggu persetujuan
          </p>
        ) : null}
      </div>

      {data.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
          Belum ada antrean eksekusi. Pesanan baru yang semua produknya sudah
          dipetakan ke Aneka (halaman Pemetaan Produk) akan otomatis muncul di
          sini setelah melewati masa tunggu pembatalan, lengkap dengan notif
          WhatsApp berisi tautan halaman ini.
        </div>
      ) : (
        <AnekaExecClient rows={data} focusOrder={sp.order ?? ""} />
      )}
    </div>
  );
}
