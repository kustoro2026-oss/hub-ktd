"use client";

// Bilah atas khusus layar kecil: logo, navigasi geser horizontal, dan keluar.
// Sidebar lebar tetap dipakai di layar md ke atas.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut, Store } from "lucide-react";
import { NAV } from "@/components/sidebar";

export default function MobileNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // Halaman percakapan punya header sendiri (tombol kembali) — bilah atas
  // disembunyikan agar chat memakai seluruh tinggi layar HP.
  if (/^\/pesan\/[^/]+/.test(pathname)) return null;

  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-900 text-slate-200 md:hidden">
      <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
        <Store className="h-5 w-5 shrink-0 text-emerald-400" />
        <span className="text-sm font-bold">KTD Hub</span>
        <span className="truncate text-[11px] text-slate-400">
          toko.kustoro2026.com
        </span>
        <button
          onClick={logout}
          disabled={busy}
          title="Keluar"
          className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-300 hover:bg-slate-800 disabled:opacity-50"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
      <nav className="flex gap-1.5 overflow-x-auto px-3 pb-2.5">
        {NAV.map(({ href, label, Icon }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs ${
                active
                  ? "bg-emerald-600 font-medium text-white"
                  : "text-slate-300 hover:bg-slate-800"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
