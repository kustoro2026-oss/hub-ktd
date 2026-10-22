"use client";

// Isi navigasi KTD Hub — dipakai Sidebar (desktop) dan drawer MobileNav
// (HP) supaya struktur menu selalu identik di kedua perangkat. Disusun per
// seksi (Utama, Top Up & Isi Saldo, Komunikasi, Marketplace, Lainnya).
// Marketplace berbentuk grup per platform yang bisa dilipat. Item aktif
// dicocokkan PERSIS dengan pathname (bukan awalan) supaya "/pesan" dan
// "/pesanan" tidak ikut menyala bersamaan — kecuali subhalaman "/massal"
// di bawah item Produk (lihat isActive).
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
  FileText,
  Package,
  ChevronDown,
  Boxes,
  Link2,
  PlayCircle,
  Wallet,
  Gauge,
  ReceiptText,
  Coins,
  Tags,
  AlertTriangle,
  SlidersHorizontal,
  Terminal,
  RefreshCw,
  ShieldAlert,
  Upload,
  ShoppingBag,
  UserPlus,
  Mail,
  AtSign,
  Database,
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
    items: [
      { href: "/", label: "Dasbor", Icon: LayoutDashboard },
      { href: "/keuangan", label: "Keuangan", Icon: Wallet },
    ],
  },
  {
    title: "Top Up & Isi Saldo",
    items: [
      { href: "/topup", label: "Ringkasan", Icon: Gauge },
      { href: "/topup/pesanan", label: "Pesanan", Icon: ReceiptText },
      { href: "/topup/saldo", label: "Saldo & Deposit", Icon: Coins },
      { href: "/topup/katalog", label: "Katalog & Margin", Icon: Tags },
      { href: "/topup/masalah", label: "Log Masalah", Icon: AlertTriangle },
      {
        href: "/topup/api-digiflazz",
        label: "API Digiflazz",
        Icon: Terminal,
      },
      {
        href: "/topup/pengaturan",
        label: "Pengaturan",
        Icon: SlidersHorizontal,
      },
    ],
  },
  {
    title: "Komunikasi",
    items: [
      { href: "/kontak", label: "Kontak", Icon: Users },
      { href: "/broadcast", label: "Broadcast", Icon: Send },
      { href: "/email/kampanye", label: "Email Marketing", Icon: Mail },
      { href: "/email/kontak", label: "Kontak Email", Icon: AtSign },
      { href: "/email/template", label: "Template Email", Icon: FileText },
      { href: "/template", label: "Template", Icon: FileText },
      { href: "/pesan", label: "Pesan Masuk", Icon: MessageSquare },
      { href: "/verifikasi", label: "Verifikasi", Icon: BadgeCheck },
    ],
  },
  {
    title: "Marketplace",
    groups: [
      {
        title: "Aneka",
        items: [
          {
            href: "/marketplace/aneka/produk",
            label: "Produk",
            Icon: Boxes,
          },
          {
            href: "/marketplace/aneka/harga",
            label: "Sinkron Harga",
            Icon: RefreshCw,
          },
          {
            href: "/marketplace/aneka/stok",
            label: "Sinkron Stok",
            Icon: Package,
          },
          {
            href: "/marketplace/aneka/aturan",
            label: "Cek Aturan",
            Icon: ShieldAlert,
          },
          {
            href: "/marketplace/aneka/upload",
            label: "Upload Baru",
            Icon: Upload,
          },
        ],
      },
      {
        title: "KTD Store",
        items: [
          {
            href: "/marketplace/ktd-store/produk",
            label: "Produk",
            Icon: Boxes,
          },
        ],
      },
      {
        title: "TikTok Shop",
        items: [
          {
            href: "/marketplace/tiktok/pesanan",
            label: "Pesanan",
            Icon: Package,
          },
          {
            href: "/marketplace/tiktok/eksekusi",
            label: "Eksekusi Pesanan",
            Icon: PlayCircle,
          },
          {
            href: "/marketplace/tiktok/pemetaan",
            label: "Pemetaan Produk",
            Icon: Link2,
          },
          {
            href: "/marketplace/tiktok/produk",
            label: "Produk",
            Icon: Boxes,
          },
          {
            href: "/marketplace/tiktok/afiliasi",
            label: "Undang Kreator",
            Icon: UserPlus,
          },
        ],
      },
      {
        title: "Blibli",
        items: [
          {
            href: "/marketplace/blibli/pesanan",
            label: "Pesanan",
            Icon: Package,
          },
          {
            href: "/marketplace/blibli/eksekusi",
            label: "Eksekusi Pesanan",
            Icon: PlayCircle,
          },
          {
            href: "/marketplace/blibli/pemetaan",
            label: "Pemetaan Produk",
            Icon: Link2,
          },
          {
            href: "/marketplace/blibli/produk",
            label: "Produk",
            Icon: Boxes,
          },
        ],
      },
      {
        title: "Lazada",
        items: [
          {
            href: "/marketplace/lazada/pesanan",
            label: "Pesanan",
            Icon: Package,
          },
          {
            href: "/marketplace/lazada/eksekusi",
            label: "Eksekusi Pesanan",
            Icon: PlayCircle,
          },
          {
            href: "/marketplace/lazada/pemetaan",
            label: "Pemetaan Produk",
            Icon: Link2,
          },
          {
            href: "/marketplace/lazada/produk",
            label: "Produk",
            Icon: Boxes,
          },
        ],
      },
    ],
  },
  {
    title: "Lainnya",
    items: [
      { href: "/ops/pemakaian", label: "Pemakaian DB", Icon: Database },
      { href: "/pengaturan", label: "Pengaturan", Icon: Settings },
    ],
  },
];

/** Daftar datar — dipakai halaman yang butuh semua item dalam satu baris. */
export function flattenNav(): NavItem[] {
  const out: NavItem[] = [];
  for (const s of NAV) {
    if ("items" in s) out.push(...s.items);
    else for (const g of s.groups) out.push(...g.items);
  }
  return out.filter((i) => !i.segera && i.href !== "");
}

/** Item navigasi aktif bila pathname sama persis, PLUS subhalaman
 *  "/produk/massal" di bawah item Produk (agar "Produk" tetap menyala saat
 *  membuka halaman Harga Massal). Awalan umum tidak dipakai supaya
 *  "/pesan" dan "/pesanan" tidak ikut menyala bersamaan. */
function isActive(pathname: string, href: string): boolean {
  if (!href) return false;
  if (pathname === href) return true;
  // Halaman detail kampanye email menyala di bawah menu Email Marketing.
  if (href === "/email/kampanye" && pathname.startsWith("/email/kampanye/"))
    return true;
  return href.endsWith("/produk") && pathname === `${href}/massal`;
}

function NavLink({
  item,
  active,
  onNavigate,
  collapsed,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
  /** Mode ikon-saja saat sidebar diciutkan: label disembunyikan dan
   *  nama item muncul sebagai tooltip. */
  collapsed?: boolean;
}) {
  const Icon = item.Icon;
  const content = (
    <>
      <Icon className="h-4 w-4 shrink-0" />
      {collapsed ? null : <span className="truncate">{item.label}</span>}
      {!collapsed && item.segera ? (
        <span className="ml-auto rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
          Segera
        </span>
      ) : null}
    </>
  );
  const baseCls = `flex items-center rounded-lg py-2 text-sm transition ${
    collapsed ? "justify-center px-0" : "gap-3 px-3"
  }`;

  if (item.segera || item.href === "") {
    return (
      <div
        title={collapsed ? item.label : "Fitur segera hadir"}
        className={`${baseCls} cursor-not-allowed text-slate-500 opacity-70`}
      >
        {content}
      </div>
    );
  }

  return (
    <Link
      href={item.href}
      // Prefetch DIMATIKAN: halaman dashboard menarik API marketplace
      // secara live, jadi prefetch semua menu (yang dipicu begitu link
      // masuk viewport) membanjiri fungsi server saat berpindah halaman.
      prefetch={false}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      className={`${baseCls} ${
        active
          ? "bg-emerald-600 font-medium text-white"
          : "text-slate-300 hover:bg-slate-800 hover:text-white"
      }`}
    >
      {content}
    </Link>
  );
}

export default function SidebarNav({
  onNavigate,
  collapsed,
  onExpand,
}: {
  /** Dipanggil setiap kali link diklik — dipakai drawer HP untuk menutup. */
  onNavigate?: () => void;
  /** Mode ikon-saja (sidebar desktop diciutkan). */
  collapsed?: boolean;
  /** Dipanggil saat menu butuh sidebar dibuka kembali (mis. klik grup
   *  marketplace dalam mode ikon-saja). */
  onExpand?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // Grup marketplace yang sedang dibuka — TikTok Shop dan Blibli dibuka
  // sejak awal karena sudah aktif; grup lain tertutup sampai fiturnya hadir.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    Aneka: true,
    "KTD Store": true,
    "TikTok Shop": true,
    Blibli: true,
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
    <>
      <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-4">
        {NAV.map((section) => (
          <div key={section.title}>
            {collapsed ? (
              <div className="mx-2 border-t border-slate-800" />
            ) : (
              <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {section.title}
              </div>
            )}

            {"items" in section ? (
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <NavLink
                    key={item.href || item.label}
                    item={item}
                    active={isActive(pathname, item.href)}
                    onNavigate={onNavigate}
                    collapsed={collapsed}
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-0.5">
                {section.groups.map((group) => {
                  const open = openGroups[group.title] ?? false;
                  const hasActiveChild = group.items.some((i) =>
                    isActive(pathname, i.href),
                  );
                  const allSegera = group.items.every((i) => i.segera);

                  return (
                    <div key={group.title}>
                      <button
                        onClick={() => {
                          if (collapsed) {
                            // Mode ikon-saja: buka sidebar + buka grup ini
                            // sekaligus supaya tujuan langsung terlihat.
                            setOpenGroups((s) => ({
                              ...s,
                              [group.title]: true,
                            }));
                            onExpand?.();
                          } else {
                            setOpenGroups((s) => ({
                              ...s,
                              [group.title]: !open,
                            }));
                          }
                        }}
                        title={collapsed ? group.title : undefined}
                        className={`flex w-full items-center rounded-lg py-2 text-sm transition ${
                          collapsed ? "justify-center px-0" : "gap-2 px-3"
                        } ${
                          collapsed && hasActiveChild
                            ? "bg-emerald-600 text-white"
                            : hasActiveChild
                              ? "font-medium text-white"
                              : "text-slate-300 hover:bg-slate-800 hover:text-white"
                        }`}
                      >
                        {collapsed ? (
                          <ShoppingBag className="h-4 w-4 shrink-0" />
                        ) : (
                          <>
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
                          </>
                        )}
                      </button>

                      {!collapsed && open ? (
                        <div className="ml-4 mt-0.5 space-y-0.5 border-l border-slate-700 pl-2">
                          {group.items.map((item) => (
                            <NavLink
                              key={item.label}
                              item={item}
                              active={isActive(pathname, item.href)}
                              onNavigate={onNavigate}
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
          title={collapsed ? "Keluar" : undefined}
          className={`flex w-full items-center rounded-lg py-2 text-sm text-slate-300 transition hover:bg-slate-800 disabled:opacity-50 ${
            collapsed ? "justify-center px-0" : "gap-3 px-3"
          }`}
        >
          <LogOut className="h-4 w-4" />
          {collapsed ? null : "Keluar"}
        </button>
      </div>
    </>
  );
}
