// Detail satu pesanan top-up — info lengkap, timeline status, info
// pembayaran, hasil Digiflazz, dan tombol cek ulang pending global.
import Link from "next/link";
import { getTopupOrder } from "@/lib/db";
import { fmtRp } from "@/lib/keuangan";
import {
  CLS_BAYAR,
  CLS_TOPUP,
  LABEL_BAYAR,
  LABEL_TOPUP,
  parseUtcMs,
  topupStoreUrl,
} from "@/lib/topup";
import TopupRecheck from "@/components/topup-recheck";

export const dynamic = "force-dynamic";
export const metadata = { title: "Top Up · Detail Pesanan" };

const p = (n: number) => String(n).padStart(2, "0");

function waktuWib(ms: number): string {
  if (!ms) return "–";
  const w = new Date(ms + 7 * 3600 * 1000);
  return `${p(w.getUTCDate())}/${p(w.getUTCMonth() + 1)}/${w.getUTCFullYear()} ${p(
    w.getUTCHours(),
  )}:${p(w.getUTCMinutes())}`;
}

function Info({ label, nilai }: { label: string; nilai: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-medium text-slate-900">{nilai || "—"}</p>
    </div>
  );
}

export default async function TopupPesananDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const o = await getTopupOrder(id);

  if (!o) {
    return (
      <div className="space-y-4">
        <Link href="/topup/pesanan" className="text-sm text-emerald-700 hover:underline">
          ← Kembali ke daftar pesanan
        </Link>
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-slate-500">
          Pesanan {id} tidak ditemukan.
        </div>
      </div>
    );
  }

  const createdMs = parseUtcMs(o.created_at);
  const paidMs = parseUtcMs(o.paid_at);
  const updatedMs = parseUtcMs(o.updated_at);
  const laba = o.amount - o.cost;

  // Timeline: empat langkah dengan status dari kolom DB.
  const langkah = [
    {
      judul: "Pesanan dibuat",
      waktu: createdMs,
      selesai: true,
      aktif: true,
    },
    {
      judul:
        o.payment_status === "paid"
          ? "Pembayaran diterima"
          : o.payment_status === "expired"
            ? "Pembayaran kedaluwarsa"
            : o.payment_status === "failed"
              ? "Pembayaran gagal"
              : "Menunggu pembayaran",
      waktu: paidMs,
      selesai: o.payment_status === "paid",
      aktif: o.payment_status === "paid",
    },
    {
      judul:
        o.topup_status === "success"
          ? "Transaksi sukses"
          : o.topup_status === "failed"
            ? "Transaksi gagal"
            : "Eksekusi Digiflazz",
      waktu: o.topup_status === "waiting_payment" ? 0 : updatedMs,
      selesai: o.topup_status === "success",
      aktif: o.topup_status === "success",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/topup/pesanan" className="text-sm text-emerald-700 hover:underline">
          ← Kembali ke daftar pesanan
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold text-slate-900">{o.id}</h1>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              CLS_BAYAR[o.payment_status] ?? "bg-slate-100 text-slate-600"
            }`}
          >
            {LABEL_BAYAR[o.payment_status] ?? o.payment_status}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              CLS_TOPUP[o.topup_status] ?? "bg-slate-100 text-slate-600"
            }`}
          >
            {LABEL_TOPUP[o.topup_status] ?? o.topup_status}
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          ref {o.ref_id} · dibuat {waktuWib(createdMs)} WIB
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Produk</h2>
          <Info label="Produk" nilai={o.product_name || o.sku} />
          <Info label="SKU Digiflazz" nilai={o.sku} />
          <Info label="Tujuan" nilai={o.customer_no} />
          <Info
            label="Pembeli"
            nilai={`${o.buyer_name}${o.buyer_phone ? ` · ${o.buyer_phone}` : ""}`}
          />
          <Info label="Catatan" nilai={o.note} />
        </div>

        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Nominal</h2>
          <div className="grid grid-cols-3 gap-4">
            <Info label="Tagihan" nilai={fmtRp(o.amount)} />
            <Info label="Modal" nilai={fmtRp(o.cost)} />
            <Info
              label="Laba"
              nilai={fmtRp(laba)}
            />
          </div>
          <div className="border-t border-slate-100 pt-3">
            <Info
              label="SN Digiflazz"
              nilai={o.digiflazz_sn || (o.topup_status === "success" ? "(belum tercatat)" : "—")}
            />
          </div>
        </div>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Alur Pesanan</h2>
        <ol className="mt-4 space-y-0">
          {langkah.map((l, i) => (
            <li key={l.judul} className="relative flex gap-4 pb-6 last:pb-0">
              {i < langkah.length - 1 ? (
                <span
                  className={`absolute left-[7px] top-5 h-full w-0.5 ${
                    l.selesai ? "bg-emerald-500" : "bg-slate-200"
                  }`}
                />
              ) : null}
              <span
                className={`mt-1 h-4 w-4 shrink-0 rounded-full border-2 ${
                  l.selesai
                    ? "border-emerald-500 bg-emerald-500"
                    : l.aktif
                      ? "border-amber-400 bg-white"
                      : "border-slate-300 bg-white"
                }`}
              />
              <div>
                <p
                  className={`text-sm font-medium ${
                    l.selesai ? "text-slate-900" : "text-slate-500"
                  }`}
                >
                  {l.judul}
                </p>
                {l.waktu ? (
                  <p className="text-xs text-slate-500">
                    {waktuWib(l.waktu)} WIB
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Pembayaran</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <Info label="Session gateway" nilai={o.gateway_session} />
          <Info label="Trx gateway" nilai={o.gateway_trx} />
          <Info label="Nomor VA" nilai={o.payment_va} />
          <Info
            label="QRIS"
            nilai={o.payment_qr ? "Tersedia (lihat halaman bayar)" : "—"}
          />
          {o.payment_url ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Link bayar
              </p>
              <a
                href={o.payment_url}
                target="_blank"
                rel="noreferrer"
                className="mt-0.5 inline-block text-sm font-medium text-emerald-700 hover:underline"
              >
                Buka halaman pembayaran ↗
              </a>
            </div>
          ) : null}
        </div>
      </section>

      {o.error_message ? (
        <section className="rounded-xl border border-rose-200 bg-rose-50 p-4">
          <h2 className="text-sm font-semibold text-rose-900">Error tercatat</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-rose-900">
            {o.error_message}
          </p>
        </section>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">
          Aksi aman
        </h2>
        <p className="mb-3 mt-1 text-xs text-slate-500">
          Cek ulang seluruh transaksi pending Digiflazz (idempoten — aman
          dijalankan kapan pun).
        </p>
        <TopupRecheck />
        <p className="mt-3 text-xs text-slate-400">
          Cek status publik pembeli:{" "}
          <a
            href={`${topupStoreUrl()}/topup/cek-status?order=${encodeURIComponent(o.id)}`}
            target="_blank"
            rel="noreferrer"
            className="text-emerald-700 hover:underline"
          >
            {topupStoreUrl().replace("https://", "")}/topup/cek-status
          </a>
        </p>
      </section>
    </div>
  );
}
