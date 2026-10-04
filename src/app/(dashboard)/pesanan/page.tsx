// Jalur lama /pesanan dialihkan ke lokasi baru dalam struktur menu
// Marketplace → TikTok Shop agar tautan lama tetap berfungsi.
import { redirect } from "next/navigation";

export default function PesananLegacyPage() {
  redirect("/marketplace/tiktok/pesanan");
}
