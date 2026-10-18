"use client";

// Tombol panah kiri/kanan untuk menggulirkan tabel yang lebih lebar dari
// layar. Muncul sebagai bilah tipis DI ATAS tabel hanya saat tabel
// meluber, jadi navigasi geser tersedia langsung — tidak perlu menggulir
// ke bawah sampai dasar tabel untuk mencari scrollbar horizontal.
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export default function TableScrollArrows({
  targetRef,
}: {
  targetRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [visible, setVisible] = useState(false);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    const update = () => {
      const overflow = el.scrollWidth > el.clientWidth + 1;
      setVisible(overflow);
      setCanLeft(el.scrollLeft > 1);
      setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    // Isi tabel bisa berubah (paginasi/pencarian) tanpa mengubah ukuran
    // wadah — amati juga perubahan anak agar state selalu akurat.
    const mo = new MutationObserver(update);
    mo.observe(el, { subtree: true, childList: true });
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      mo.disconnect();
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [targetRef]);

  if (!visible) return null;

  const scrollPage = (dir: 1 | -1) => {
    const el = targetRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };

  const btn =
    "rounded-md border border-slate-300 bg-white p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:cursor-default disabled:opacity-35";

  return (
    // sticky left-0: saat tabel digeser ke kanan, bilah ini tetap menempel
    // di tepi kiri area tabel yang terlihat (lebar bilah = lebar area
    // terlihat, jadi tombol panah di ujung kanannya selalu tampak).
    <div className="sticky left-0 z-10 flex items-center justify-end gap-1 border-b border-slate-200 bg-white px-3 py-1.5">
      <button
        type="button"
        onClick={() => scrollPage(-1)}
        disabled={!canLeft}
        aria-label="Geser tabel ke kiri"
        title="Geser tabel ke kiri"
        className={btn}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => scrollPage(1)}
        disabled={!canRight}
        aria-label="Geser tabel ke kanan"
        title="Geser tabel ke kanan"
        className={btn}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
