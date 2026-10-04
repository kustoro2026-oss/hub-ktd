"use client";

// Navigasi samping KTD Hub — item aktif disorot sesuai pathname.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  MessageSquare,
  Send,
  Settings,
  LogOut,
  Users,
  BadgeCheck,
  Store,
} from "lucide-react";

export const NAV = [
  { href: "/", label: "Dasbor", Icon: LayoutDashboard },
  { href: "/kontak", label: "Kontak", Icon: Users },
  { href: "/verifikasi", label: "Verifikasi", Icon: BadgeCheck },
  { href: "/broadcast", label: "Broadcast", Icon: Send },
  { href: "/pesan", label: "Pesan Masuk", Icon: MessageSquare },
  { href: "/pengaturan", label: "Pengaturan", Icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

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
    <aside className="hidden w-56 shrink-0 flex-col bg-slate-900 text-slate-200 md:flex">
      <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-4">
        <Store className="h-6 w-6 text-emerald-400" />
        <div>
          <div className="text-sm font-bold leading-tight">KTD Hub</div>
          <div className="text-[11px] text-slate-400">toko.kustoro2026.com</div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-2 py-4">
        {NAV.map(({ href, label, Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                active
                  ? "bg-emerald-600 font-medium text-white"
                  : "text-slate-300 hover:bg-slate-800"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-800 p-2">
        <button
          onClick={logout}
          disabled={busy}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
        >
          <LogOut className="h-4 w-4" />
          Keluar
        </button>
      </div>
    </aside>
  );
}
