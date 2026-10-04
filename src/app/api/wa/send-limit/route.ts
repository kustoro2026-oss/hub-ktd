// Info batas kirim harian + pemakaian dari Hub — dipakai form kampanye
// sebagai penjaga kuota (peringatan bila penerima melebihi sisa kuota).
import { isAuthed } from "@/lib/auth";
import { countSentToday } from "@/lib/db";
import { getPhoneNumberStatus } from "@/lib/wa";

const TIER_MAX: Record<string, number> = {
  TIER_250: 250,
  TIER_2K: 2000,
  TIER_10K: 10000,
  TIER_100K: 100000,
};

export async function GET() {
  if (!(await isAuthed())) {
    return Response.json({ error: "Belum masuk" }, { status: 401 });
  }
  const [st, sentToday] = await Promise.all([
    getPhoneNumberStatus(),
    countSentToday(),
  ]);
  const tier = st.status?.whatsapp_business_manager_messaging_limit ?? "";
  const unlimited = tier === "UNLIMITED";
  const limit = unlimited ? null : TIER_MAX[tier] ?? 250;
  const remaining = unlimited ? null : Math.max(0, limit! - sentToday);
  return Response.json({
    ok: st.ok,
    tier,
    limit,
    sentToday,
    remaining,
    unlimited,
    detail: st.detail,
  });
}
