// Orkestrasi pesanan Blibli: tarik paket pesanan terbaru dari toko KTD STORE
// (rentang tanggal & filter bisa diatur lewat argumen). Dipakai route API
// dan halaman Pesanan di dashboard.
import {
  blibliEnv,
  listBlibliOrders,
  type BlibliOrdersFilter,
  type BlibliOrderPackage,
} from "@/lib/blibli";

export const BLIBLI_STORE_NAME = "KTD STORE";

export type BlibliStoreOrders = {
  store_code: string;
  store_name: string;
  ok: boolean;
  detail?: string;
  count?: number;
  packages?: BlibliOrderPackage[];
};

/** Tarik pesanan toko KTD STORE. `filter` diteruskan ke API Order List V2
 *  (rentang tanggal status FP, status item, dll). */
export async function pullBlibliOrders(
  filter: BlibliOrdersFilter = {},
): Promise<BlibliStoreOrders[]> {
  const env = blibliEnv();
  if (!env.ready) {
    return [
      {
        store_code: env.storeCode || "-",
        store_name: BLIBLI_STORE_NAME,
        ok: false,
        detail: "Kredensial Blibli belum diatur (env BLIBLI_*).",
      },
    ];
  }

  const ord = await listBlibliOrders(filter);
  if (!ord.ok) {
    return [
      {
        store_code: env.storeCode,
        store_name: BLIBLI_STORE_NAME,
        ok: false,
        detail: ord.detail,
      },
    ];
  }
  return [
    {
      store_code: env.storeCode,
      store_name: BLIBLI_STORE_NAME,
      ok: true,
      count: ord.data.packages.length,
      packages: ord.data.packages,
    },
  ];
}
