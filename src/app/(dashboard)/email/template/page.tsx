// Halaman Template Email — kelola template email marketing (subjek + isi
// HTML + variabel {{...}}) yang disimpan di database Hub sendiri. Tanpa
// antrean review seperti template Meta — langsung bisa dipakai kampanye.
import EmailTemplateClient from "@/components/email-template-client";
import PageHeader from "@/components/page-header";

export const dynamic = "force-dynamic";
export const metadata = { title: "Template Email" };

export default function EmailTemplatePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Template Email"
        subtitle="Buat, ubah, dan hapus template kampanye email"
      />
      <EmailTemplateClient />
    </div>
  );
}
