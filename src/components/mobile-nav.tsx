"use client";

// Bilah atas khusus layar kecil: tombol menu membuka drawer berisi sidebar
// lengkap (menu yang sama persis dengan desktop). Halaman percakapan
// disembunyikan karena punya header sendiri (tombol kembali) supaya chat
// memakai seluruh tinggi layar HP.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, Store, X } from "lucide-react";
import SidebarNav from "@/components/sidebar-nav";

export default function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Tutup drawer tiap kali pindah halaman.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Kunci scroll halaman selama drawer terbuka.
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // Halaman percakapan punya header sendiri (tombol kembali) — bilah atas
  // disembunyikan agar chat memakai seluruh tinggi layar HP.
  if (/^\/pesan\/[^/]+/.test(pathname)) return null;

  return (
    <>
      <header className="sticky top-0 z-40 flex items-center gap-2.5 border-b border-slate-800 bg-slate-900 px-3 py-2.5 text-slate-200 md:hidden">
        <button
          onClick={() => setOpen(true)}
          aria-label="Buka menu"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-300 transition hover:bg-slate-800"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Link href="/" prefetch={false} className="flex min-w-0 items-center gap-2">
          <Store className="h-5 w-5 shrink-0 text-emerald-400" />
          <span className="truncate text-sm font-bold">KTD Hub</span>
        </Link>
        <span className="ml-auto truncate text-[11px] text-slate-400">
          toko.kustoro2026.com
        </span>
      </header>

      {/* Latar belakang gelap saat drawer terbuka */}
      {open ? (
        <div
          className="fixed inset-0 z-40 bg-slate-950/50 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      ) : null}

      {/* Drawer sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] transform flex-col bg-slate-900 text-slate-200 shadow-2xl transition-transform duration-200 ease-out md:hidden ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Menu navigasi"
      >
        <div className="flex items-center gap-2.5 border-b border-slate-800 px-4 py-3.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15">
            <Store className="h-5 w-5 text-emerald-400" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold leading-tight">KTD Hub</div>
            <div className="truncate text-[11px] text-slate-400">
              toko.kustoro2026.com
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            aria-label="Tutup menu"
            className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-300 transition hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <SidebarNav onNavigate={() => setOpen(false)} />
      </aside>
    </>
  );
}
