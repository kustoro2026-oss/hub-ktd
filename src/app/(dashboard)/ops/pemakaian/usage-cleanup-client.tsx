"use client";

// Panel pemakaian database & pembersihan data lama.
// Menampilkan ukuran per tabel (sorted desc), estimasi baris yang bisa
// di-cleanup per kategori, dan tombol eksekusi cleanup.
import { useCallback, useEffect, useState } from "react";
import {
  Database,
  Trash2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  HardDrive,
  Table2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

type TableStat = {
  table: string;
  rows: number;
  size_bytes: number;
  size_human: string;
};

type UsageData = {
  ok: boolean;
  tables: TableStat[];
  total_bytes: number;
  total_human: string;
  mode: string;
  checked_at: string;
  error?: string;
};

type Estimate = {
  category: string;
  estimated: number;
  detail: string;
};

type CleanupResult = {
  category: string;
  deleted: number;
  detail?: string;
};

const CATEGORY_LABELS: Record<string, string> = {
  messages: "Pesan WhatsApp",
  email_events: "Event Email",
  order_seen: "Tracker Pesanan",
  order_exec: "Log Eksekusi Pesanan",
  topup_orders: "Pesanan Top-up",
  broadcast_items: "Item Broadcast",
  affiliate: "Data Afiliasi",
  stok_penyesuaian: "Penyesuaian Stok",
  caches: "Cache (harga/finance)",
};

const CATEGORY_RETENTION: Record<string, string> = {
  messages: "> 90 hari",
  email_events: "> 30 hari",
  order_seen: "> 60 hari",
  order_exec: "selesai/gagal > 90 hari",
  topup_orders: "paid/expired > 90 hari",
  broadcast_items: "sent/failed > 60 hari",
  affiliate: "invite selesai > 90 hari, cache > 30 hari",
  stok_penyesuaian: "semua done > 90 hari",
  caches: "semua (auto sync ulang)",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function timeWib(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function UsageCleanupClient() {
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [estLoading, setEstLoading] = useState(false);

  const [cleaning, setCleaning] = useState<string | null>(null);
  const [cleanResult, setCleanResult] = useState<CleanupResult[] | null>(null);
  const [cleanError, setCleanError] = useState<string | null>(null);

  const [sortField, setSortField] = useState<"size" | "rows" | "name">("size");
  const [sortAsc, setSortAsc] = useState(false);

  const fetchUsage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ops/usage");
      const data = (await res.json()) as UsageData;
      if (data.ok) setUsage(data);
      else setError(data.error ?? "Gagal memuat data");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal terhubung");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchEstimates = useCallback(async () => {
    setEstLoading(true);
    try {
      const res = await fetch("/api/ops/cleanup");
      const data = (await res.json()) as {
        ok: boolean;
        estimates?: Estimate[];
      };
      if (data.ok && data.estimates) setEstimates(data.estimates);
    } catch {
      // silently fail — estimates optional
    } finally {
      setEstLoading(false);
    }
  }, []);

  const runCleanup = useCallback(
    async (categories: string[]) => {
      const label = categories.includes("semua") ? "Semua" : categories.join(", ");
      if (
        !confirm(
          `Yakin ingin membersihkan: ${label}?\n\nData yang dihapus tidak bisa dikembalikan.`,
        )
      )
        return;

      setCleaning(label);
      setCleanResult(null);
      setCleanError(null);
      try {
        const res = await fetch("/api/ops/cleanup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ categories }),
        });
        const data = (await res.json()) as {
          ok: boolean;
          results?: CleanupResult[];
          error?: string;
        };
        if (data.ok && data.results) {
          setCleanResult(data.results);
          // Refresh usage & estimates after cleanup.
          await fetchUsage();
          await fetchEstimates();
        } else {
          setCleanError(data.error ?? "Cleanup gagal");
        }
      } catch (e) {
        setCleanError(
          e instanceof Error ? e.message : "Gagal menjalankan cleanup",
        );
      } finally {
        setCleaning(null);
      }
    },
    [fetchUsage, fetchEstimates],
  );

  useEffect(() => {
    fetchUsage();
    fetchEstimates();
  }, [fetchUsage, fetchEstimates]);

  // Sort tables.
  const sortedTables = usage
    ? [...usage.tables].sort((a, b) => {
        const mul = sortAsc ? 1 : -1;
        if (sortField === "size") return mul * (a.size_bytes - b.size_bytes);
        if (sortField === "rows") return mul * (a.rows - b.rows);
        return mul * a.table.localeCompare(b.table);
      })
    : [];

  const toggleSort = (field: "size" | "rows" | "name") => {
    if (sortField === field) setSortAsc(!sortAsc);
    else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const SortIcon = ({ field }: { field: "size" | "rows" | "name" }) =>
    sortField === field ? (
      sortAsc ? (
        <ChevronUp className="inline h-3 w-3" />
      ) : (
        <ChevronDown className="inline h-3 w-3" />
      )
    ) : null;

  return (
    <div className="space-y-6">
      {/* ===== Ringkasan ===== */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <HardDrive className="h-3.5 w-3.5" />
            Total Ukuran DB
          </div>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {loading ? "..." : usage?.total_human ?? "—"}
          </p>
          <p className="mt-0.5 text-xs text-slate-400">
            {usage?.mode === "pg" ? "Supabase Postgres" : "SQLite lokal"}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Table2 className="h-3.5 w-3.5" />
            Jumlah Tabel
          </div>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {loading ? "..." : usage?.tables.length ?? 0}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <RefreshCw className="h-3.5 w-3.5" />
            Terakhir Dicek
          </div>
          <p className="mt-1 text-sm font-medium text-slate-900">
            {usage?.checked_at ? timeWib(usage.checked_at) + " WIB" : "—"}
          </p>
          <button
            onClick={fetchUsage}
            disabled={loading}
            className="mt-1 text-xs text-emerald-600 hover:underline disabled:opacity-50"
          >
            {loading ? "Memuat..." : "Segarkan"}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* ===== Tabel usage ===== */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Database className="h-4 w-4 text-slate-500" />
            Pemakaian per Tabel
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-xs font-medium text-slate-500">
              <tr>
                <th className="px-4 py-2">
                  <button
                    onClick={() => toggleSort("name")}
                    className="hover:text-slate-700"
                  >
                    Nama Tabel <SortIcon field="name" />
                  </button>
                </th>
                <th className="px-4 py-2 text-right">
                  <button
                    onClick={() => toggleSort("rows")}
                    className="hover:text-slate-700"
                  >
                    Baris <SortIcon field="rows" />
                  </button>
                </th>
                <th className="px-4 py-2 text-right">
                  <button
                    onClick={() => toggleSort("size")}
                    className="hover:text-slate-700"
                  >
                    Ukuran <SortIcon field="size" />
                  </button>
                </th>
                <th className="px-4 py-2 text-right">% dari Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    Memuat data...
                  </td>
                </tr>
              )}
              {!loading &&
                sortedTables.map((t) => {
                  const pct =
                    usage && usage.total_bytes > 0
                      ? ((t.size_bytes / usage.total_bytes) * 100).toFixed(1)
                      : "0";
                  return (
                    <tr key={t.table} className="hover:bg-slate-50">
                      <td className="px-4 py-2 font-mono text-xs text-slate-700">
                        {t.table}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {t.rows.toLocaleString("id-ID")}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {t.size_human}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-500">
                        {pct}%
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ===== Cleanup ===== */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Trash2 className="h-4 w-4 text-red-500" />
            Pembersihan Data Lama
          </h2>
          <button
            onClick={() => fetchEstimates()}
            disabled={estLoading}
            className="text-xs text-emerald-600 hover:underline disabled:opacity-50"
          >
            {estLoading ? "Menghitung..." : "Hitung ulang estimasi"}
          </button>
        </div>

        <div className="p-4">
          <p className="mb-3 text-xs text-slate-500">
            Hapus data yang sudah tidak dibutuhkan untuk mengurangi ukuran
            database. Data yang dihapus <strong>tidak bisa dikembalikan</strong>.
          </p>

          {cleanResult && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">Cleanup berhasil!</p>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {cleanResult.map((r) => (
                    <li key={r.category}>
                      <strong>{CATEGORY_LABELS[r.category] ?? r.category}</strong>
                      : {r.deleted.toLocaleString("id-ID")} baris dihapus
                      {r.detail ? ` (${r.detail})` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {cleanError && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {cleanError}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-100 text-xs font-medium text-slate-500">
                <tr>
                  <th className="px-3 py-2">Kategori</th>
                  <th className="px-3 py-2 text-right">Estimasi Baris</th>
                  <th className="px-3 py-2">Kriteria</th>
                  <th className="px-3 py-2 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {(estLoading ? [] : estimates.length > 0 ? estimates : Object.keys(CATEGORY_LABELS).map((c) => ({ category: c, estimated: -1, detail: "" }))).map(
                  (e) => (
                    <tr key={e.category} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-medium text-slate-700">
                        {CATEGORY_LABELS[e.category] ?? e.category}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {e.estimated < 0
                          ? "—"
                          : e.estimated.toLocaleString("id-ID")}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {CATEGORY_RETENTION[e.category] ?? e.detail}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => runCleanup([e.category])}
                          disabled={cleaning !== null}
                          className="rounded-md bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
                        >
                          {cleaning === e.category ? (
                            <Loader2 className="inline h-3 w-3 animate-spin" />
                          ) : (
                            "Bersihkan"
                          )}
                        </button>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
            <p className="text-xs text-slate-400">
              Tip: jalankan &quot;Semua&quot; untuk pembersihan menyeluruh.
            </p>
            <button
              onClick={() => runCleanup(["semua"])}
              disabled={cleaning !== null}
              className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {cleaning === "Semua" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Bersihkan Semua
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
