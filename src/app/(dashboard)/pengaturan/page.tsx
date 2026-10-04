// Pengaturan — status env, catatan webhook, dan info deploy.
import { AD_PRODUCT_MAP } from "@/lib/replies";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pengaturan" };

function status(key: string, label: string, ok: boolean, detail?: string) {
  return (
    <li
      key={key}
      className="flex items-center justify-between gap-4 border-b border-slate-100 py-2.5 text-sm last:border-0"
    >
      <span className="text-slate-700">{label}</span>
      <span className="flex items-center gap-2">
        {detail && <span className="font-mono text-xs text-slate-400">{detail}</span>}
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            ok ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
          }`}
        >
          {ok ? "Terisi" : "Kosong"}
        </span>
      </span>
    </li>
  );
}

export default function PengaturanPage() {
  const envs = [
    { label: "WA_TOKEN (token permanen Meta)", ok: !!process.env.WA_TOKEN },
    {
      label: "WA_PHONE_NUMBER_ID",
      ok: !!process.env.WA_PHONE_NUMBER_ID,
      detail: process.env.WA_PHONE_NUMBER_ID,
    },
    {
      label: "WA_VERIFY_TOKEN (verifikasi webhook)",
      ok: !!process.env.WA_VERIFY_TOKEN,
    },
    {
      label: "OWNER_WA_NUMBER (penerima notif pesanan, default 6285171157938)",
      ok: true,
      detail: process.env.OWNER_WA_NUMBER ?? "6285171157938",
    },
    { label: "AUTH_PASSWORD (kata sandi admin)", ok: !!process.env.AUTH_PASSWORD },
    { label: "AUTH_SECRET (penanda cookie sesi)", ok: !!process.env.AUTH_SECRET },
    {
      label: "DATABASE_URL / POSTGRES_URL (database produksi)",
      ok: !!(process.env.DATABASE_URL ?? process.env.POSTGRES_URL),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Pengaturan</h1>
        <p className="text-sm text-slate-500">
          Status konfigurasi dan kredensial KTD Hub
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">
          Environment variables
        </h2>
        <ul>{envs.map((e) => status(e.label, e.label, e.ok, e.detail))}</ul>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <h2 className="mb-2 font-semibold text-slate-900">
          Pemetaan iklan CTWA
        </h2>
        {Object.keys(AD_PRODUCT_MAP).length === 0 ? (
          <p className="text-slate-500">
            Belum ada pemetaan. Saat iklan CTWA dibuat, tambahkan pasangan
            <code> ID iklan → URL produk</code> di <code>src/lib/replies.ts</code>{" "}
            agar balasan bot mengarah ke produk yang diiklankan.
          </p>
        ) : (
          <ul className="space-y-1 font-mono text-xs">
            {Object.entries(AD_PRODUCT_MAP).map(([adId, url]) => (
              <li key={adId}>
                {adId} → {url}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <h2 className="mb-2 font-semibold text-slate-900">Catatan penting</h2>
        <ul className="list-disc space-y-1 pl-5 text-slate-600">
          <li>
            <strong>Database:</strong> SQLite lokal (data/ktd-hub.db) untuk
            pengembangan; di Vercel otomatis memakai Postgres lewat DATABASE_URL
            (Neon / Vercel Postgres) karena filesystem serverless bersifat
            sementara.
          </li>
          <li>
            <strong>Webhook bot:</strong> Callback URL Meta App sudah diarahkan
            ke <code>/api/wa/webhook</code> di domain Hub — log chat otomatis
            masuk ke menu Pesan Masuk.
          </li>
          <li>
            <strong>Kirim massal:</strong> wajib opt-in dan memakai template yang
            disetujui (info_promo_v2). Batas kirim dihitung per portofolio bisnis:{" "}
            <strong>250 nomor unik/24 jam</strong> untuk akun baru; setelah
            verifikasi bisnis naik ke <strong>2.000</strong>, lalu bisa naik
            otomatis bertahap (10.000 → 100.000 → tanpa batas) bila kualitas
            pesan terjaga. Sebelum kirim massal, cek dulu nomor kontak di menu{" "}
            <strong>Verifikasi</strong> agar kuota tidak terbuang ke nomor
            yang tidak terdaftar WhatsApp.
          </li>
          <li>
            <strong>Verifikasi WhatsApp:</strong> menu Verifikasi mengecek
            nomor kontak lewat endpoint <code>contacts</code> Meta — gratis,
            tidak memakai kuota pesan, dan tidak mengirim apa pun ke nomor
            itu. Nomor dicek satu per satu dari browser; hasil disimpan di
            kolom <code>contacts.wa_status</code> (valid / tidak valid /
            gagal cek) dan tampil juga di halaman Kontak.
          </li>
          <li>
            <strong>Balasan otomatis:</strong> teks bebas gratis dalam window 24
            jam sejak pesan terakhir pelanggan — tanpa template.
          </li>
          <li>
            <strong>FAQ bot:</strong> pertanyaan umum pelanggan (cara pesan,
            ongkir, COD, pembayaran, stok, pengiriman, resi, jam CS, retur,
            reseller, cara pakai produk, varian, detail produk, minimal beli,
            jangkauan kirim, kurir, ubah/batal pesanan, nota, rekomendasi,
            testimoni, identitas bot "siapa ini", dll) dijawab otomatis sesuai
            FAQ situs — jawaban dikelola di <code>src/lib/faq.ts</code>.
            Pertanyaan lain yang tidak dikenali diarahkan ke CS.
          </li>
          <li>
            <strong>Bukti transfer:</strong> pesanan ber-metode Transfer Bank
            dibalas dengan permintaan bukti transfer (rekening Mandiri toko).
            Setelah pelanggan mengirim foto/screenshot/teks bukti, bot
            otomatis membalas konfirmasi pesanan. Pesanan COD langsung dapat
            konfirmasi tanpa bukti.
          </li>
          <li>
            <strong>Notifikasi pesanan:</strong> setiap pesan berisi data
            pesanan (alamat lengkap) otomatis diteruskan ke nomor admin di{" "}
            <code>OWNER_WA_NUMBER</code> (default nomor CS 6285171157938),
            lengkap dengan tanggal dan jam WIB saat pesanan masuk.
            Dikirim sebagai teks bebas; bila window 24 jam tidak terbuka,
            otomatis memakai template utility <code>order_alert_ktd2</code>
            yang bisa masuk kapan saja. Status tampil di riwayat chat (hijau =
            terkirim, abu-abu = dilewati karena pengirim adalah nomor admin,
            merah = gagal).
          </li>
          <li>
            <strong>Jeda bot:</strong> setelah admin membalas manual, bot tidak
            membalas otomatis ke nomor itu selama 30 menit (atur lewat{" "}
            <code>BOT_HANDOVER_MINUTES</code>) — percakapan dianggap sedang
            ditangani manusia, lalu bot aktif kembali bila tidak ada balasan
            manual baru.
          </li>
        </ul>
      </div>
    </div>
  );
}
