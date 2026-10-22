// Halaman Pemakaian Database & Pembersihan Data — melihat ukuran per tabel
// dan menjalankan cleanup data lama yang sudah tidak dibutuhkan.
import { requireAuth } from "@/lib/auth";
import PageHeader from "@/components/page-header";
import UsageCleanupClient from "./usage-cleanup-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pemakaian Database" };

export default async function PemakaianPage() {
  await requireAuth();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operasional"
        title="Pemakaian Database"
        subtitle="Monitor ukuran tabel dan bersihkan data lama untuk menghemat kuota Supabase"
      />
      <UsageCleanupClient />
    </div>
  );
}
