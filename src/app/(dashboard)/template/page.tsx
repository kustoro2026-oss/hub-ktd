// Halaman Template — kelola template pesan Meta langsung dari Hub
// tanpa perlu membuka WhatsApp Manager.
import TemplateClient from "@/components/template-client";
import PageHeader from "@/components/page-header";

export const dynamic = "force-dynamic";
export const metadata = { title: "Template" };

export default function TemplatePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Template Pesan"
        subtitle="Buat, cek status review, dan hapus template"
      />
      <TemplateClient />
    </div>
  );
}
