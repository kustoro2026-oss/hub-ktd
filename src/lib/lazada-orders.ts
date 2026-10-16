// Orkestrasi pesanan Lazada: tarik pesanan terbaru toko KTD STORE dari
// Open Platform (rentang tanggal & filter bisa diatur lewat argumen).
// Dipakai route API dan halaman Pesanan di dashboard.
import {
  getLazadaCtx,
  getLazadaOrders,
  type LazadaOrdersFilter,
  type LazadaOrderRow,
} from "@/lib/lazada";

export const LAZADA_STORE_NAME = "KTD STORE";

export type LazadaStoreOrders = {
  store_code: string;
  store_name: string;
  ok: boolean;
  detail?: string;
  count?: number;
  orders?: LazadaOrderRow[];
};

/** Tarik pesanan toko KTD STORE. `filter` diteruskan ke API /orders/get
 *  (rentang tanggal, status, urutan, halaman). */
export async function pullLazadaOrders(
  filter: LazadaOrdersFilter = {},
): Promise<LazadaStoreOrders[]> {
  const ctx = await getLazadaCtx();
  if (!ctx.ok) {
    return [
      {
        store_code: "-",
        store_name: LAZADA_STORE_NAME,
        ok: false,
        detail: ctx.detail,
      },
    ];
  }

  const ord = await getLazadaOrders(filter);
  if (!ord.ok) {
    return [
      {
        store_code: ctx.sellerId,
        store_name: LAZADA_STORE_NAME,
        ok: false,
        detail: ord.detail,
      },
    ];
  }
  return [
    {
      store_code: ctx.sellerId,
      store_name: LAZADA_STORE_NAME,
      ok: true,
      count: ord.data.countTotal,
      orders: ord.data.orders,
    },
  ];
}
