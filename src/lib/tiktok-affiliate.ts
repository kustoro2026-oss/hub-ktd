// Klien API afiliasi TikTok Shop (Open API, pasar Indonesia) untuk KTD Hub.
// Endpoint diverifikasi dari dokumen resmi Partner Center (docv2):
//  - POST /affiliate_seller/202608/marketplace_creators/search → cari kreator
//    Creator Marketplace, scope Read Creator Marketplace
//    (seller.creator_marketplace.read).
//  - POST /affiliate_seller/202610/creator_outreach/eligibility/check → cek
//    eligibilitas outreach kreator (dokumen tidak mencantumkan scope tambahan).
//  - POST /affiliate_seller/202508/target_collaborations → buat undangan
//    target collaboration, scope seller.affiliate_collaboration.write.
//  - POST /affiliate_seller/202608/creator_outreach/records/query → riwayat
//    outreach mingguan, scope seller.affiliate_collaboration.read/write.
// Semua endpoint POST menandatangani body mentah lewat signRequest; query
// wajib berisi app_key, shop_cipher, dan timestamp.

import { API_HOST, signRequest, tiktokEnv } from "@/lib/tiktok";
import { prepareShop } from "@/lib/tiktok-orders";
import {
  listTiktokShopTokens,
  markAffiliateCreatorStatus,
  saveAffiliateInvite,
} from "@/lib/db";

/** Konteks toko siap pakai: cipher + access token valid. */
export type AffiliateShopCtx = { cipher: string; access_token: string };

/** Tidur singkat tanpa memblokir event loop (dipakai jeda antarpage supaya
 *  tidak menabrak rate-limit app-group TikTok 36009002). */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function str(v: unknown): string {
  return String(v ?? "");
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function bool(v: unknown): boolean {
  return v === true || v === "true" || v === "1";
}

// ---------- Persiapan konteks ----------

/** Siapkan konteks toko pertama yang terotorisasi (refresh token bila
 *  kedaluwarsa, isi shop_cipher bila kosong). Dipakai semua route afiliasi. */
export async function prepareAffiliateShop(): Promise<
  | {
      ok: true;
      ctx: AffiliateShopCtx;
      shop: { shop_id: string; shop_name: string };
    }
  | { ok: false; detail: string }
> {
  const shops = await listTiktokShopTokens();
  if (shops.length === 0) {
    return {
      ok: false,
      detail: "Belum ada toko TikTok Shop yang terotorisasi.",
    };
  }
  const shop = shops[0];
  const prep = await prepareShop(shop);
  if (!prep.ok) {
    return { ok: false, detail: prep.detail };
  }
  return {
    ok: true,
    ctx: { cipher: prep.cipher, access_token: prep.access_token },
    shop: { shop_id: shop.shop_id, shop_name: shop.shop_name },
  };
}

// ---------- Pemanggil umum ----------

type AffiliateApiResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; detail: string; code: number | null };

/** Panggil endpoint afiliasi POST dengan signature (body ikut ditandatangani). */
async function affiliatePost(
  path: string,
  ctx: AffiliateShopCtx,
  body: Record<string, unknown>,
  extraParams: Record<string, string> = {},
): Promise<AffiliateApiResult> {
  const { appKey, appSecret, ready } = tiktokEnv();
  if (!ready) {
    return {
      ok: false,
      code: null,
      detail:
        "Kredensial aplikasi belum diatur (env TIKTOK_APP_KEY dan TIKTOK_APP_SECRET).",
    };
  }
  if (ctx.cipher === "") {
    return {
      ok: false,
      code: null,
      detail: "shop_cipher belum tersimpan — coba otorisasi ulang aplikasi.",
    };
  }
  const rawBody = JSON.stringify(body);
  const params: Record<string, string> = {
    app_key: appKey,
    shop_cipher: ctx.cipher,
    timestamp: Math.floor(Date.now() / 1000).toString(),
    ...extraParams,
  };
  const sign = signRequest(appSecret, path, params, rawBody);
  const qs = new URLSearchParams({ ...params, sign });
  try {
    const res = await fetch(`${API_HOST}${path}?${qs.toString()}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tts-access-token": ctx.access_token,
      },
      body: rawBody,
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as {
      code?: number;
      message?: string;
      data?: Record<string, unknown>;
    };
    if (!res.ok || (data.code ?? 1) !== 0 || !data.data) {
      const code = typeof data.code === "number" ? data.code : null;
      return {
        ok: false,
        code,
        detail: `Gagal memanggil ${path}: ${String(
          data.message ?? res.status,
        )}${code !== null ? ` (kode ${code})` : ""}`,
      };
    }
    return { ok: true, data: data.data };
  } catch (e) {
    return {
      ok: false,
      code: null,
      detail: `Gagal menghubungi server TikTok: ${
        e instanceof Error ? e.message : "kesalahan tidak dikenal"
      }`,
    };
  }
}

// ---------- Pencarian kreator Creator Marketplace ----------

export type AffiliateCreatorRow = {
  creatorOpenId: string;
  username: string;
  nickname: string;
  avatarUrl: string;
  followerCount: number;
  categoryIds: string[];
  avgEcLiveUv: number;
  avgEcVideoViewCount: number;
  gmv: { currency: string; amount: number } | null;
  liveGmv: { currency: string; amount: number } | null;
  videoGmv: { currency: string; amount: number } | null;
  hasCollaborated: boolean;
  hasInvited90d: boolean;
  isCreatorBlocked: boolean;
  creatorLevel: number;
  ppsScore: string;
  isFastGrowing: boolean;
  isOfficialRecommend: boolean;
};

export type AffiliateSearchFilter = {
  keyword?: string;
  /** Batas bawah jumlah follower (count_ge). */
  countGe?: number;
  /** Batas atas jumlah follower (count_le). */
  countLe?: number;
  /** Hanya kreator yang belum diundang 90 hari terakhir. */
  notInvitedL90Days?: boolean;
  /** ID kategori utama kreator (dari Get Categories). */
  categoryParentId?: string;
  categoryChildIds?: string[];
  /** Sorter algorithm id (default "1"). */
  sorterAlgorithmId?: string;
};

export type AffiliateSearchResult =
  | {
      ok: true;
      items: AffiliateCreatorRow[];
      nextPageToken: string;
      searchKey: string;
    }
  | { ok: false; detail: string; code?: number | null };

function parseCreatorRow(r: Record<string, unknown>): AffiliateCreatorRow {
  const avatar = (r.avatar ?? {}) as Record<string, unknown>;
  const gmv = (r.gmv ?? null) as Record<string, unknown> | null;
  const liveGmv = (r.live_gmv ?? null) as Record<string, unknown> | null;
  const videoGmv = (r.video_gmv ?? null) as Record<string, unknown> | null;
  const profile = (r.creator_profile ?? {}) as Record<string, unknown>;
  return {
    creatorOpenId: str(r.creator_open_id),
    username: str(r.username),
    nickname: str(r.nickname),
    avatarUrl: str(avatar.url),
    followerCount: num(r.follower_count),
    categoryIds: ((r.category_ids ?? []) as unknown[]).map(str),
    avgEcLiveUv: num(r.avg_ec_live_uv),
    avgEcVideoViewCount: num(r.avg_ec_video_view_count),
    gmv: gmv ? { currency: str(gmv.currency), amount: num(gmv.amount) } : null,
    liveGmv: liveGmv
      ? { currency: str(liveGmv.currency), amount: num(liveGmv.amount) }
      : null,
    videoGmv: videoGmv
      ? { currency: str(videoGmv.currency), amount: num(videoGmv.amount) }
      : null,
    hasCollaborated: bool(profile.has_collaborated),
    hasInvited90d: bool(profile.has_invited_90d),
    isCreatorBlocked: bool(profile.is_creator_blocked),
    creatorLevel: num(profile.creator_level),
    ppsScore: str(profile.pps_score),
    isFastGrowing: bool(profile.is_fast_growing),
    isOfficialRecommend: bool(profile.is_official_recommend),
  };
}

/** POST /affiliate_seller/202608/marketplace_creators/search — cari kreator
 *  Creator Marketplace. page_size hanya boleh 12 atau 20. */
export async function searchMarketplaceCreators(
  ctx: AffiliateShopCtx,
  filter: AffiliateSearchFilter = {},
  opts: { pageToken?: string; searchKey?: string; pageSize?: number } = {},
): Promise<AffiliateSearchResult> {
  const body: Record<string, unknown> = {};
  if (opts.searchKey) body.search_key = opts.searchKey;
  if (filter.keyword) body.keyword = filter.keyword;

  const countRange: Record<string, unknown> = {};
  if (filter.countGe !== undefined) countRange.count_ge = filter.countGe;
  if (filter.countLe !== undefined) countRange.count_le = filter.countLe;
  if (Object.keys(countRange).length > 0) {
    body.follower_demographics = { count_range: countRange };
  }

  if (filter.categoryParentId) {
    const cat: Record<string, unknown> = {
      parent_category_id: filter.categoryParentId,
    };
    if ((filter.categoryChildIds ?? []).length > 0) {
      cat.child_category_id_list = filter.categoryChildIds;
    }
    body.category = [cat];
  }

  if (filter.notInvitedL90Days === true) {
    body.affiliate_data = { not_invited_l90_days: true };
  }

  body.advanced_filters = {
    sorter_algorithm_id: filter.sorterAlgorithmId ?? "1",
  };
  body.data_groups = [
    "BASIC_CREATOR_INFORMATION",
    "FOLLOWER_INFORMATION",
    "COLLABORATION",
    "SALES_AND_GMV",
  ];

  const pageSize = opts.pageSize === 12 ? 12 : 20;
  const params: Record<string, string> = {
    page_size: String(pageSize),
    ...(opts.pageToken ? { page_token: opts.pageToken } : {}),
  };

  const res = await affiliatePost(
    "/affiliate_seller/202608/marketplace_creators/search",
    ctx,
    body,
    params,
  );
  if (!res.ok) return { ok: false, detail: res.detail, code: res.code };

  const d = res.data;
  return {
    ok: true,
    items: ((d.creators ?? []) as Record<string, unknown>[]).map(
      parseCreatorRow,
    ),
    nextPageToken: str(d.next_page_token),
    searchKey: str(d.search_key),
  };
}

// ---------- Cek eligibilitas outreach ----------

export type CreatorEligibilityRow = {
  creatorOpenId: string;
  creatorLevel: number;
  isBlocked: boolean;
  isConnected: boolean;
  isFollowerThresholdMet: boolean;
  isLevelQuotaAvailable: boolean;
  isPaired: boolean;
};

export type EligibilityResult =
  | {
      ok: true;
      results: CreatorEligibilityRow[];
      ineligibleLevels: number[];
      batchQuotaConsumable: boolean;
    }
  | { ok: false; detail: string };

/** POST /affiliate_seller/202610/creator_outreach/eligibility/check — cek
 *  eligibilitas per kreator. Maksimal 100 open id per panggilan; daftar yang
 *  lebih panjang dipotong jadi beberapa batch lalu digabungkan. */
export async function checkCreatorOutreachEligibility(
  ctx: AffiliateShopCtx,
  openIds: string[],
): Promise<EligibilityResult> {
  const unique = [...new Set(openIds.filter((id) => id !== ""))];
  if (unique.length === 0) {
    return { ok: false, detail: "Tidak ada creator open id yang dikirim." };
  }
  const results: CreatorEligibilityRow[] = [];
  const ineligibleLevels = new Set<number>();
  let batchQuotaConsumable = true;

  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const res = await affiliatePost(
      "/affiliate_seller/202610/creator_outreach/eligibility/check",
      ctx,
      { creator_infos: chunk.map((id) => ({ creator_open_id: id })) },
    );
    if (!res.ok) return { ok: false, detail: res.detail };
    const d = res.data;
    const rows = ((d.creator_eligibility_results ?? []) as Record<
      string,
      unknown
    >[]).map((r) => ({
      creatorOpenId: str(r.creator_open_id),
      creatorLevel: num(r.creator_level),
      isBlocked: bool(r.is_blocked),
      isConnected: bool(r.is_connected),
      isFollowerThresholdMet: bool(r.is_creator_follower_count_threshold_met),
      isLevelQuotaAvailable: bool(r.is_creator_level_quota_available),
      isPaired: bool(r.is_paired),
    }));
    results.push(...rows);
    for (const level of (d.ineligible_creator_levels ?? []) as unknown[]) {
      ineligibleLevels.add(num(level));
    }
    if (d.is_batch_quota_consumable === false) batchQuotaConsumable = false;
  }

  return {
    ok: true,
    results,
    ineligibleLevels: [...ineligibleLevels],
    batchQuotaConsumable,
  };
}

// ---------- Undangan target collaboration ----------

export type TargetCollaborationProduct = {
  id: string;
  /** Komisi per seratus persen: 1500 = 15%. Minimal 100 (1%). */
  targetCommissionRate: number;
  /** Komisi khusus order dari Shop Ads, per 1/10.000: 1000 = 10%. */
  shopAdsCommissionRate?: number;
};

export type TargetCollaborationInput = {
  name: string;
  message?: string;
  /** Akhir masa berlaku target collaboration, epoch detik sebagai string. */
  endTime: string;
  products: TargetCollaborationProduct[];
  creatorUserOpenIds: string[];
  sellerContactInfo: {
    email?: string;
    phoneNumber?: string;
    whatsapp?: string;
    telegram?: string;
    line?: string;
  };
  freeSampleRule?: { hasFreeSample: boolean; isSampleApprovalExempt: boolean };
  preferredContentType?: "LIVE" | "VIDEO";
};

export type InviteBatchResult =
  | {
      ok: true;
      collaborationId: string;
      creatorOpenIds: string[];
      conflicts: { creatorOpenId: string; productId: string }[];
      invalidOpenIds: string[];
      invalidProductIds: string[];
      createTime: number;
    }
  | { ok: false; creatorOpenIds: string[]; detail: string; code: number | null };

export type InviteBatchSummary =
  | { ok: true; batches: InviteBatchResult[]; invitedCount: number }
  | { ok: false; detail: string };

/** POST /affiliate_seller/202508/target_collaborations — satu undangan
 *  target collaboration (maks 50 kreator, maks 100 produk). */
export async function createTargetCollaboration(
  ctx: AffiliateShopCtx,
  input: TargetCollaborationInput,
): Promise<InviteBatchResult> {
  const products = input.products.slice(0, 100).map((p) => {
    const row: Record<string, unknown> = {
      id: p.id,
      target_commission_rate: Math.max(100, Math.round(p.targetCommissionRate)),
    };
    if (p.shopAdsCommissionRate !== undefined) {
      row.shop_ads_commission_rate = Math.round(p.shopAdsCommissionRate);
    }
    return row;
  });
  const body: Record<string, unknown> = {
    name: input.name,
    end_time: input.endTime,
    products,
    creator_user_open_ids: input.creatorUserOpenIds.slice(0, 50),
    seller_contact_info: {
      email: input.sellerContactInfo.email ?? "",
      phone_number: input.sellerContactInfo.phoneNumber ?? "",
      whatsapp: input.sellerContactInfo.whatsapp ?? "",
      telegram: input.sellerContactInfo.telegram ?? "",
      line: input.sellerContactInfo.line ?? "",
    },
    free_sample_rule: {
      has_free_sample: input.freeSampleRule?.hasFreeSample ?? false,
      is_sample_approval_exempt:
        input.freeSampleRule?.isSampleApprovalExempt ?? false,
    },
  };
  if (input.message) body.message = input.message;
  if (input.preferredContentType) {
    body.preferred_content_type = input.preferredContentType;
  }

  const res = await affiliatePost(
    "/affiliate_seller/202508/target_collaborations",
    ctx,
    body,
  );
  if (!res.ok) {
    return {
      ok: false,
      creatorOpenIds: input.creatorUserOpenIds.slice(0, 50),
      detail: res.detail,
      code: res.code,
    };
  }
  const d = res.data;
  const tc = (d.target_collaboration ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    collaborationId: str(tc.id),
    creatorOpenIds: input.creatorUserOpenIds.slice(0, 50),
    conflicts: (
      (d.target_collaboration_conflicts ?? []) as Record<string, unknown>[]
    ).map((c) => ({
      creatorOpenId: str(c.creator_user_open_id),
      productId: str(c.product_id),
    })),
    invalidOpenIds: ((d.invalid_open_id_list ?? []) as unknown[]).map(str),
    invalidProductIds: ((d.invalid_product_id_list ?? []) as unknown[]).map(
      str,
    ),
    createTime: num(d.create_time),
  };
}

/** Kode error yang lazimnya disebabkan SATU kreator bermasalah (bukan
 *  global) — batch yang gagal dengan kode ini layak dipecah dua untuk
 *  mengisolasi kreator penyebabnya. */
const SPLIT_CODES = new Set([
  16024006, // kreator resmi milik penjual
  16024008, // produk bukan milik toko (bisa dari satu produk)
  16024016, // kreator sudah terhubung dengan akun toko
  16024020, // kreator yang dikecualikan
  16024021, // kreator melebihi batas follower
  16024022, // pasangan kreator–produk sudah ada undangannya
  50001702, // kreator/produk tidak tersedia
  98001004, // parameter tidak valid
]);

/** Buat target collaboration dengan pemecahan adaptif: bila gagal dengan
 *  kode per-kreator dan batch masih bisa dipecah, coba setengahnya dulu
 *  (rekursif) supaya satu kreator bermasalah tidak menggagalkan batch 50. */
async function createTargetCollaborationAdaptive(
  ctx: AffiliateShopCtx,
  input: TargetCollaborationInput,
): Promise<InviteBatchResult[]> {
  if (input.creatorUserOpenIds.length <= 1) {
    return [await createTargetCollaboration(ctx, input)];
  }
  const result = await createTargetCollaboration(ctx, input);
  if (result.ok) return [result];
  if (result.code === null || !SPLIT_CODES.has(result.code)) {
    return [result];
  }
  const half = Math.ceil(input.creatorUserOpenIds.length / 2);
  const left = await createTargetCollaborationAdaptive(ctx, {
    ...input,
    creatorUserOpenIds: input.creatorUserOpenIds.slice(0, half),
  });
  const right = await createTargetCollaborationAdaptive(ctx, {
    ...input,
    creatorUserOpenIds: input.creatorUserOpenIds.slice(half),
  });
  return [...left, ...right];
}

/** Kirim undangan target collaboration untuk daftar kreator yang panjang:
 *  potong open id jadi batch maksimal 50 lalu panggil berurutan (dengan
 *  pemecahan adaptif untuk error per-kreator). `onBatch` dipanggil setelah
 *  tiap batch (dipakai route untuk menulis jurnal). */
export async function sendTargetCollaborationInvites(
  ctx: AffiliateShopCtx,
  input: TargetCollaborationInput,
  onBatch?: (index: number, result: InviteBatchResult) => Promise<void> | void,
): Promise<InviteBatchSummary> {
  if (input.products.length === 0) {
    return { ok: false, detail: "Pilih minimal satu produk untuk diundangkan." };
  }
  if (input.products.length > 100) {
    return {
      ok: false,
      detail: "Maksimal 100 produk per target collaboration.",
    };
  }
  const unique = [
    ...new Set(input.creatorUserOpenIds.filter((id) => id !== "")),
  ];
  if (unique.length === 0) {
    return { ok: false, detail: "Tidak ada creator open id yang dikirim." };
  }
  const batches: InviteBatchResult[] = [];
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const results = await createTargetCollaborationAdaptive(ctx, {
      ...input,
      creatorUserOpenIds: chunk,
    });
    for (const result of results) {
      batches.push(result);
      if (onBatch) await onBatch(batches.length - 1, result);
    }
  }
  const invitedCount = batches.reduce((sum, b) => {
    if (!b.ok) return sum;
    const conflictIds = new Set(b.conflicts.map((c) => c.creatorOpenId));
    const invalidIds = new Set(b.invalidOpenIds);
    return (
      sum +
      b.creatorOpenIds.filter(
        (id) => !conflictIds.has(id) && !invalidIds.has(id),
      ).length
    );
  }, 0);
  return { ok: true, batches, invitedCount };
}

/** Tulis jurnal + tandai status cache untuk satu batch hasil undangan. */
export async function journalInviteBatch(
  shopId: string,
  productIds: string[],
  result: InviteBatchResult,
): Promise<void> {
  const invalid = new Set(result.ok ? result.invalidOpenIds : []);
  const conflict = new Set(
    result.ok ? result.conflicts.map((c) => c.creatorOpenId) : [],
  );
  const sentIds: string[] = [];
  const failedIds: string[] = [];
  const productIdsJson = JSON.stringify(productIds);
  for (const id of result.creatorOpenIds) {
    let status: string;
    let errorCode = "";
    let detail = "";
    if (!result.ok) {
      status = "failed";
      errorCode = result.code === null ? "" : String(result.code);
      detail = result.detail;
      failedIds.push(id);
    } else if (invalid.has(id)) {
      status = "invalid";
      detail = "Open id tidak valid menurut TikTok";
      failedIds.push(id);
    } else if (conflict.has(id)) {
      status = "conflict";
      detail = "Sudah ada undangan untuk pasangan kreator–produk ini";
      failedIds.push(id);
    } else {
      status = "sent";
      sentIds.push(id);
    }
    await saveAffiliateInvite({
      shop_id: shopId,
      collaboration_id: result.ok ? result.collaborationId : "",
      creator_open_id: id,
      product_ids: productIdsJson,
      status,
      error_code: errorCode,
      detail,
    });
  }
  if (sentIds.length > 0) await markAffiliateCreatorStatus(sentIds, "sent");
  if (failedIds.length > 0) {
    await markAffiliateCreatorStatus(failedIds, "failed");
  }
}

/** Terjemahan kode error TikTok ke keterangan singkat untuk UI/jurnal. */
export function describeAffiliateError(code: number | null): string {
  switch (code) {
    case 16024004:
      return "Akun uji dan non-uji tidak boleh saling undang";
    case 16024006:
      return "Penjual tidak dapat mengundang kreator resmi miliknya";
    case 16024008:
      return "Ada produk yang bukan milik toko ini";
    case 16024016:
      return "Kreator sudah terhubung dengan akun toko";
    case 16024019:
      return "Kuota undangan tidak mencukupi";
    case 16024020:
      return "Kreator yang dikecualikan harus dihapus dari daftar";
    case 16024021:
      return "Undangan melebihi batas follower";
    case 16024022:
      return "Pasangan kreator–produk sudah ada undangannya";
    case 50001702:
      return "Mengandung kreator atau produk yang tidak tersedia";
    case 50001703:
      return "Parameter mengandung kata sensitif";
    case 45101004:
      return "Kuota harian pencarian kreator habis (10.000/hari)";
    default:
      return "";
  }
}

// ---------- Riwayat outreach mingguan ----------

export type OutreachRecordRow = {
  id: string;
  creatorOpenId: string;
  hasSentImMessage: boolean;
  hasSentInvitation: boolean;
  isPaired: boolean;
};

export type OutreachRecordsResult =
  | { ok: true; total: number; items: OutreachRecordRow[] }
  | { ok: false; detail: string };

/** POST /affiliate_seller/202608/creator_outreach/records/query — riwayat
 *  kreator yang baru terhubung minggu ini (payload bersarang di data.data). */
export async function getCreatorOutreachRecords(
  ctx: AffiliateShopCtx,
  pageIndex = 1,
  pageSize = 50,
): Promise<OutreachRecordsResult> {
  const res = await affiliatePost(
    "/affiliate_seller/202608/creator_outreach/records/query",
    ctx,
    {
      page_index: Math.max(1, Math.round(pageIndex)),
      page_size: Math.min(50, Math.max(2, Math.round(pageSize))),
    },
  );
  if (!res.ok) return { ok: false, detail: res.detail };
  // Payload bisa bersarang satu tingkat lebih dalam (pola data.data.data
  // seperti endpoint kuota) — toleransi dengan unwrap berlapis.
  const outer = (res.data.data ?? {}) as Record<string, unknown>;
  const d = (outer.data ?? outer) as Record<string, unknown>;
  return {
    ok: true,
    total: num(d.total),
    items: ((d.connect_list ?? []) as Record<string, unknown>[]).map((r) => ({
      id: str(r.id),
      creatorOpenId: str(r.creator_open_id),
      hasSentImMessage: bool(r.has_sent_im_message),
      hasSentInvitation: bool(r.has_sent_invitation),
      isPaired: bool(r.is_paired),
    })),
  };
}
