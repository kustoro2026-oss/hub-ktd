"use client";

// Sidebar desktop KTD Hub — bisa diciutkan jadi kolom ikon lewat tombol
// "Ciutkan menu" berlabel di bagian bawah; pilihan tersimpan di localStorage.
// Logo di atas, navigasi bersama (SidebarNav), dan tombol keluar di bawah.
// Di layar kecil sidebar ini disembunyikan dan diganti drawer MobileNav.
import { useEffect, useState } from "react";
import { PanelLeftClose, PanelLeftOpen, Store } from "lucide-react";
import SidebarNav from "@/components/sidebar-nav";

// Re-export tipe & NAV agar import lama tidak rusak.
export {
  NAV,
  flattenNav,
  type NavItem,
  type NavGroup,
  type NavSection,
} from "@/components/sidebar-nav";

const STORAGE_KEY = "ktd-sidebar-collapsed";

export default function Sidebar() {
  // null = belum tahu pilihan tersimpan (render terbuka dulu supaya tidak
  // berkedip saat hydration), lalu diterapkan dari localStorage.
  const [collapsed, setCollapsed] = useState<boolean | null>(null);

  useEffect(() => {
    setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  function setCollapsedPersist(v: boolean) {
    setCollapsed(v);
    localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
  }

  const isCollapsed = collapsed === true;

  return (
    <aside
      className={`sticky top-0 hidden h-dvh shrink-0 flex-col bg-slate-900 text-slate-200 transition-[width] duration-200 md:flex ${
        isCollapsed ? "w-[68px]" : "w-60"
      }`}
    >
      <div
        className={`flex border-b border-slate-800 py-4 ${
          isCollapsed ? "justify-center px-2" : "items-center gap-2.5 px-4"
        }`}
      >
        {isCollapsed ? (
          <button
            type="button"
            onClick={() => setCollapsedPersist(false)}
            title="Buka menu"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 transition hover:bg-emerald-500/25"
          >
            <Store className="h-5 w-5 text-emerald-400" />
          </button>
        ) : (
          <>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15">
              <Store className="h-5 w-5 text-emerald-400" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold leading-tight">KTD Hub</div>
              <div className="truncate text-[11px] text-slate-400">
                toko.kustoro2026.com
              </div>
            </div>
          </>
        )}
      </div>
      <SidebarNav
        collapsed={isCollapsed}
        onExpand={() => setCollapsedPersist(false)}
      />
      {/* Tombol buka/tutup berlabel di posisi tetap — saat terciut berubah
          menjadi ikon "buka" yang jelas di tempat yang sama, jadi menu
          tidak pernah terasa hilang. */}
      <div className="border-t border-slate-800 p-2">
        <button
          type="button"
          onClick={() => setCollapsedPersist(!isCollapsed)}
          title={isCollapsed ? "Buka menu" : undefined}
          className={`flex w-full items-center rounded-lg py-2 text-sm text-slate-300 transition hover:bg-slate-800 hover:text-white ${
            isCollapsed ? "justify-center px-0" : "gap-3 px-3"
          }`}
        >
          {isCollapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <>
              <PanelLeftClose className="h-4 w-4" />
              Ciutkan menu
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
