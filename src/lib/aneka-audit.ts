// Audit kesiapan eksekusi Aneka — pemeriksaan teliti SEBELUM pemilik toko
// menekan Setuju, supaya kegagalan eksekusi tidak terulang. Latar belakang
// peristiwa 27-28 Okt 2026: Lazada gagal karena varian produk Aneka tidak
// bisa dicocokkan dengan pasti (dua varian bernama sama), TikTok gagal
// karena label resmi belum bisa dicetak (pengiriman belum diatur) —
// keduanya baru ketahuan SAAT eksekusi berjalan. Audit dijalankan otomatis
// saat persiapan antrean dan bisa diulang manual lewat tombol "Periksa
// Kesiapan" di halaman Eksekusi; hasilnya disimpan di payload.audit baris
// eksekusi dan ditampilkan sebagai chip Varian/Label/Saldo. Tombol Setuju
// dinonaktifkan selama masih ada blocker (audit.ok = false).
//
// Pustaka ini TIDAK mengimpor keuangan.ts ataupun aneka-exec.ts — keduanya
// justru akan mengimpor pustaka ini (keuangan.ts mengimpor aneka-exec.ts,
// jadi siklus import harus dihindari). Kunci cache saldo disalin dari
// keuangan.ts; sumber kebenaran tetap tabel aneka_finance_cache.
import {
  anekaLogin,
  anekaResolveVariant,
} from "@/lib/aneka-checkout";
import { getAnekaFinanceCache } from "@/lib/db";

// ---------- tipe ----------

export type AuditBlocker = {
  kode: "varian" | "label" | "saldo";
  teks: string;
};

/** Hasil audit tersimpan di payload.audit (JSON) baris eksekusi. */
export type ExecAudit = {
  /** Epoch ms kapan audit terakhir dijalankan. */
  at: number;
  ok: boolean;
  blockers: AuditBlocker[];
  /** Saldo Aneka saat audit (Rp) — bahan chip saldo di UI. */
  saldo?: number;
};

/** Bahan pemeriksaan varian untuk satu baris produk pesanan. */
export type AuditItem = {
  aneka_product_id: string;
  /** Petunjuk nama varian dari pesanan (sku_name TikTok / variant_name
   *  Lazada) — dipakai mencocokkan varian produk Aneka. */
  variant_hint: string;
  /** Nama tampilan produk (untuk pesan blocker). */
  nama: string;
  /** variant_id yang SUDAH tersimpan (pemetaan manual / audit sebelumnya) —
   *  item seperti ini dilewati (dianggap sudah cocok). */
  aneka_variant_id?: string;
};

/** Hasil pemeriksaan varian per item — variantId terpilih bisa langsung
 *  disimpan pemanggil ke payload supaya eksekusi melewati pencarian ulang
 *  (aneka-exec.ts melewati item yang aneka_variant_id-nya sudah terisi). */
export type HasilVarian = {
  blocker?: AuditBlocker;
  variantId?: string;
  label?: string;
};

// ---------- konstanta ----------

/** Kunci cache saldo — sama dengan CACHE_KEY di keuangan.ts. */
const SALDO_CACHE_KEY = "aneka-keuangan-v1";
/** Cache saldo yang lebih tua dari ini dianggap basi: TIDAK dipakai untuk
 *  blocker (data lama tidak boleh menghalangi Setuju), tetapi saldo SEGAR
 *  yang kurang dari kebutuhan WAJIB menghalangi. */
const SALDO_SEGAR_MS = 15 * 60 * 1000;
/** Ongkos pengemasan Aneka per resi (di luar modal — sama dengan
 *  ONGKOS_PACKING di keuangan.ts). */
export const ONGKOS_PACKING_AUDIT = 3000;

// ---------- pemeriksaan varian ----------

/** Login Aneka + cocokkan varian tiap item TANPA efek samping (hasil
 *  dikembalikan untuk disimpan pemanggil). Item yang sudah punya
 *  aneka_variant_id dilewati. Login gagal = satu blocker varian untuk
 *  SEMUA item (varian tidak bisa diaudit tanpa sesi Aneka). */
export async function auditVarianAneka(
  items: AuditItem[],
): Promise<{ blockers: AuditBlocker[]; hasil: HasilVarian[] }> {
  const hasil: HasilVarian[] = [];
  const login = await anekaLogin();
  if (!login.ok) {
    return {
      blockers: [
        {
          kode: "varian",
          teks: `Tidak bisa masuk Aneka (${login.detail}) — varian tidak dapat diaudit`,
        },
      ],
      hasil,
    };
  }
  const blockers: AuditBlocker[] = [];
  for (const it of items) {
    if (it.aneka_variant_id) {
      hasil.push({});
      continue;
    }
    const v = await anekaResolveVariant(
      login.session,
      it.aneka_product_id,
      it.variant_hint || it.nama,
    );
    if (!v.ok) {
      const blocker: AuditBlocker = {
        kode: "varian",
        teks: `Item "${it.nama}": ${v.detail}`,
      };
      blockers.push(blocker);
      hasil.push({ blocker });
    } else {
      hasil.push({ variantId: v.variantId, label: v.label });
    }
  }
  return { blockers, hasil };
}

// ---------- pemeriksaan saldo ----------

/** Baca saldo Aneka dari cache keuangan. Cache basi/belum ada = "tidak
 *  diketahui" (bukan blocker) — saldo hanya jadi blocker bila data SEGAR
 *  menunjukkan kurang dari kebutuhan. */
export async function ambilSaldoAuditAneka(): Promise<{
  saldo: number;
  segar: boolean;
  detail: string;
}> {
  try {
    const row = await getAnekaFinanceCache(SALDO_CACHE_KEY);
    if (!row) {
      return { saldo: 0, segar: false, detail: "belum pernah di-scrape" };
    }
    const data = JSON.parse(row.data) as { saldo?: number };
    const saldo = typeof data.saldo === "number" ? data.saldo : 0;
    const fetchedAt = Date.parse(row.fetched_at);
    const usia = Date.now() - fetchedAt;
    const segar = Number.isFinite(usia) && usia >= 0 && usia < SALDO_SEGAR_MS;
    return {
      saldo,
      segar,
      detail: segar
        ? "segar"
        : Number.isFinite(usia)
          ? `cache basi (${Math.max(1, Math.round(usia / 60000))} menit lalu)`
          : "stempel cache tidak terbaca",
    };
  } catch {
    return { saldo: 0, segar: false, detail: "gagal membaca cache saldo" };
  }
}

/** Blocker saldo — hanya bila cache segar dan saldo kurang dari kebutuhan
 *  (modal + ongkos pengemasan). */
export function blockerSaldo(opts: {
  saldo: number;
  segar: boolean;
  kebutuhan: number;
}): AuditBlocker[] {
  if (!opts.segar || opts.saldo >= opts.kebutuhan) return [];
  return [
    {
      kode: "saldo",
      teks: `Saldo Aneka Rp${opts.saldo.toLocaleString("id-ID")} kurang dari kebutuhan Rp${opts.kebutuhan.toLocaleString("id-ID")} (modal + ongkos pengemasan) — top-up dulu sebelum Setuju`,
    },
  ];
}

/** Gabungkan blocker jadi hasil audit final. */
export function susunAudit(opts: {
  blockers: AuditBlocker[];
  saldo?: number;
}): ExecAudit {
  return {
    at: Date.now(),
    ok: opts.blockers.length === 0,
    blockers: opts.blockers,
    saldo: opts.saldo,
  };
}
