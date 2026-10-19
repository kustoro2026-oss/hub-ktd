"use client";

// Klien fitur Afiliasi TikTok Shop: tiga tab — Cari Kreator (cari +
// eligibilitas + undang), Riwayat Undangan (jurnal internal + riwayat
// TikTok mingguan + kuota), dan Pengaturan Auto (saklar cron, cap harian,
// filter, produk, komisi, kontak).
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  RefreshCw,
  Search,
  Send,
  Settings2,
  Users,
  XCircle,
} from "lucide-react";

type CreatorRow = {
  creatorOpenId: string;
  username: string;
  nickname: string;
  avatarUrl: string;
  followerCount: number;
  categoryIds: string[];
  avgEcLiveUv: number;
  avgEcVideoViewCount: number;
  gmv: { currency: string; amount: number } | null;
  hasCollaborated: boolean;
  hasInvited90d: boolean;
  isCreatorBlocked: boolean;
  creatorLevel: number;
  ppsScore: string;
  isFastGrowing: boolean;
};

type EligibilityRow = {
  creatorOpenId: string;
  creatorLevel: number;
  isBlocked: boolean;
  isConnected: boolean;
  isFollowerThresholdMet: boolean;
  isLevelQuotaAvailable: boolean;
  isPaired: boolean;
};

type InviteRow = {
  id: number;
  collaboration_id: string;
  creator_open_id: string;
  username: string;
  nickname: string;
  product_ids: string;
  status: string;
  error_code: string;
  detail: string;
  created_at: string;
};

type ProductRow = { id: string; title: string };

type QuotaInfo = {
  quota_sum: number;
  quota_use: number;
  unlimited: boolean;
  gmv_tier: string;
};

const TABS = [
  { key: "cari", label: "Cari Kreator" },
  { key: "riwayat", label: "Riwayat Undangan" },
  { key: "pengaturan", label: "Pengaturan Auto" },
] as const;

function fmtFollower(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} jt`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} rb`;
  return String(n);
}

function wibDariIso(s: string): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  const w = new Date(d.getTime() + 7 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(w.getUTCDate())}/${p(w.getUTCMonth() + 1)}/${w.getUTCFullYear()} ${p(w.getUTCHours())}:${p(w.getUTCMinutes())}`;
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  sent: {
    label: "Terkirim",
    cls: "bg-emerald-100 text-emerald-800",
  },
  conflict: {
    label: "Konflik",
    cls: "bg-amber-100 text-amber-800",
  },
  invalid: {
    label: "Open ID tidak valid",
    cls: "bg-amber-100 text-amber-800",
  },
  failed: {
    label: "Gagal",
    cls: "bg-rose-100 text-rose-800",
  },
};

// ---------- Tab 1: Cari Kreator ----------

function TabCari({ productIds }: { productIds: string[] }) {
  const [keyword, setKeyword] = useState("");
  const [minFollowers, setMinFollowers] = useState("");
  const [maxFollowers, setMaxFollowers] = useState("");
  const [notInvited, setNotInvited] = useState(true);
  const [items, setItems] = useState<CreatorRow[]>([]);
  const [nextPageToken, setNextPageToken] = useState("");
  const [searchKey, setSearchKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [totalLoaded, setTotalLoaded] = useState(0);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [elig, setElig] = useState<Map<string, EligibilityRow>>(new Map());
  const [eligLoading, setEligLoading] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [result, setResult] = useState("");

  const doSearch = useCallback(
    async (pageToken?: string, key?: string, append = false, pages = 10) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/tiktok/affiliate/creators/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            keyword: keyword.trim() || undefined,
            count_ge: minFollowers === "" ? undefined : Number(minFollowers),
            count_le: maxFollowers === "" ? undefined : Number(maxFollowers),
            not_invited_l90_days: notInvited,
            page_token: pageToken,
            search_key: key,
            pages,
          }),
        });
        const data = (await res.json()) as {
          ok: boolean;
          detail?: string;
          items?: CreatorRow[];
          next_page_token?: string;
          search_key?: string;
          pages_scanned?: number;
        };
        if (!data.ok || !data.items) {
          setError(data.detail ?? "Gagal mencari kreator.");
          if (!append) {
            setItems([]);
            setTotalLoaded(0);
          }
          return;
        }
        if (append) {
          setItems((prev) => {
            const seen = new Set(prev.map((c) => c.creatorOpenId));
            const added = data.items!.filter((c) => !seen.has(c.creatorOpenId));
            return [...prev, ...added];
          });
          setTotalLoaded((n) => n + data.items!.length);
        } else {
          setItems(data.items);
          setTotalLoaded(data.items.length);
          setSelected(new Set());
          setElig(new Map());
          setResult("");
        }
        setNextPageToken(data.next_page_token ?? "");
        setSearchKey(data.search_key ?? "");
      } catch {
        setError("Kesalahan jaringan saat mencari kreator.");
      } finally {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    },
    [keyword, minFollowers, maxFollowers, notInvited],
  );

  // Muat halaman berikutnya (10 halaman marketplace = sampai 200 kreator)
  // lalu tambahkan ke daftar yang sudah dimuat.
  function muatLebih() {
    if (!nextPageToken || loading || loadingMore) return;
    doSearch(nextPageToken, searchKey, true, 10);
  }

  // Kreator langsung dimuat otomatis saat tab dibuka — tanpa cari manual.
  useEffect(() => {
    doSearch(undefined, undefined, false, 10);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function toggleAll() {
    setSelected((s) => {
      const allSelected = items.length > 0 && items.every((i) => s.has(i.creatorOpenId));
      const n = new Set<string>();
      if (!allSelected) {
        for (const i of items) n.add(i.creatorOpenId);
      }
      return n;
    });
  }

  async function cekEligibilitas() {
    if (selected.size === 0) return;
    setEligLoading(true);
    setError("");
    setResult("");
    try {
      const ids = [...selected];
      const map = new Map<string, EligibilityRow>();
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        const res = await fetch("/api/tiktok/affiliate/eligibility", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ creator_open_ids: chunk }),
        });
        const data = (await res.json()) as {
          ok: boolean;
          detail?: string;
          results?: EligibilityRow[];
        };
        if (!data.ok || !data.results) {
          setError(data.detail ?? "Gagal cek eligibilitas.");
          return;
        }
        for (const r of data.results) map.set(r.creatorOpenId, r);
      }
      setElig(map);
    } catch {
      setError("Kesalahan jaringan saat cek eligibilitas.");
    } finally {
      setEligLoading(false);
    }
  }

  async function kirimUndangan() {
    if (selected.size === 0) return;
    setInviting(true);
    setError("");
    setResult("");
    try {
      const ids = [...selected];
      let invited = 0;
      const gagal: string[] = [];
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        const res = await fetch("/api/tiktok/affiliate/invite", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            creator_open_ids: chunk,
            product_ids: productIds,
          }),
        });
        const data = (await res.json()) as {
          ok: boolean;
          detail?: string;
          invited?: number;
          batches?: {
            ok: boolean;
            count: number;
            code: number | null;
            hint: string;
            detail: string;
          }[];
        };
        if (!data.ok) {
          setError(data.detail ?? "Gagal mengirim undangan.");
          return;
        }
        invited += data.invited ?? 0;
        for (const b of data.batches ?? []) {
          if (!b.ok) gagal.push(b.hint || b.detail || String(b.code ?? "?"));
        }
      }
      setResult(
        `Undangan terkirim ke ${invited} kreator.${
          gagal.length > 0
            ? ` ${gagal.length} batch gagal: ${[...new Set(gagal)].join("; ")}`
            : ""
        }`,
      );
      setSelected(new Set());
    } catch {
      setError("Kesalahan jaringan saat mengirim undangan.");
    } finally {
      setInviting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="min-w-44 flex-1">
          <label className="block text-xs font-medium text-slate-500">
            Kata kunci (username / nama)
          </label>
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") doSearch();
            }}
            placeholder="mis. skincare"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500">
            Follower minimal
          </label>
          <input
            value={minFollowers}
            onChange={(e) => setMinFollowers(e.target.value)}
            type="number"
            min={0}
            placeholder="0"
            className="mt-1 w-28 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500">
            Follower maksimal
          </label>
          <input
            value={maxFollowers}
            onChange={(e) => setMaxFollowers(e.target.value)}
            type="number"
            min={0}
            placeholder="—"
            className="mt-1 w-28 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
          />
        </div>
        <label className="flex items-center gap-2 pb-1.5 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={notInvited}
            onChange={(e) => setNotInvited(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Belum diundang 90 hari
        </label>
        <button
          onClick={() => doSearch()}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-800 disabled:opacity-60"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
          Cari
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Memuat kreator dari marketplace…
        </div>
      ) : null}

      {productIds.length === 0 && items.length === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Pilih produk yang mau diundangkan dulu di tab{" "}
          <button
            onClick={() => document.dispatchEvent(new CustomEvent("aff-tab", { detail: "pengaturan" }))}
            className="font-semibold underline"
          >
            Pengaturan Auto
          </button>
          .
        </div>
      ) : null}

      {items.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3 text-sm text-slate-600">
              <span className="font-medium">{totalLoaded} kreator dimuat</span>
              <span className="text-emerald-700 font-semibold">
                {selected.size} dipilih
              </span>
              <button
                onClick={cekEligibilitas}
                disabled={selected.size === 0 || eligLoading}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
              >
                {eligLoading ? (
                  <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />
                ) : null}
                Cek Eligibilitas
              </button>
              <button
                onClick={kirimUndangan}
                disabled={selected.size === 0 || productIds.length === 0 || inviting}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-50"
              >
                {inviting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                Undang ({selected.size})
              </button>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <button
                onClick={muatLebih}
                disabled={!nextPageToken || loading || loadingMore}
                className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
              >
                {loadingMore ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
                Muat Lebih (200)
              </button>
            </div>
          </div>

          {result ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              {result}
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2.5 w-8">
                    <input
                      type="checkbox"
                      checked={
                        items.length > 0 &&
                        items.every((i) => selected.has(i.creatorOpenId))
                      }
                      onChange={toggleAll}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                  </th>
                  <th className="px-3 py-2.5">Kreator</th>
                  <th className="px-3 py-2.5 text-right">Follower</th>
                  <th className="px-3 py-2.5 text-right">GMV</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Eligibilitas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((c) => {
                  const el = elig.get(c.creatorOpenId);
                  const elOk =
                    el &&
                    !el.isBlocked &&
                    !el.isConnected &&
                    !el.isPaired &&
                    el.isFollowerThresholdMet &&
                    el.isLevelQuotaAvailable;
                  return (
                    <tr key={c.creatorOpenId} className="align-top">
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={selected.has(c.creatorOpenId)}
                          onChange={() => toggle(c.creatorOpenId)}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-3">
                          {c.avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={c.avatarUrl}
                              alt=""
                              referrerPolicy="no-referrer"
                              className="h-9 w-9 rounded-full border border-slate-200 object-cover"
                            />
                          ) : (
                            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                              <Users className="h-4 w-4" />
                            </div>
                          )}
                          <div>
                            <p className="font-medium text-slate-900">
                              {c.nickname || c.username || "—"}
                            </p>
                            <p className="text-xs text-slate-500">
                              @{c.username} · Level {c.creatorLevel || "?"}
                              {c.ppsScore ? ` · PPS ${c.ppsScore}` : ""}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium text-slate-900">
                        {fmtFollower(c.followerCount)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-slate-600">
                        {c.gmv
                          ? `${c.gmv.currency} ${c.gmv.amount}`
                          : "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {c.isCreatorBlocked ? (
                            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-800">
                              Diblokir
                            </span>
                          ) : null}
                          {c.hasCollaborated ? (
                            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-800">
                              Sudah kolaborasi
                            </span>
                          ) : null}
                          {c.hasInvited90d ? (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                              Diundang 90 hari
                            </span>
                          ) : null}
                          {c.isFastGrowing ? (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                              Tumbuh cepat
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        {el ? (
                          elOk ? (
                            <span className="flex items-center gap-1 text-xs font-medium text-emerald-700">
                              <CheckCircle2 className="h-4 w-4" /> Layak
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-xs font-medium text-rose-700">
                              <XCircle className="h-4 w-4" />
                              {el.isBlocked
                                ? "Diblokir"
                                : el.isConnected
                                  ? "Terhubung"
                                  : el.isPaired
                                    ? "Berpasangan"
                                    : !el.isFollowerThresholdMet
                                      ? "Follower kurang"
                                      : "Kuota level habis"}
                            </span>
                          )
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex justify-center pt-1">
            <button
              onClick={muatLebih}
              disabled={!nextPageToken || loading || loadingMore}
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
            >
              {loadingMore ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
              {nextPageToken
                ? "Muat Lebih Banyak"
                : "Semua halaman yang tersedia sudah dimuat"}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ---------- Tab 2: Riwayat Undangan ----------

function TabRiwayat() {
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [records, setRecords] = useState<{
    total: number;
    items: { id: string; creatorOpenId: string; hasSentInvitation: boolean; isPaired: boolean }[];
  } | null>(null);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [resInv, resRec, resQ] = await Promise.all([
        fetch("/api/tiktok/affiliate/invites?limit=100"),
        fetch("/api/tiktok/affiliate/records?page_index=1&page_size=50"),
        fetch("/api/tiktok/affiliate/quota"),
      ]);
      const inv = (await resInv.json()) as {
        ok: boolean;
        detail?: string;
        items?: InviteRow[];
      };
      if (!inv.ok || !inv.items) {
        setError(inv.detail ?? "Gagal membaca jurnal undangan.");
      } else {
        setInvites(inv.items);
      }
      const rec = (await resRec.json()) as {
        ok: boolean;
        total?: number;
        items?: { id: string; creatorOpenId: string; hasSentInvitation: boolean; isPaired: boolean }[];
      };
      if (rec.ok) {
        setRecords({
          total: rec.total ?? 0,
          items: (rec.items ?? []).map((r) => ({
            id: r.id,
            creatorOpenId: r.creatorOpenId,
            hasSentInvitation: r.hasSentInvitation,
            isPaired: r.isPaired,
          })),
        });
      }
      const q = (await resQ.json()) as {
        ok: boolean;
        quota?: {
          quota_sum: number;
          quota_use: number;
          unlimited: boolean;
          gmv_tier: string;
        };
      };
      if (q.ok && q.quota) {
        setQuota({
          quota_sum: q.quota.quota_sum,
          quota_use: q.quota.quota_use,
          unlimited: q.quota.unlimited,
          gmv_tier: q.quota.gmv_tier,
        });
      }
    } catch {
      setError("Kesalahan jaringan saat memuat riwayat.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {quota ? (
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
              Kuota undang:{" "}
              {quota.unlimited
                ? "Tak terbatas"
                : `${quota.quota_sum - quota.quota_use} tersisa`}
            </span>
          ) : null}
          {records ? (
            <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-800">
              Terhubung minggu ini: {records.total}
            </span>
          ) : null}
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Muat ulang
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      {invites.length === 0 && !loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          Belum ada undangan dari KTD Hub. Cari kreator di tab Cari Kreator
          lalu kirim undangan pertamamu.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2.5">Waktu (WIB)</th>
                <th className="px-3 py-2.5">Kreator</th>
                <th className="px-3 py-2.5">Kolaborasi</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Keterangan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invites.map((r) => {
                const st = STATUS_LABEL[r.status] ?? {
                  label: r.status,
                  cls: "bg-slate-100 text-slate-700",
                };
                return (
                  <tr key={r.id} className="align-top">
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">
                      {wibDariIso(r.created_at)}
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-slate-900">
                        {r.nickname || r.username || "—"}
                      </p>
                      {r.username ? (
                        <p className="text-xs text-slate-500">@{r.username}</p>
                      ) : null}
                    </td>
                    <td className="max-w-44 truncate px-3 py-2.5 text-xs text-slate-500">
                      {r.collaboration_id || "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${st.cls}`}
                      >
                        {st.label}
                      </span>
                    </td>
                    <td className="max-w-72 px-3 py-2.5 text-xs text-slate-500">
                      {r.error_code ? `[${r.error_code}] ` : ""}
                      {r.detail}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------- Tab 3: Pengaturan Auto ----------

function TabPengaturan({
  settings,
  onSaved,
}: {
  settings: Record<string, string>;
  onSaved: (s: Record<string, string>) => void;
}) {
  const [autoEnabled, setAutoEnabled] = useState(settings.auto_enabled === "1");
  const [dailyCap, setDailyCap] = useState(settings.daily_cap ?? "500");
  const [minFollowers, setMinFollowers] = useState(
    settings.min_followers ?? "1000",
  );
  const [maxFollowers, setMaxFollowers] = useState(
    settings.max_followers ?? "",
  );
  const [commission, setCommission] = useState(
    settings.commission_percent ?? "15",
  );
  const [contactEmail, setContactEmail] = useState(settings.contact_email ?? "");
  const [contactWhatsapp, setContactWhatsapp] = useState(
    settings.contact_whatsapp ?? "",
  );
  const [contactPhone, setContactPhone] = useState(settings.contact_phone ?? "");
  const [contactTelegram, setContactTelegram] = useState(
    settings.contact_telegram ?? "",
  );
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [productQ, setProductQ] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [prodLoading, setProdLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const parsed = JSON.parse(settings.product_ids ?? "[]") as unknown;
      if (Array.isArray(parsed)) {
        setChosen(new Set(parsed.map(String)));
      }
    } catch {
      setChosen(new Set());
    }
  }, [settings.product_ids]);

  const loadProducts = useCallback(async (q?: string) => {
    setProdLoading(true);
    try {
      const res = await fetch(
        q
          ? `/api/tiktok/products?state=ACTIVATE&q=${encodeURIComponent(q)}`
          : "/api/tiktok/products?state=ACTIVATE",
      );
      const data = (await res.json()) as {
        ok: boolean;
        detail?: string;
        items?: { id: string; title: string }[];
      };
      if (!data.ok || !data.items) {
        setError(data.detail ?? "Gagal memuat daftar produk.");
        return;
      }
      setProducts(data.items);
    } catch {
      setError("Kesalahan jaringan saat memuat produk.");
    } finally {
      setProdLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  function toggleProduct(id: string) {
    setChosen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function simpan() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/tiktok/affiliate/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          settings: {
            auto_enabled: autoEnabled ? "1" : "0",
            daily_cap: dailyCap,
            min_followers: minFollowers,
            max_followers: maxFollowers,
            commission_percent: commission,
            contact_email: contactEmail,
            contact_phone: contactPhone,
            contact_whatsapp: contactWhatsapp,
            contact_telegram: contactTelegram,
            product_ids: JSON.stringify([...chosen]),
          },
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        detail?: string;
        settings?: Record<string, string>;
      };
      if (!data.ok) {
        setError(data.detail ?? "Gagal menyimpan pengaturan.");
        return;
      }
      if (data.settings) onSaved(data.settings);
      setMessage("Pengaturan tersimpan.");
    } catch {
      setError("Kesalahan jaringan saat menyimpan.");
    } finally {
      setSaving(false);
    }
  }

  async function jalankanSekarang() {
    setRunning(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/tiktok/affiliate/auto", { method: "POST" });
      const data = (await res.json()) as {
        ok: boolean;
        detail?: string;
        skipped?: string;
        invited?: number;
        candidates_checked?: number;
        eligible?: number;
        sent_today?: number;
        daily_cap?: number;
        batches_failed?: number;
      };
      if (!data.ok) {
        setError(data.detail ?? "Gagal menjalankan pengundang otomatis.");
        return;
      }
      if (data.skipped) {
        setMessage(
          data.skipped === "cap"
            ? `Dilewati: cap harian tercapai (${data.sent_today}/${data.daily_cap} undangan hari ini).`
            : data.skipped === "disabled"
              ? "Dilewati: pengundang otomatis masih mati."
              : "Dilewati: tidak ada kandidat baru.",
        );
        return;
      }
      setMessage(
        `Selesai: ${data.invited ?? 0} undangan terkirim dari ${
          data.candidates_checked ?? 0
        } kandidat diperiksa (${data.eligible ?? 0} layak). Hari ini: ${
          data.sent_today ?? 0
        }/${data.daily_cap ?? 0}.`,
      );
    } catch {
      setError("Kesalahan jaringan saat menjalankan auto.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Settings2 className="h-4 w-4 text-slate-400" />
              Pengundang Otomatis (Cron)
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Berjalan 5× sehari (08:30, 11:30, 14:30, 17:30, 20:30 WIB).
              Setiap run cari kreator baru, cek eligibilitas, lalu undang
              sampai cap harian tercapai. Kreator yang sudah diundang
              (jurnal internal) tidak akan diundang ulang.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={autoEnabled}
              onChange={(e) => setAutoEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Aktif
          </label>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="block text-xs font-medium text-slate-500">
              Cap undangan per hari
            </label>
            <input
              value={dailyCap}
              onChange={(e) => setDailyCap(e.target.value)}
              type="number"
              min={1}
              max={1000}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500">
              Follower minimal kandidat
            </label>
            <input
              value={minFollowers}
              onChange={(e) => setMinFollowers(e.target.value)}
              type="number"
              min={0}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500">
              Follower maksimal (kosong = tanpa batas)
            </label>
            <input
              value={maxFollowers}
              onChange={(e) => setMaxFollowers(e.target.value)}
              type="number"
              min={0}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500">
              Komisi default (%)
            </label>
            <input
              value={commission}
              onChange={(e) => setCommission(e.target.value)}
              type="number"
              min={0.01}
              max={50}
              step="0.01"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
            />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="block text-xs font-medium text-slate-500">
              Email penjual
            </label>
            <input
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500">
              WhatsApp penjual
            </label>
            <input
              value={contactWhatsapp}
              onChange={(e) => setContactWhatsapp(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500">
              Telepon penjual
            </label>
            <input
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500">
              Telegram penjual
            </label>
            <input
              value={contactTelegram}
              onChange={(e) => setContactTelegram(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
            />
          </div>
        </div>

        <div className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="block text-xs font-medium text-slate-500">
              Produk yang diundangkan ({chosen.size} dipilih, maks 100)
            </label>
            <div className="flex items-center gap-2">
              <input
                value={productQ}
                onChange={(e) => setProductQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") loadProducts(productQ.trim());
                }}
                placeholder="Cari produk…"
                className="w-48 rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700"
              />
              <button
                onClick={() => loadProducts(productQ.trim())}
                disabled={prodLoading}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
              >
                {prodLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Search className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>
          <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-slate-200">
            {products.length === 0 ? (
              <p className="p-4 text-center text-xs text-slate-400">
                {prodLoading ? "Memuat produk…" : "Tidak ada produk."}
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {products.map((p) => (
                  <li key={p.id}>
                    <label className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={chosen.has(p.id)}
                        onChange={() => toggleProduct(p.id)}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      <span className="truncate">{p.title}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            onClick={simpan}
            disabled={saving}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-800 disabled:opacity-60"
          >
            {saving ? "Menyimpan…" : "Simpan Pengaturan"}
          </button>
          <button
            onClick={jalankanSekarang}
            disabled={running || chosen.size === 0}
            className="flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            {running ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Jalankan Sekarang (1 run)
          </button>
        </div>

        {message ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            {message}
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------- Klien utama ----------

export default function TiktokAfiliasiClient() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("cari");
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [settingsError, setSettingsError] = useState("");

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/tiktok/affiliate/settings");
      const data = (await res.json()) as {
        ok: boolean;
        settings?: Record<string, string>;
      };
      if (data.ok && data.settings) setSettings(data.settings);
    } catch {
      setSettingsError("Gagal memuat pengaturan.");
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    const onTab = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail === "pengaturan") setTab("pengaturan");
    };
    document.addEventListener("aff-tab", onTab);
    return () => document.removeEventListener("aff-tab", onTab);
  }, []);

  const productIds = useMemo(() => {
    try {
      const parsed = JSON.parse(settings.product_ids ?? "[]") as unknown;
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      /* abaikan */
    }
    return [];
  }, [settings.product_ids]);

  return (
    <div className="space-y-4">
      {settingsError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          {settingsError}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              tab === t.key
                ? "bg-emerald-700 text-white"
                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "cari" ? <TabCari productIds={productIds} /> : null}
      {tab === "riwayat" ? <TabRiwayat /> : null}
      {tab === "pengaturan" ? (
        <TabPengaturan settings={settings} onSaved={setSettings} />
      ) : null}
    </div>
  );
}
