// Halaman Afiliasi TikTok Shop — undang kreator Creator Marketplace lewat
// API resmi: cari kreator, cek eligibilitas, kirim undangan target
// collaboration, pantau jurnal undangan, dan atur pengundang otomatis cron.
// Bagian dari grup menu Marketplace → TikTok Shop.
import PageHeader from "@/components/page-header";
import TiktokAfiliasiClient from "@/components/tiktok-afiliasi-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Undang Kreator — Afiliasi TikTok Shop" };

export default function TiktokAfiliasiPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Marketplace · TikTok Shop"
        title="Undang Kreator"
        subtitle="Cari kreator Creator Marketplace, cek eligibilitas, lalu kirim undangan target collaboration via API resmi"
      />
      <TiktokAfiliasiClient />
    </div>
  );
}
