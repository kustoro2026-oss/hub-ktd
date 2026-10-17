# Aturan Produk Dilarang per Marketplace — Referensi Rule Engine KTD Hub

Dokumen riset Tahap 2 (17 Okt 2026). Dipakai oleh rule engine Tahap 5
(2 lapis: aturan umum + aturan per marketplace) dan sebagai dasar
pratinjau upload Tahap 6. KTD Store (situs sendiri) sengaja TIDAK
dibahas — kebijakan internal bebas.

Sumber: pedoman resmi seller masing-masing platform (tautan di tiap bagian)
+ pengalaman audit katalog KTD Store sebelumnya (arsip `_audit-blibli`,
`tiktok-upload/_lazada-aturan-poin.txt`).

---

## 1. TikTok Shop Indonesia (TikTok Shop by Tokopedia)

TikTok Shop Indonesia dikelola **TikTok Shop by Tokopedia** — pedoman resmi
di `seller-id.tokopedia.com/university` (bukan tiktok.com/globalshop).

Sumber resmi:
- Pedoman Produk yang Dilarang — knowledge_id 7753801411184386
- Pedoman Produk yang Dibatasi & Produk Tidak Didukung — knowledge_id 10000847

### 1.1 Produk DILARANG (12 kelas)

| # | Kelas | Contoh yang relevan untuk katalog kita |
|---|---|---|
| 1 | Senjata api, amunisi, senjata & benda berbilah | pedang, belati, keris, parang, golok, pisau lipat otomatis (pisau dapur/meja/alat berkebun tetap boleh) |
| 2 | Barang berbahaya | racun & karsinogenik, zat kimia komersial, bahan mudah terbakar (bensin, tiner, aseton), bahan korosif (natrium hipoklorit pekat, soda kaustik) |
| 3 | Bagian & jasad tubuh manusia | wig rambut asli, cairan tubuh |
| 4 | Hewan/produk hewan dilindungi, satwa liar | organ/tanduk/gading/bulu hewan dilindungi |
| 5 | Produk & layanan dewasa | mainan seks, produk penambah seksual, afrodisiak, pakaian erotis |
| 6 | Produk diskriminatif & menyinggung | materi kebencian, SARA |
| 7 | Obat-obatan terlarang & perlengkapan narkoba | bong, "legal high", zat psikoaktif |
| 8 | Keamanan & privasi | data pribadi, kamera tersembunyi, alat retas |
| 9 | Item pemerintah & militer | borgol, zirah, atribut polisi/militer |
| 10 | Memfasilitasi aktivitas ilegal | perjudian, alat buka kunci, dokumen palsu, kembang api |
| 11 | Barang konsumen tanpa label / dikemas ulang | produk tanpa identitas; **obat/suplemen/makanan/kecantikan yang dikemas ulang oleh penjual** |
| 12 | Lainnya | **produk palsu/replika, pelanggaran HKI (3.12)**, produk kedaluwarsa, barang curian, MLM |

### 1.2 Produk DIBATASI (perlu persetujuan + dokumen)

| Kategori | Dokumen wajib |
|---|---|
| Bayi & ibu hamil tertentu | izin distribusi Kemenkes (pompa ASI, botol bayi, popok); SNI (pakaian bayi) |
| Kecantikan & perawatan pribadi | **nomor notifikasi BPOM**, label kemasan lengkap, batch, kedaluwarsa; TIDAK BOLEH ada klaim medis (mendiagnosis/menyembuhkan/mengobati) |
| Makanan & minuman | **BPOM / SPP-IRT / PSAT** (sertifikat hampir kedaluwarsa ≤30 hari ditolak), label, halal, batch |
| Suplemen makanan (vitamin) | **BPOM**, label, batch, peringatan |
| Alat kesehatan rumah tangga | izin edar Kemenkes |
| Komponen elektronik / aksesori PC gaming | NIB; SNI/NPB/K3L (elektronik); Postel (headset/keyboard/mouse gaming) |

### 1.3 Produk TIDAK DIDUKUNG (tidak bisa dijual sama sekali)

Yang PALING relevan dengan katalog KTD Store:

- **5.1 Obat-obatan & perangkat medis**: obat resep dokter, obat tidak
  dijual bebas, produk klaim afrodisiak / peningkat organ seksual.
- **5.2 Obat OTC (bebas)**: juga TIDAK didukung (khusus undangan).
- **5.3 Alkohol, tembakau, rokok elektrik** + perlengkapan merokok.
- **5.7 Produk bekas**, **5.8 tanaman hidup**, **5.9 hewan hidup**.
- **5.15 Produk manajemen berat badan** — pil/bubuk/gummies/jelly klaim
  menurunkan berat badan TIDAK didukung.
- **5.16 Lainnya**: pemantik api, gas mudah terbakar, cairan mudah
  terbakar (isopropil alkohol, etanol, aseton, terpentin), padatan mudah
  terbakar (korek), zat pengoksidasi (hidrogen peroksida, kalium
  permanganat, pupuk amonium nitrat), korosif (asam sulfat, NaOH),
  mesin/jarum tato, kotak misteri.

### 1.4 Khusus undangan (invite-only)

SIM/pulsa/data, susu formula, logam mulia (emas/berlian/platinum),
kesehatan seksual (pelumas/kondom/suplemen performa — NIE Kemenkes).

---

## 2. Blibli (KTD STORE — KTS-70007)

Sumber resmi: artikel Seller Care **ART-00170 "Alasan Toko Dinonaktifkan"**
(salinan di `_audit-blibli/art00170.txt`, diambil 7 Okt 2026). Toko pernah
dinonaktifkan karena pelanggaran ini — prioritas kepatuhan TERTINGGI.

### 2.1 Tujuh alasan penonaktifan toko

1. **Mengajak transaksi di luar Blibli** — link eksternal, minta kode
   verifikasi/password, memberikan data pribadi seller ke pembeli.
   (Dari audit kami: shareloc Google Maps + alamat gudang + nomor WA di
   deskripsi = risiko tertinggi. Alamat produsen polos tanpa link masih
   aman.)
2. **Menjual produk yang dilarang** — produk yang dilarang dijual bebas.
   (Dari audit ART-00170: kata kunci "ayam aduan" [judi sabung ayam],
   "antibiotik", "racun", "pestisida", "herbisida", rodentisida memicu
   alasan ini MESKIPUN produk sama laku di Lazada.)
3. **Menjual produk palsu atau bekas** — barang palsu/bekas, harga tidak
   wajar, indikasi palsu. (Kasus kami: indikasi HKI parfum; aksesori
   generik yang menyebut merek orang, mis. "P47 Realme".)
4. **Manipulasi promo & pesanan** — kecurangan voucher/pembelian.
5. **Pembatalan >5 pesanan/hari** → penonaktifan OTOMATIS; perhatikan
   saldo negatif.
6. **Akun mencurigakan** — terkait seller lain yang melanggar.
7. **Dormant** — 14 hari tak aktif (tanda di toko), 30 hari + abaikan
   pesanan (produk hilang), 60 hari (toko nonaktif).

Catatan: tanpa banding 90 hari setelah penonaktifan = akun ditutup permanen.

### 2.2 Praktik kepatuhan hasil audit (16 Okt 2026)

- Katalog aktif Blibli dipangkas 749 → 685 SKU (64 diarsipkan: serum
  klaim vitality, herbal klaim medis, item shareloc/alamat gudang,
  merek pihak ketiga, 13 item ART-00170 merah).
- Moderasi berbasis KATA (bukan makna): "racun", "antibiotik",
  "pestisida", "herbisida", "ayam aduan" langsung merah.
- Nama produk beda motif/variasi bukan pelanggaran — cek kedua sisi
  sebelum menghapus.
- Harga wajar: harga jauh di bawah wajar bisa dianggap palsu/bekas.

---

## 3. Lazada

Sumber resmi: artikel Help Center **"Alokasi Poin Pelanggaran" (NCP)**
knowledgeId 1000149114 (salinan di `tiktok-upload/_lazada-aturan-poin.txt`).

### 3.1 Sistem poin NCP

- Produk **HKI** (palsu/replika/paten/desain/konten) → produk dikunci +
  hingga **6 poin** per produk.
- Produk **Terlarang** (obat-obatan, bahan berbahaya, senjata api &
  amunisi, alat untuk tujuan terlarang, materi dewasa/pornografi, jasa
  melanggar hukum, benda koleksi/artefak/logam mulia, bagian/jasad tubuh
  manusia, flora/fauna) → produk dikunci + **48 poin**.
- Senjata terlarang, barang pemerintah/aparat/militer, tembakau →
  hingga 6 poin. Obat-obatan medis, barang sanksi → hingga 2 poin.
- **Konten & katalog**: duplikasi produk, sengaja salah kategori →
  produk dikunci + hingga 1 poin. Produk salah kategori → dinonaktifkan.
- **Perdagangan adil**: transaksi di luar platform, kecurangan
  pemenuhan → **48 poin per insiden**. Info pribadi untuk transaksi
  off-platform → 48 poin.
- **Pengaturan pesanan**: paket tidak siap (2 poin), keterlambatan
  pengiriman (1 poin), tingkat pembatalan (1 poin + limit pesanan
  harian 50%).
- **Milestone**: 12/24/36/48 poin → pembatasan bertingkat; **48 poin =
  toko dinonaktifkan & dihapus**. Maks 16 poin per 7 hari (kecuali
  pelanggaran 48-poin). Poin hangus setelah 365 hari. Banding ≤60 hari.

### 3.2 Praktik kepatuhan hasil audit (3 Okt 2026)

- 20 produk berisiko dihapus (743 → 723): konten seksual/afrodisiak
  (EROS Serum, 4G JOSS, Pasak Bumi, Wamena Oil, PURWOGRENG, Moist Bust),
  klaim medis (Salep Djie "Obat Sifilis"), link YouTube di deskripsi,
  9 item shareloc + alamat gudang, HKI brand ("P47 Realme").
- Kombinasi **shareloc Maps + alamat lengkap** = risiko off-platform
  tertinggi; alamat produsen tanpa link/telepon = risiko rendah.
- NCP toko saat ini 0 ("Sehat") — jaga jangan sampai kena.

---

## 4. Lapisan aturan UMUM (dipakai semua marketplace)

Gabungan aturan dari ketiga platform di atas yang berlaku untuk SEMUA
channel (lapis 1 rule engine Tahap 5):

| # | Aturan umum | Sumber |
|---|---|---|
| 1 | Produk palsu / replika / nama merek pihak ketiga tanpa izin | TikTok 1.1#12, Blibli #3, Lazada HKI |
| 2 | Klaim medis pada produk non-obat ("menyembuhkan", "obat", "mengobati") | TikTok 1.2 kecantikan, semua platform |
| 3 | Klaim afrodisiak / peningkat performa seksual | TikTok 1.1#5 + 5.1, audit Lazada/Blibli |
| 4 | Produk manajemen berat badan | TikTok 5.15 |
| 5 | Link eksternal / shareloc Maps / nomor WA / ajakan transaksi off-platform di judul-deskripsi | Blibli #1, Lazada 48 poin |
| 6 | Bahan berbahaya: racun, pestisida, herbisida, antibiotik (ternak/medis), rodentisida, bahan mudah terbakar & korosif | TikTok 1.1#2, Blibli #2, Lazada terlarang |
| 7 | Judi & kekerasan hewan (ayam aduan, pisau taji) | Blibli audit, TikTok 5.9 |
| 8 | Obat resep / OTC / alat kesehatan tanpa izin edar | TikTok 5.1-5.2, Lazada terlarang |
| 9 | Senjata & benda berbilah (kecuali peralatan dapur/rumah tangga) | TikTok 1.1#1 |
| 10 | Produk dewasa / seksual | TikTok 1.1#5, Lazada terlarang |
| 11 | Produk kedaluwarsa / tanpa label / dikemas ulang (konsumsi) | TikTok 1.1#11 |
| 12 | Produk bekas, tanaman/hewan hidup, produk virtual, layanan | TikTok 5.4-5.9 |

## 5. Lapisan aturan PER MARKETPLACE (lapis 2)

| Marketplace | Aturan tambahan khas |
|---|---|
| TikTok | Wajib sertifikasi untuk kategori terbatas: BPOM/SPP-IRT/PSAT (makanan-minuman), BPOM (suplemen), BPOM (kecantikan), SNI/Postel (elektronik); obat OTC & manajemen berat badan dilarang mutlak meski ber-BPOM; "kotak misteri" dilarang |
| Blibli | Tidak ada izin khusus per kategori, tapi moderasi kata ketat (racun/antibiotik/pestisida/herbisida/ayam aduan langsung merah); pembatalan >5/hari = mati toko |
| Lazada | Kategori HARUS akurat (salah kategori = 1 poin + produk dinonaktifkan); duplikasi produk = poin; unggah massal wajib ikut kategori sesuai pohon kategori Lazada |

## 6. Pemetaan risiko katalog Aneka saat ini

Berdasarkan sweep 792 produk master (17 Okt 2026), kelompok berisiko
yang harus lolos rule engine sebelum diupload ke channel:

1. **Herbal/suplemen/obat herbal** — wajib BPOM/PIRT; yang berklaim medis
   atau afrodisiak → BLOKIR semua channel (TikTok: tidak didukung).
2. **Vitamin & suplemen kebugaran** — BPOM wajib di TikTok; tanpa nomor
   sertifikat → hanya channel lain.
3. **Pestisida/racun ternak** (Fertani, Essen Strike, dll) — BLOKIR
   Blibli (moderasi kata) & TikTok (bahan berbahaya); Lazada risiko
   terlarang → wajib review manual.
4. **Pembersih/kimia rumah tangga** — cek bahan mudah terbakar/korosif
   (TikTok 5.16).
5. **Nama bermerek pihak ketiga** — wajib strip nama merek dari judul.
6. **Alamat seller/shareloc** — JANGAN pernah masuk deskripsi channel;
   alamat hanya di data internal.

---

## 7. Implementasi rule engine (Tahap 5, 17 Okt 2026)

Modul: `src/lib/aturan-produk.ts` (murni, bisa diimpor client & server).
Halaman: `/marketplace/aneka/aturan` (menu "Cek Aturan"). API: `GET
/api/aneka/aturan?op=semua|uji` (hanya admin). Gerbang upload Tahap 6
memakai `kelayakanKanal()`.

Status per kanal: aman / perhatian / review (wajib tinjau manual) /
blokir (jangan upload sampai nama dibersihkan).

Kode aturan:
- Lapis umum: U-1 palsu/replika · U-1B merek pihak ketiga (daftar ~60
  merek, batas kata) · U-2 klaim medis · U-2B kata "obat" (review) ·
  U-3 afrodisiak/seksual · U-3B produk karantina audit (eros serum,
  4g joss, 4g lucky, pasak bumi, wamena, purwogreng, moist bust, tiga
  jari) · U-3C vitalitas/stamina pria (TikTok blokir, lain review) ·
  U-4 manajemen berat badan · U-5/U-5B/U-5C off-platform (shareloc,
  URL, nomor HP, nama marketplace lain) · U-6 bahan berbahaya (TikTok
  & Blibli blokir, Lazada review) · U-7 judi/ayam aduan (incl. jalu,
  bertarung) · U-8 obat resep/alkes · U-9/U-9B senjata & bilah
  (kecuali konteks dapur) · U-11 kemas ulang/kedaluwarsa · U-12 bekas/
  hidup/virtual.
- Lapis TikTok: T-1 herbal/suplemen/vitamin wajib BPOM/PIRT (kecuali
  nama sudah menyebut bpom/pirt) · T-2 kotak misteri · T-3 logam
  mulia/SIM invite-only.
- Lapis Blibli: tercakup U-6 (kata merah racun/antibiotik/pestisida/
  herbisida/ayam aduan) + U-5.
- Lapis Lazada: U-6 jadi review (risiko terlarang); akurasi kategori
  pohon & duplikasi diverifikasi saat Tahap 6 (bukan dari nama).

Kalibrasi atas 792 produk master (probe substring):
- Jebakan salah-tembak dihindari dengan batas kata: "kobata" memuat
  "obat", "muslim" memuat "slim", "jamur" memuat "jamu", "peluruh"
  memuat "peluru".
- Konteks yang sengaja TIDAK dilarang: "pelumas" (katalog semua gemuk
  mesin), "perangsang bunga/buah" (pupuk), "asahan pisau" (dapur),
  parfum "tahan lama … pria/wanita" (bukan stamina).
- Hasil cek 17 Okt: 792 produk → 29 blokir keseluruhan, 106 wajib
  review (97 herbal/suplemen tanpa BPOM + 9 kata "obat"), 0
  perhatian, 657 aman. Per kanal blokir: TikTok 29, Blibli 26,
  Lazada 16.
- 29 blokir mencakup: 8 produk karantina audit lama (EROS, 4G JOSS,
  4G Lucky, Pasak Bumi, Wamena, PURWOGRENG, Moist Bust, Tiga Jari),
  parfum replika merek (Gucci, ZARA, Jennifer Lopez), P47 Realme,
  Salep Djie "Obat Sifilis", racun/pestisida/herbisida/antibiotik
  (Fertani, Ramtus, Gel Racun, ENROFLOXS, Ecovet, Essen Strike Racun),
  ayam aduan (Super Oxy Fit, Terramycin), pelangsing (Koyo Pelangsing,
  Sari Lemon Diet Detoks, Sekar Slim).
