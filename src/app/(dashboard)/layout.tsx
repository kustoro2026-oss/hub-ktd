// Shell dashboard: sidebar + konten. Semua halaman di grup ini wajib login.
// Di layar kecil sidebar lebar disembunyikan dan diganti MobileNav di atas.
import { requireAuth } from "@/lib/auth";
import Sidebar from "@/components/sidebar";
import MobileNav from "@/components/mobile-nav";
import DashboardMain from "@/components/dashboard-main";

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
      <DashboardMain>{children}</DashboardMain>
    </div>
  );
}
