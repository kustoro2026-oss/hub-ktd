// Halaman Template — kelola template pesan Meta langsung dari Hub
// tanpa perlu membuka WhatsApp Manager.
import TemplateClient from "@/components/template-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Template" };

export default function TemplatePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Template Pesan</h1>
        <p className="text-sm text-slate-500">
          Kelola template broadcast — buat, cek status review, hapus
        </p>
      </div>
      <TemplateClient />
    </div>
  );
}
