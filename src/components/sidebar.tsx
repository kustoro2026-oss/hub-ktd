"use client";

// Navigasi samping KTD Hub — disusun per seksi (Utama, Komunikasi,
// Marketplace, Lainnya). Marketplace berbentuk grup per platform yang
// bisa dilipat, masing-masing dengan submenu sendiri (Pesanan, Produk).
// Item aktif dicocokkan PERSIS dengan pathname (bukan awalan) supaya
// "/pesan" dan "/pesanan" tidak ikut menyala bersamaan.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ComponentType } from "react";
import {
  LayoutDashboard,
  MessageSquare,
  Send,
  Settings,
  LogOut,
  Users,
  BadgeCheck,
  Store,
  FileText,
  Package,
  ChevronDown,
  Boxes,
  Link2,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
  /** Item roadmap: tampil nonaktif dengan label "Segera". */
  segera?: boolean;
};

export type NavGroup = { title: string; items: NavItem[] };

export type NavSection =
  | { title: string; items: NavItem[] }
  | { title: string; groups: NavGroup[] };

export const NAV: NavSection[] = [
  {
    title: "Utama",
    items: [{ href: "/", label: "Dasbor", Icon: LayoutDashboard }],
  },
  {
    title: "Komunikasi",
    items: [
      { href: "/kontak", label: "Kontak", Icon: Users },
      { href: "/broadcast", label: "Broadcast", Icon: Send },
      { href: "/template", label: "Template", Icon: FileText },
      { href: "/pesan", label: "Pesan Masuk", Icon: MessageSquare },
      { href: "/verifikasi", label: "Verifikasi", Icon: BadgeCheck },
    ],
  },
  {
    title: "Marketplace",
    groups: [
      {
        title: "TikTok Shop",
        items: [
          {
            href: "/marketplace/tiktok/pesanan",
            label: "Pesanan",
            Icon: Package,
          },
          { href: "", label: "Produk", Icon: Boxes, segera: true },
        ],
      },
      {
        title: "Blibli",
        items: [
          { href: "", label: "Pesanan", Icon: Package, segera: true },
          { href: "", label: "Produk", Icon: Boxes, segera: true },
        ],
      },
      {
        title: "Lazada",
        items: [
          { href: "", label: "Pesanan", Icon: Package, segera: true },
          { href: "", label: "Produk", Icon: Boxes, segera: true },
        ],
      },
      {
        title: "Aneka",
        items: [
          {
            href: "/marketplace/aneka/pemetaan",
            label: "Pemetaan Produk",
            Icon: Link2,
          },
        ],
      },
    ],
  },
  {
    title: "Lainnya",
    items: [{ href: "/pengaturan", label: "Pengaturan", Icon: Settings }],
  },
];

// Daftar datar untuk bilah navigasi seluler — item roadmap dilewati
// karena bilah pill horizontal tidak punya submenu.
export function flattenNav(): NavItem[] {
  const out: NavItem[] = [];
  for (const s of NAV) {
    if ("items" in s) out.push(...s.items);
    else for (const g of s.groups) out.push(...g.items);
  }
  return out.filter((i) => !i.segera && i.href !== "");
}

function NavLink({
  item,
  active,
}: {
  item: NavItem;
  active: boolean;
}) {
  const Icon = item.Icon;
  const content = (
    <>
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{item.label}</span>
      {item.segera ? (
        <span className="ml-auto rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
          Segera
        </span>
      ) : null}
    </>
  );

  if (item.segera || item.href === "") {
    return (
      <div
        title="Fitur segera hadir"
        className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-500 opacity-70"
      >
        {content}
      </div>
    );
  }

  return (
    <Link
      href={item.href}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
        active
          ? "bg-emerald-600 font-medium text-white"
          : "text-slate-300 hover:bg-slate-800 hover:text-white"
      }`}
    >
      {content}
    </Link>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // Grup marketplace yang sedang dibuka — TikTok Shop dibuka sejak awal
  // karena sudah aktif; grup lain tertutup sampai fiturnya hadir.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    "TikTok Shop": true,
  });

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

      <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-4">
        {NAV.map((section) => (
          <div key={section.title}>
            <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {section.title}
            </div>

            {"items" in section ? (
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <NavLink
                    key={item.href || item.label}
                    item={item}
                    active={item.href !== "" && pathname === item.href}
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-0.5">
                {section.groups.map((group) => {
                  const open = openGroups[group.title] ?? false;
                  const hasActiveChild = group.items.some(
                    (i) => i.href !== "" && pathname === i.href,
                  );
                  const allSegera = group.items.every((i) => i.segera);

                  return (
                    <div key={group.title}>
                      <button
                        onClick={() =>
                          setOpenGroups((s) => ({
                            ...s,
                            [group.title]: !open,
                          }))
                        }
                        className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                          hasActiveChild
                            ? "font-medium text-white"
                            : "text-slate-300 hover:bg-slate-800 hover:text-white"
                        }`}
                      >
                        <ChevronDown
                          className={`h-3.5 w-3.5 shrink-0 transition-transform ${
                            open ? "" : "-rotate-90"
                          }`}
                        />
                        <span className="truncate">{group.title}</span>
                        {allSegera ? (
                          <span className="ml-auto rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                            Segera
                          </span>
                        ) : null}
                      </button>

                      {open ? (
                        <div className="ml-4 mt-0.5 space-y-0.5 border-l border-slate-700 pl-2">
                          {group.items.map((item) => (
                            <NavLink
                              key={item.label}
                              item={item}
                              active={item.href !== "" && pathname === item.href}
                            />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
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
