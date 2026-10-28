// Halaman Eksekusi Pesanan (Blibli → Aneka) — daftar antrean eksekusi
// semi-otomatis. Pesanan baru yang semua produknya sudah dipetakan ke Aneka
// otomatis disiapkan di sini dengan status "menunggu"; pemilik toko menekan
// "Setuju" untuk menjalankan checkout Aneka (bayar saldo + upload label),
// atau "Batalkan" untuk memproses manual. Bagian dari grup Marketplace →
// Blibli.
import BlibliExecClient, { type ExecRow } from "@/components/blibli-exec-client";
import { listBlibliOrderExecs } from "@/lib/db";
import PageHeader from "@/components/page-header";

export const dynamic = "force-dynamic";
export const metadata = { title: "Eksekusi Pesanan Aneka" };

/** "Rp18.450" → "Rp18.450" (angka modal). */
function fmtRp(n: number): string {
  return "Rp" + n.toLocaleString("id-ID");
}

/**
 * Timestamp DB → WIB. Semua timestamp di tabel blibli_order_exec tersimpan
 * UTC: PG dinormalisasi db.ts menjadi "YYYY-MM-DD HH:MM:SS" (UTC, tanpa Z),
 * SQLite menyimpan nowUtc dengan format yang sama. String berspasi karena
 * itu UTC, bukan WIB.
 */
function waktuWib(s: string): string {
  if (!s) return "";
  const iso = s.includes("T") ? s : s.replace(" ", "T") + "Z";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return s;
  const w = new Date(d.getTime() + 7 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(w.getUTCDate())}/${p(w.getUTCMonth() + 1)}/${w.getUTCFullYear()} ${p(w.getUTCHours())}.${p(w.getUTCMinutes())} WIB`;
}

/** Ubah jejak langkah (tiap baris "YYYY-MM-DD HH:MM:SS | ..." UTC) jadi WIB
 *  untuk tampilan — kolom log di DB tetap UTC (dipakai pemulihan). */
function logWib(log: string): string {
  if (!log) return "";
  return log
    .split("\n")
    .map((line) => {
      const m = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.exec(line);
      if (!m) return line;
      const d = new Date(m[0].replace(" ", "T") + "Z");
      if (Number.isNaN(d.getTime())) return line;
      const w = new Date(d.getTime() + 7 * 3600 * 1000);
      const p = (n: number) => String(n).padStart(2, "0");
      const wib = `${w.getUTCFullYear()}-${p(w.getUTCMonth() + 1)}-${p(w.getUTCDate())} ${p(w.getUTCHours())}:${p(w.getUTCMinutes())}:${p(w.getUTCSeconds())}`;
      return line.replace(m[0], wib);
    })
    .join("\n");
}

export default async function EksekusiBlibliPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const sp = await searchParams;
  const rows = await listBlibliOrderExecs();

  type Payload = {
    store_name?: string;
    awb_number?: string;
    total_modal?: number;
    label_pdf_base64?: string;
    audit?: {
      at: number;
      ok: boolean;
      blockers: { kode: string; teks: string }[];
      saldo?: number;
    };
    items?: {
      qty: number;
      item_name?: string;
      variant_name?: string;
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
      package_id: r.package_id,
      status: r.status,
      store_name: payload?.store_name ?? "",
      total_modal: fmtRp(payload?.total_modal ?? 0),
      // Perkiraan potong saldo sebenarnya = modal + ongkos pengemasan
      // Rp3.000 per resi (satu paket pesanan = satu resi, selalu dihitung
      // situs Aneka saat pembayaran).
      total_estimate: fmtRp((payload?.total_modal ?? 0) + 3000),
      items: (payload?.items ?? []).map((it) => ({
        qty: it.qty,
        name: it.variant_name
          ? `${it.item_name ?? ""} (${it.variant_name})`
          : it.item_name ?? "",
        subtotal: fmtRp(it.subtotal),
      })),
      awb_number: payload?.awb_number ?? "",
      aneka_payment_id: r.aneka_payment_id,
      aneka_order_id: r.aneka_order_id,
      detail: r.detail,
      log: logWib(r.log),
      created_at: waktuWib(r.created_at),
      executed_at: waktuWib(r.executed_at),
      audit: payload?.audit ?? null,
      label_siap: payload?.label_pdf_base64?.startsWith("%PDF-") ?? false,
    };
  });

  const menunggu = data.filter((d) => d.status === "menunggu").length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Marketplace · Blibli"
        title="Eksekusi Pesanan"
        subtitle="Setujui untuk checkout Aneka otomatis, atau batalkan untuk proses manual"
        actions={
          menunggu > 0 ? (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
              {menunggu} menunggu persetujuan
            </span>
          ) : null
        }
      />

      {data.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
          Belum ada antrean eksekusi. Pesanan baru yang semua produknya sudah
          dipetakan ke Aneka (halaman Pemetaan Produk) akan otomatis muncul di
          sini setelah melewati masa tunggu pembatalan, lengkap dengan notif
          WhatsApp berisi tautan halaman ini.
        </div>
      ) : (
        <BlibliExecClient rows={data} focusPackage={sp.order ?? ""} />
      )}
    </div>
  );
}
