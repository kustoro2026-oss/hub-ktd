# KTD Hub

Dashboard operasional **KTD Store** — pusat pengelolaan WhatsApp dan (mendatang) sinkronisasi produk marketplace (Blibli, TikTok Shop, Lazada).

## Fitur saat ini

- **Dasbor** — ringkasan kontak, broadcast, dan pesan masuk
- **Kontak** — tambah/import/hapus penerima broadcast
- **Broadcast** — kirim pesan massal via template `info_promo` (batch 40 per klik, tombol lanjut sampai selesai)
- **Pesan Masuk** — log chat pelanggan + balasan otomatis bot
- **Pengaturan** — status env, catatan webhook, dan pemetaan iklan CTWA

## Menjalankan (lokal)

```bash
npm install
npm run dev
```

Buka http://localhost:3000 → login dengan `AUTH_PASSWORD` (lihat .env.local).

## Environment variables

| Kunci | Keterangan |
|---|---|
| `WA_TOKEN` | Token permanen Meta (System User) |
| `WA_PHONE_NUMBER_ID` | ID nomor Cloud API (1287256024481633) |
| `WA_VERIFY_TOKEN` | Token verifikasi webhook Meta |
| `AUTH_PASSWORD` | Kata sandi login admin |
| `AUTH_SECRET` | Kunci penanda cookie sesi |
| `BROADCAST_BATCH` | Jumlah penerima per batch kirim (default 40) |

## Arsitektur

- Next.js 16 (App Router) + TypeScript + Tailwind CSS 4
- Database: SQLite via `node:sqlite` (bawaan Node) → file `data/ktd-hub.db`
- Auth: satu password admin + cookie sesi bertanda tangan HMAC
- Webhook bot: `src/app/api/wa/webhook/route.ts` (GET verifikasi + POST balasan otomatis + log)

## Catatan deploy

1. **Database**: SQLite hanya untuk lokal. Untuk Vercel gunakan Postgres (Neon) — skema SQL di `src/lib/db.ts` tinggal dipindah.
2. **Webhook**: Meta hanya mengizinkan satu Callback URL per app. Setelah deploy, arahkan Callback URL Meta App ke `https://<domain-hub>/api/wa/webhook` lalu `Verifikasi dan simpan`.
3. **Kirim massal**: wajib opt-in dan template disetujui (`info_promo`). Batas 250 percakapan/hari sebelum verifikasi bisnis WhatsApp (naik ke 1.000).

## Roadmap

- Sinkronisasi produk Blibli / TikTok Shop / Lazada via API masing-masing
- Editor pemetaan iklan CTWA (AD_PRODUCT_MAP) lewat UI
- Laporan status terkirim/dibaca dari webhook `statuses`
