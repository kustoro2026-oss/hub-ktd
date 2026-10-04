"use client";

// Wadah konten dashboard. Halaman biasa dibatasi max-w-6xl agar nyaman
// dibaca; halaman percakapan (/pesan/[nomor]) memakai seluruh lebar dan
// tinggi layar supaya chat terasa penuh ala WhatsApp Web.
import { usePathname } from "next/navigation";

export default function DashboardMain({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isChat = /^\/pesan\/[^/]+/.test(pathname);

  if (isChat) {
    return (
      <main className="min-w-0 flex-1 md:h-dvh md:overflow-hidden">
        {children}
      </main>
    );
  }
  return (
    <main className="flex-1 px-4 py-5 sm:px-6 lg:px-10">
      <div className="mx-auto w-full max-w-6xl">{children}</div>
    </main>
  );
}
