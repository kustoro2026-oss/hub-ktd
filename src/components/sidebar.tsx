"use client";

// Sidebar desktop KTD Hub — logo di atas, navigasi bersama (SidebarNav),
// dan tombol keluar di bawah. Di layar kecil sidebar ini disembunyikan dan
// diganti drawer yang dibuka MobileNav.
import { Store } from "lucide-react";
import SidebarNav from "@/components/sidebar-nav";

// Re-export tipe & NAV agar import lama tidak rusak.
export {
  NAV,
  flattenNav,
  type NavItem,
  type NavGroup,
  type NavSection,
} from "@/components/sidebar-nav";

export default function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col bg-slate-900 text-slate-200 md:flex">
      <div className="flex items-center gap-2.5 border-b border-slate-800 px-4 py-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15">
          <Store className="h-5 w-5 text-emerald-400" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold leading-tight">KTD Hub</div>
          <div className="truncate text-[11px] text-slate-400">
            toko.kustoro2026.com
          </div>
        </div>
      </div>
      <SidebarNav />
    </aside>
  );
}
