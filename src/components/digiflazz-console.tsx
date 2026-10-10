"use client";

// Konsol interaktif API Digiflazz — 8 seksi sesuai dokumen resmi
// (developer.digiflazz.com). Semua panggilan lewat POST /api/topup/digiflazz
// di hub, yang meneruskan ke route admin toko (penandatanganan md5 + relay
// IP whitelist terjadi di toko). Endpoint mutasi (topup, pay-pasca, deposit)
// memotong saldo ASLI — wajib lewat dialog konfirmasi (ketik ulang ref_id /
// amount) sebelum terkirim.
//
// Catatan relay: payload dengan testing:true masih dirusak dg_relay.php
// (rc=41) — centang "testing" hanya berguna setelah relay diperbaiki.
import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Loader2,
  Send,
  ShieldAlert,
  X,
} from "lucide-react";

// Helper lokal — TIDAK boleh mengimpor @/lib/keuangan di komponen klien
// (rantai impornya membawa db.ts/node:sqlite ke chunk browser).
function fmtRp(n: number): string {
  return "Rp" + Math.round(n).toLocaleString("id-ID");
}

type Hasil = {
  ok: boolean;
  detail?: string;
  data?: unknown;
  refId?: string;
  commands?: string;
  cmd?: string;
  status?: number;
  klasifikasi?: { success: boolean; pending: boolean };
  matched?: boolean;
  orderId?: string;
  orderStatusSekarang?: string;
  mapped?: string;
};

type Konfirmasi = {
  sec: string;
  judul: string;
  ringkas: string;
  teksWajib: string;
  action: string;
  payload: Record<string, unknown>;
};

type FormState = {
  plCmd: "prepaid" | "pasca";
  plCode: string;
  plCategory: string;
  plBrand: string;
  plType: string;
  tpSku: string;
  tpCustomer: string;
  tpRef: string;
  tpTesting: boolean;
  tpMax: string;
  inqSku: string;
  inqCustomer: string;
  inqRef: string;
  paySku: string;
  payCustomer: string;
  payRef: string;
  stSku: string;
  stCustomer: string;
  stRef: string;
  plnCustomer: string;
  depAmount: string;
  depBank: string;
  depOwner: string;
  whRef: string;
  whStatus: string;
  whSn: string;
  whMessage: string;
};

const FORM_AWAL: FormState = {
  plCmd: "prepaid",
  plCode: "",
  plCategory: "",
  plBrand: "",
  plType: "",
  tpSku: "",
  tpCustomer: "",
  tpRef: "",
  tpTesting: false,
  tpMax: "",
  inqSku: "",
  inqCustomer: "",
  inqRef: "",
  paySku: "",
  payCustomer: "",
  payRef: "",
  stSku: "",
  stCustomer: "",
  stRef: "",
  plnCustomer: "",
  depAmount: "",
  depBank: "Flip",
  depOwner: "",
  whRef: "",
  whStatus: "Sukses",
  whSn: "",
  whMessage: "",
};

const INPUT =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";
const SELECT = `${INPUT} pr-8`;
const BTN =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50";
const BTN_BAHAYA =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50";
const BTN_GARIS =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

/** Ref ID unik sementara — hanya dipanggil dari event handler (aturan purity). */
function genRef(awalan: string): string {
  return (
    awalan +
    Date.now().toString(36).toUpperCase().slice(-6) +
    Math.random().toString(36).slice(2, 6).toUpperCase()
  );
}

function teks(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "";
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function Seksi({
  nomor,
  judul,
  deskripsi,
  bahaya,
  children,
}: {
  nomor: string;
  judul: string;
  deskripsi: string;
  bahaya?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={`rounded-xl border bg-white p-4 shadow-sm ${
        bahaya ? "border-red-200" : "border-slate-200"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold ${
            bahaya ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
          }`}
        >
          {nomor}
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-slate-900">{judul}</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{deskripsi}</p>
        </div>
      </div>
      {bahaya ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Aksi ini memotong saldo Digiflazz asli — wajib konfirmasi ketik ulang sebelum terkirim.</span>
        </div>
      ) : null}
      <div className="mt-3 space-y-4">{children}</div>
    </section>
  );
}

/** Ringkasan terstruktur per seksi — hanya untuk data yang bentuknya dikenal. */
function Ringkas({ sec, data }: { sec: string; data: unknown }) {
  if (sec === "cek-saldo") {
    const d = data as { deposit?: string | number };
    const dep = typeof d?.deposit !== "undefined" ? Number(d.deposit) : NaN;
    if (Number.isFinite(dep)) {
      return (
        <div className="mt-2 rounded-lg bg-emerald-50 px-3 py-2">
          <p className="text-xs font-medium text-emerald-900">Sisa deposit</p>
          <p className="text-lg font-bold text-emerald-700">{fmtRp(dep)}</p>
        </div>
      );
    }
  }
  if (sec === "topup" || sec === "inq-pasca" || sec === "pay-pasca" || sec === "status-pasca") {
    const d = data as Record<string, unknown> | undefined;
    if (!d || typeof d !== "object") return null;
    const status = teks(d.status);
    const rc = teks(d.rc);
    if (!status && !rc) return null;
    const bagus = /sukses|success/i.test(status) || rc === "00";
    return (
      <div
        className={`mt-2 rounded-lg px-3 py-2 ${
          bagus ? "bg-emerald-50" : "bg-amber-50"
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-slate-900">{status || `rc ${rc}`}</span>
          {rc ? (
            <span className="rounded bg-white px-1.5 py-0.5 text-xs font-medium text-slate-600">
              rc {rc}
            </span>
          ) : null}
          {teks(d.message) ? (
            <span className="text-xs text-slate-600">{teks(d.message)}</span>
          ) : null}
        </div>
        <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600 sm:grid-cols-3">
          {teks(d.sn) ? <div>SN: <b>{teks(d.sn)}</b></div> : null}
          {teks(d.customer_name) ? <div>Pelanggan: <b>{teks(d.customer_name)}</b></div> : null}
          {typeof d.price !== "undefined" ? <div>Harga: <b>{fmtRp(Number(d.price) || 0)}</b></div> : null}
          {typeof d.buyer_last_saldo !== "undefined" ? (
            <div>Sisa saldo: <b>{fmtRp(Number(d.buyer_last_saldo) || 0)}</b></div>
          ) : null}
        </dl>
      </div>
    );
  }
  if (sec === "inquiry-pln") {
    const d = data as Record<string, unknown> | undefined;
    if (!d || typeof d !== "object") return null;
    if (!teks(d.name) && !teks(d.segment_power) && !teks(d.meter_no)) return null;
    return (
      <div className="mt-2 rounded-lg bg-emerald-50 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          {teks(d.name) ? <span className="text-sm font-bold text-slate-900">{teks(d.name)}</span> : null}
          {teks(d.segment_power) ? (
            <span className="rounded bg-white px-1.5 py-0.5 text-xs font-medium text-slate-600">
              {teks(d.segment_power)}
            </span>
          ) : null}
          {teks(d.rc) ? <span className="text-xs text-slate-500">rc {teks(d.rc)}</span> : null}
        </div>
        <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
          {teks(d.meter_no) ? <div>Meter: <b>{teks(d.meter_no)}</b></div> : null}
          {teks(d.subscriber_id) ? <div>Subscriber: <b>{teks(d.subscriber_id)}</b></div> : null}
          {teks(d.customer_no) ? <div>ID Pel: <b>{teks(d.customer_no)}</b></div> : null}
        </dl>
      </div>
    );
  }
  if (sec === "deposit") {
    const d = data as Record<string, unknown> | undefined;
    if (!d || typeof d !== "object") return null;
    if (!teks(d.account_no) && !teks(d.bank)) return null;
    return (
      <div className="mt-2 rounded-lg bg-emerald-50 px-3 py-2">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600 sm:grid-cols-3">
          {teks(d.bank) ? <div>Bank: <b>{teks(d.bank)}</b></div> : null}
          {teks(d.payment_method) ? <div>Metode: <b>{teks(d.payment_method)}</b></div> : null}
          {teks(d.account_no) ? <div>Rekening: <b>{teks(d.account_no)}</b></div> : null}
          {typeof d.amount !== "undefined" ? <div>Transfer: <b>{fmtRp(Number(d.amount) || 0)}</b></div> : null}
          {teks(d.notes) ? <div>Berita: <b>{teks(d.notes)}</b></div> : null}
        </dl>
      </div>
    );
  }
  return null;
}

function HasilPanel({ sec, hasil }: { sec: string; hasil: Hasil | null }) {
  const [buka, setBuka] = useState(false);
  if (!hasil) return null;
  if (!hasil.ok) {
    return (
      <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
        <p className="font-medium">Panggilan gagal{hasil.status ? ` (HTTP ${hasil.status})` : ""}</p>
        <p className="mt-1 text-xs leading-relaxed">{hasil.detail ?? "Tanpa detail"}</p>
      </div>
    );
  }
  const data = hasil.data;
  const hargaList = Array.isArray(data) ? (data as Record<string, unknown>[]) : null;
  return (
    <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2">
      <div className="flex items-center gap-2 text-sm font-medium text-emerald-800">
        <CheckCircle2 className="h-4 w-4" />
        Berhasil
        {hasil.status ? <span className="text-xs font-normal text-emerald-700">HTTP {hasil.status}</span> : null}
        {hasil.refId ? <span className="truncate text-xs font-normal text-emerald-700">ref: {hasil.refId}</span> : null}
        {hasil.klasifikasi?.pending ? (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
            Pending
          </span>
        ) : null}
      </div>

      {hargaList ? (
        <div className="mt-2 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between px-3 py-2 text-xs text-slate-500">
            <span>
              {hargaList.length.toLocaleString("id-ID")} SKU
              {hargaList.length > 200 ? ` — menampilkan 200 pertama` : ""}
            </span>
          </div>
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-1.5 font-semibold">SKU</th>
                  <th className="px-3 py-1.5 font-semibold">Produk</th>
                  <th className="px-3 py-1.5 font-semibold">Brand</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Harga</th>
                  <th className="px-3 py-1.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {hargaList.slice(0, 200).map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-3 py-1.5 font-mono text-[11px]">{teks(r.buyer_sku_code)}</td>
                    <td className="max-w-[220px] truncate px-3 py-1.5">{teks(r.product_name)}</td>
                    <td className="px-3 py-1.5">{teks(r.brand)}</td>
                    <td className="px-3 py-1.5 text-right">{fmtRp(Number(r.price) || 0)}</td>
                    <td className="px-3 py-1.5">
                      {r.buyer_product_status === true && r.seller_product_status === true ? (
                        <span className="text-emerald-600">Aktif</span>
                      ) : (
                        <span className="text-red-600">Nonaktif</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <Ringkas sec={sec} data={data} />
      )}

      <button
        onClick={() => setBuka((b) => !b)}
        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-900"
      >
        {buka ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        JSON mentah
      </button>
      {buka ? (
        <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-emerald-200">
          {JSON.stringify(data, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

/** Hasil simulasi webhook — ref cocok atau tidak + status yang AKAN ditulis. */
function WhSimHasil({ hasil }: { hasil: Hasil | null }) {
  if (!hasil) return null;
  if (!hasil.ok) {
    return (
      <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
        <p className="font-medium">Simulasi gagal</p>
        <p className="mt-1 text-xs leading-relaxed">{hasil.detail ?? "Tanpa detail"}</p>
      </div>
    );
  }
  return (
    <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-emerald-800">
        <CheckCircle2 className="h-4 w-4" />
        {hasil.matched ? "ref_id cocok" : "ref_id tidak cocok"}
        {hasil.mapped ? (
          <span className="rounded bg-white px-1.5 py-0.5 text-xs font-medium text-slate-600">
            status webhook → {hasil.mapped}
          </span>
        ) : null}
      </div>
      {hasil.orderId ? (
        <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
          <div>Pesanan: <b>{hasil.orderId}</b></div>
          <div>Status sekarang: <b>{hasil.orderStatusSekarang}</b></div>
        </dl>
      ) : null}
      <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{hasil.detail}</p>
    </div>
  );
}

/** Tabel log webhook terbaru (audit) dari toko. */
function WhLogTable({ logs }: { logs: unknown }) {
  const rows = Array.isArray(logs) ? (logs as Record<string, unknown>[]) : [];
  if (!rows.length) {
    return <p className="mt-2 text-xs text-slate-500">Belum ada log webhook.</p>;
  }
  return (
    <div className="mt-2 max-h-72 overflow-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-slate-50 text-slate-600">
          <tr>
            <th className="px-3 py-1.5 font-semibold">Waktu (UTC)</th>
            <th className="px-3 py-1.5 font-semibold">ref_id</th>
            <th className="px-3 py-1.5 font-semibold">Hasil proses</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100 align-top">
              <td className="whitespace-nowrap px-3 py-1.5">{teks(r.created_at)}</td>
              <td className="px-3 py-1.5 font-mono text-[11px]">{teks(r.ref_id) || "-"}</td>
              <td className="px-3 py-1.5 text-slate-600">{teks(r.action)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KonfirmasiModal({
  konfirmasi,
  busy,
  onOke,
  onBatal,
}: {
  konfirmasi: Konfirmasi;
  busy: boolean;
  onOke: () => void;
  onBatal: () => void;
}) {
  const [teks, setTeks] = useState("");
  const cocok = teks.trim() === konfirmasi.teksWajib;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-red-100 p-2">
            <AlertTriangle className="h-5 w-5 text-red-600" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-900">{konfirmasi.judul}</h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">{konfirmasi.ringkas}</p>
          </div>
          <button onClick={onBatal} className="ml-auto text-slate-400 hover:text-slate-600" aria-label="Tutup">
            <X className="h-4 w-4" />
          </button>
        </div>
        <label className="mt-4 block">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            Ketik <b className="font-mono">{konfirmasi.teksWajib}</b> untuk melanjutkan
          </span>
          <input
            value={teks}
            onChange={(e) => setTeks(e.target.value)}
            placeholder={konfirmasi.teksWajib}
            className={INPUT}
            autoFocus
          />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onBatal} className={BTN_GARIS} disabled={busy}>
            Batal
          </button>
          <button onClick={onOke} className={BTN_BAHAYA} disabled={!cocok || busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Kirim ke Digiflazz
          </button>
        </div>
      </div>
    </div>
  );
}

function SalinRef({ value, onAcak }: { value: string; onAcak: () => void }) {
  return (
    <div className="flex gap-2">
      <input value={value} readOnly placeholder="ref_id unik" className={`${INPUT} font-mono`} />
      <button
        type="button"
        onClick={onAcak}
        className={BTN_GARIS}
        title="Isi ref_id acak"
      >
        <Copy className="h-4 w-4" />
        Acak
      </button>
    </div>
  );
}

export default function DigiflazzConsole() {
  const [f, setF] = useState<FormState>(FORM_AWAL);
  const [busy, setBusy] = useState<string | null>(null);
  const [hasil, setHasil] = useState<Record<string, Hasil | null>>({});
  const [confirm, setConfirm] = useState<Konfirmasi | null>(null);

  const atur = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setF((s) => ({ ...s, [k]: v }));

  async function panggil(sec: string, action: string, payload: Record<string, unknown>) {
    setBusy(sec);
    setHasil((h) => ({ ...h, [sec]: null }));
    try {
      const res = await fetch("/api/topup/digiflazz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, payload }),
      });
      const j = (await res.json().catch(() => null)) as Hasil | null;
      setHasil((h) => ({
        ...h,
        [sec]: j ?? { ok: false, detail: `HTTP ${res.status} tanpa respons JSON` },
      }));
    } catch (e) {
      setHasil((h) => ({
        ...h,
        [sec]: { ok: false, detail: e instanceof Error ? e.message : "galat jaringan" },
      }));
    } finally {
      setBusy(null);
    }
  }

  /** Aksi mutasi: minta konfirmasi dulu, baru kirim setelah teks cocok. */
  function mintaKonfirmasi(k: Konfirmasi) {
    setConfirm(k);
  }

  async function kirimKonfirmasi() {
    if (!confirm) return;
    const k = confirm;
    setConfirm(null);
    await panggil(k.sec, k.action, k.payload);
  }

  const busyIni = (sec: string) => busy === sec;
  const hasilIni = (sec: string) => hasil[sec] ?? null;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">
        <p className="font-semibold">Cara kerja konsol</p>
        <ul className="mt-1 list-disc pl-4">
          <li>Semua panggilan lewat relay toko (IP whitelist Digiflazz) — penandatanganan md5 dilakukan di server toko.</li>
          <li>Endpoint <b>1–3, 7</b> tidak memotong saldo; endpoint <b>3 (tanpa testing), 5, 8</b> memotong saldo asli dan wajib konfirmasi.</li>
          <li>Centang <b>testing</b> untuk dev — catatan: relay saat ini merusak payload testing (rc=41) sampai dg_relay.php diperbaiki.</li>
          <li>Endpoint <b>7 (inquiry-pln)</b> dan <b>8 (deposit)</b> adalah jalur relay baru — bila kena blokir, izinkan dulu di allowlist dg_relay.php.</li>
          <li>Webhook (seksi <b>9</b>) menarik status transaksi dari Digiflazz secara real-time — lapisan tambahan di atas pola sinkron + polling.</li>
        </ul>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* 1. Daftar Harga */}
        <Seksi
          nomor="1"
          judul="Daftar Harga (price-list)"
          deskripsi="POST /v1/price-list — ambil harga per SKU. Rate-limited (rc=83), gunakan seperlunya."
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Command">
              <select value={f.plCmd} onChange={(e) => atur("plCmd", e.target.value as FormState["plCmd"])} className={SELECT}>
                <option value="prepaid">prepaid</option>
                <option value="pasca">pasca</option>
              </select>
            </Field>
            <Field label="Kode produk (opsional)">
              <input value={f.plCode} onChange={(e) => atur("plCode", e.target.value)} placeholder="xld25" className={INPUT} />
            </Field>
            <Field label="Kategori (opsional)">
              <input value={f.plCategory} onChange={(e) => atur("plCategory", e.target.value)} placeholder="Games" className={INPUT} />
            </Field>
            <Field label="Brand (opsional)">
              <input value={f.plBrand} onChange={(e) => atur("plBrand", e.target.value)} placeholder="Mobile Legends" className={INPUT} />
            </Field>
            <Field label="Tipe (opsional)">
              <input value={f.plType} onChange={(e) => atur("plType", e.target.value)} placeholder="Umum" className={INPUT} />
            </Field>
          </div>
          <button
            onClick={() => panggil("pl", "price-list", {
              cmd: f.plCmd,
              code: f.plCode.trim() || undefined,
              category: f.plCategory.trim() || undefined,
              brand: f.plBrand.trim() || undefined,
              type: f.plType.trim() || undefined,
            })}
            disabled={busyIni("pl")}
            className={BTN}
          >
            {busyIni("pl") ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Ambil Daftar Harga
          </button>
          <HasilPanel sec="pl" hasil={hasilIni("pl")} />
        </Seksi>

        {/* 2. Cek Saldo */}
        <Seksi nomor="2" judul="Cek Saldo (cek-saldo)" deskripsi="POST /v1/cek-saldo — sisa deposit Digiflazz terkini.">
          <button
            onClick={() => panggil("saldo", "cek-saldo", {})}
            disabled={busyIni("saldo")}
            className={BTN}
          >
            {busyIni("saldo") ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Cek Saldo
          </button>
          <HasilPanel sec="cek-saldo" hasil={hasilIni("saldo")} />
        </Seksi>

        {/* 3. Topup Prabayar */}
        <Seksi
          nomor="3"
          judul="Top Up Prabayar (transaction)"
          deskripsi="POST /v1/transaction — kirim top up (atau cek ulang status prabayar dengan ref_id yang sama)."
          bahaya
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="buyer_sku_code">
              <input value={f.tpSku} onChange={(e) => atur("tpSku", e.target.value)} placeholder="ml5" className={INPUT} />
            </Field>
            <Field label="customer_no">
              <input value={f.tpCustomer} onChange={(e) => atur("tpCustomer", e.target.value)} placeholder="081234567890" className={INPUT} />
            </Field>
            <Field label="max_price (opsional, Rp)">
              <input value={f.tpMax} onChange={(e) => atur("tpMax", e.target.value)} placeholder="60000" className={INPUT} />
            </Field>
            <label className="flex items-end gap-2 pb-2">
              <input type="checkbox" checked={f.tpTesting} onChange={(e) => atur("tpTesting", e.target.checked)} className="h-4 w-4 accent-emerald-600" />
              <span className="text-xs font-medium text-slate-600">testing (rusak via relay — lihat catatan)</span>
            </label>
          </div>
          <Field label="ref_id">
            <SalinRef value={f.tpRef} onAcak={() => atur("tpRef", genRef("KTDH"))} />
          </Field>
          <button
            onClick={() => {
              const payload: Record<string, unknown> = { sku: f.tpSku.trim(), customerNo: f.tpCustomer.trim(), refId: f.tpRef.trim() };
              if (f.tpTesting) payload.testing = true;
              if (f.tpMax.trim()) payload.maxPrice = Number(f.tpMax);
              mintaKonfirmasi({
                sec: "tp",
                judul: "Kirim transaksi top up asli?",
                ringkas: `SKU ${f.tpSku.trim()} ke ${f.tpCustomer.trim()}. Saldo Digiflazz akan terpotong sesuai harga SKU.`,
                teksWajib: f.tpRef.trim(),
                action: "topup",
                payload,
              });
            }}
            disabled={busyIni("tp") || !f.tpSku.trim() || !f.tpCustomer.trim() || !f.tpRef.trim()}
            className={BTN_BAHAYA}
          >
            {busyIni("tp") ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}
            Kirim Top Up
          </button>
          <HasilPanel sec="topup" hasil={hasilIni("tp")} />
        </Seksi>

        {/* 4. Cek Tagihan */}
        <Seksi
          nomor="4"
          judul="Cek Tagihan (inq-pasca)"
          deskripsi="POST /v1/transaction dengan commands inq-pasca — inquiry tagihan PLN/BPJS/PDAM/dll. Tidak memotong saldo."
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="buyer_sku_code">
              <input value={f.inqSku} onChange={(e) => atur("inqSku", e.target.value)} placeholder="pln" className={INPUT} />
            </Field>
            <Field label="customer_no">
              <input value={f.inqCustomer} onChange={(e) => atur("inqCustomer", e.target.value)} placeholder="530000000003" className={INPUT} />
            </Field>
          </div>
          <Field label="ref_id">
            <SalinRef value={f.inqRef} onAcak={() => atur("inqRef", genRef("KTDQ"))} />
          </Field>
          <button
            onClick={() => panggil("inq", "inq-pasca", { sku: f.inqSku.trim(), customerNo: f.inqCustomer.trim(), refId: f.inqRef.trim() })}
            disabled={busyIni("inq") || !f.inqSku.trim() || !f.inqCustomer.trim() || !f.inqRef.trim()}
            className={BTN}
          >
            {busyIni("inq") ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Cek Tagihan
          </button>
          <HasilPanel sec="inq-pasca" hasil={hasilIni("inq")} />
        </Seksi>

        {/* 5. Bayar Tagihan */}
        <Seksi
          nomor="5"
          judul="Bayar Tagihan (pay-pasca)"
          deskripsi="POST /v1/transaction dengan commands pay-pasca — bayar tagihan. ref_id HARUS sama dengan inquiry; hanya bisa di hari yang sama dengan pengecekan."
          bahaya
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="buyer_sku_code">
              <input value={f.paySku} onChange={(e) => atur("paySku", e.target.value)} placeholder="pln" className={INPUT} />
            </Field>
            <Field label="customer_no">
              <input value={f.payCustomer} onChange={(e) => atur("payCustomer", e.target.value)} placeholder="530000000003" className={INPUT} />
            </Field>
          </div>
          <Field label="ref_id (sama dengan inquiry)">
            <SalinRef value={f.payRef} onAcak={() => atur("payRef", genRef("KTDP"))} />
          </Field>
          <button
            onClick={() =>
              mintaKonfirmasi({
                sec: "pay",
                judul: "Bayar tagihan asli?",
                ringkas: `SKU ${f.paySku.trim()} untuk ${f.payCustomer.trim()}. Saldo Digiflazz terpotong sebesar tagihan.`,
                teksWajib: f.payRef.trim(),
                action: "pay-pasca",
                payload: { sku: f.paySku.trim(), customerNo: f.payCustomer.trim(), refId: f.payRef.trim() },
              })
            }
            disabled={busyIni("pay") || !f.paySku.trim() || !f.payCustomer.trim() || !f.payRef.trim()}
            className={BTN_BAHAYA}
          >
            {busyIni("pay") ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}
            Bayar Tagihan
          </button>
          <HasilPanel sec="pay-pasca" hasil={hasilIni("pay")} />
        </Seksi>

        {/* 6. Cek Status */}
        <Seksi
          nomor="6"
          judul="Cek Status (status-pasca)"
          deskripsi="POST /v1/transaction dengan commands status-pasca. Untuk prabayar, cek status = kirim ulang topup (seksi 3) dengan ref_id yang sama."
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="buyer_sku_code">
              <input value={f.stSku} onChange={(e) => atur("stSku", e.target.value)} placeholder="pln" className={INPUT} />
            </Field>
            <Field label="customer_no">
              <input value={f.stCustomer} onChange={(e) => atur("stCustomer", e.target.value)} placeholder="530000000003" className={INPUT} />
            </Field>
          </div>
          <Field label="ref_id">
            <SalinRef value={f.stRef} onAcak={() => atur("stRef", genRef("KTDS"))} />
          </Field>
          <button
            onClick={() => panggil("st", "status-pasca", { sku: f.stSku.trim(), customerNo: f.stCustomer.trim(), refId: f.stRef.trim() })}
            disabled={busyIni("st") || !f.stSku.trim() || !f.stCustomer.trim() || !f.stRef.trim()}
            className={BTN}
          >
            {busyIni("st") ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Cek Status
          </button>
          <HasilPanel sec="status-pasca" hasil={hasilIni("st")} />
        </Seksi>

        {/* 7. Inquiry PLN */}
        <Seksi
          nomor="7"
          judul="Inquiry PLN (inquiry-pln)"
          deskripsi="POST /v1/inquiry-pln — validasi ID pelanggan PLN pascabayar (endpoint khusus, sign pakai customer_no)."
        >
          <Field label="customer_no (ID pelanggan PLN)">
            <input value={f.plnCustomer} onChange={(e) => atur("plnCustomer", e.target.value)} placeholder="1234554321" className={INPUT} />
          </Field>
          <button
            onClick={() => panggil("pln", "inquiry-pln", { customerNo: f.plnCustomer.trim() })}
            disabled={busyIni("pln") || !f.plnCustomer.trim()}
            className={BTN}
          >
            {busyIni("pln") ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Inquiry PLN
          </button>
          <HasilPanel sec="inquiry-pln" hasil={hasilIni("pln")} />
        </Seksi>

        {/* 8. Deposit */}
        <Seksi
          nomor="8"
          judul="Deposit — Penarikan Tiket (deposit)"
          deskripsi="POST /v1/deposit — BUAT TIKET PENARIKAN saldo (bukan top-up). Balasan berisi rekening tujuan + berita transfer."
          bahaya
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="amount (Rp)">
              <input
                value={f.depAmount}
                onChange={(e) => atur("depAmount", e.target.value)}
                placeholder="500000"
                inputMode="numeric"
                className={INPUT}
              />
            </Field>
            <Field label="bank">
              <select value={f.depBank} onChange={(e) => atur("depBank", e.target.value)} className={SELECT}>
                <option value="Flip">Flip</option>
                <option value="ShopeePay">ShopeePay</option>
                <option value="BCA">BCA</option>
                <option value="MANDIRI">MANDIRI</option>
                <option value="BRI">BRI</option>
                <option value="BNI">BNI</option>
              </select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="owner_name (nama pemilik rekening pengirim)">
                <input value={f.depOwner} onChange={(e) => atur("depOwner", e.target.value)} placeholder="Kustoro" className={INPUT} />
              </Field>
            </div>
          </div>
          <button
            onClick={() =>
              mintaKonfirmasi({
                sec: "dep",
                judul: "Buat tiket penarikan saldo?",
                ringkas: `${fmtRp(Number(f.depAmount) || 0)} ke rekening ${f.depOwner.trim()} (bank ${f.depBank}). Tiket penarikan akan dibuat di Digiflazz.`,
                teksWajib: f.depAmount.trim(),
                action: "deposit",
                payload: { amount: Number(f.depAmount), bank: f.depBank, ownerName: f.depOwner.trim() },
              })
            }
            disabled={busyIni("dep") || !Number(f.depAmount) || !f.depOwner.trim()}
            className={BTN_BAHAYA}
          >
            {busyIni("dep") ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}
            Buat Tiket Penarikan
          </button>
          <HasilPanel sec="deposit" hasil={hasilIni("dep")} />
        </Seksi>
      </div>

      {/* 9. Webhook */}
      <Seksi
        nomor="9"
        judul="Webhook (Callback Status Transaksi)"
        deskripsi="Digiflazz POST hasil transaksi ke URL toko — status pesanan diperbarui otomatis tanpa polling. Simulasi di bawah tidak menulis apa pun."
      >
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
          <p className="font-semibold text-slate-700">Cara penerapan</p>
          <ol className="mt-1 list-decimal pl-4">
            <li>Token <b className="font-mono">TOPUP_WEBHOOK_TOKEN</b> sudah diatur di server toko (env Vercel).</li>
            <li>Daftarkan Payload URL di member area Digiflazz (Atur Koneksi → Webhook): <b className="font-mono">https://toko.kustoro2026.com/api/topup/webhook?token=TOKEN</b> — atau kirim <b className="font-mono">cb_url</b> per transaksi (field di seksi 3).</li>
            <li>Isi kolom <b>Secret</b> di form webhook dengan token yang sama, lalu tombol jadikan <b>Aktif</b> → Simpan. Digiflazz menandatangani tiap event dengan HMAC-SHA1 (header X-Hub-Signature) yang diverifikasi server; event ping otomatis terkirim saat disimpan sebagai uji URL.</li>
            <li>Digiflazz akan POST status transaksi; sistem mencocokkan ref_id, memperbarui status pesanan + notifikasi WA. Polling tetap jadi cadangan.</li>
          </ol>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="ref_id (pesanan kita)">
            <input value={f.whRef} onChange={(e) => atur("whRef", e.target.value)} placeholder="KTD..." className={`${INPUT} font-mono`} />
          </Field>
          <Field label="status webhook">
            <select value={f.whStatus} onChange={(e) => atur("whStatus", e.target.value)} className={SELECT}>
              <option value="Sukses">Sukses</option>
              <option value="Pending">Pending</option>
              <option value="Gagal">Gagal</option>
            </select>
          </Field>
          <Field label="sn (opsional)">
            <input value={f.whSn} onChange={(e) => atur("whSn", e.target.value)} placeholder="SN..." className={INPUT} />
          </Field>
          <Field label="message (opsional)">
            <input value={f.whMessage} onChange={(e) => atur("whMessage", e.target.value)} placeholder="..." className={INPUT} />
          </Field>
        </div>
        <button
          onClick={() => panggil("whsim", "webhook-sim", {
            refId: f.whRef.trim(),
            status: f.whStatus,
            sn: f.whSn.trim() || undefined,
            message: f.whMessage.trim() || undefined,
          })}
          disabled={busyIni("whsim") || !f.whRef.trim()}
          className={BTN}
        >
          {busyIni("whsim") ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Simulasikan (tanpa menulis)
        </button>
        <WhSimHasil hasil={hasilIni("whsim")} />
        <div className="border-t border-slate-100 pt-3">
          <button
            onClick={() => panggil("whlog", "webhook-log", { limit: 20 })}
            disabled={busyIni("whlog")}
            className={BTN_GARIS}
          >
            {busyIni("whlog") ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />}
            Muat Log Webhook Terakhir
          </button>
          <WhLogTable logs={(hasilIni("whlog") as Hasil | null)?.data} />
        </div>
      </Seksi>

      {confirm ? (
        <KonfirmasiModal
          key={`${confirm.sec}-${confirm.teksWajib}`}
          konfirmasi={confirm}
          busy={busy !== null}
          onOke={kirimKonfirmasi}
          onBatal={() => setConfirm(null)}
        />
      ) : null}
    </div>
  );
}
