// Shell dashboard: sidebar + konten. Semua halaman di grup ini wajib login.
// Di layar kecil sidebar lebar disembunyikan dan diganti MobileNav di atas.
import { requireAuth } from "@/lib/auth";
import Sidebar from "@/components/sidebar";
import MobileNav from "@/components/mobile-nav";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAuth();
  return (
    <div className="flex min-h-screen flex-col bg-slate-100 md:flex-row">
      <MobileNav />
      <Sidebar />
      <main className="flex-1 px-4 py-5 sm:px-6 lg:px-10">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
