// Alihkan alamat lama pemetaan produk TikTok-Aneka ke lokasi baru di
// grup TikTok Shop — menjaga tautan/bookmark lama tetap berfungsi.
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function AnekaPemetaanLamaPage() {
  redirect("/marketplace/tiktok/pemetaan");
}
