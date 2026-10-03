"use client";

// Area percakapan ala WhatsApp: bubble masuk (kiri, putih), bubble keluar
// (kanan, hijau), pembatas hari, dan kolom ketik untuk membalas manual.
import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import type { InboundMessage } from "@/lib/db";
import { dayLabel, timeHM } from "@/lib/format";

const GAGAL = "[GAGAL KIRIM] ";

type Node =
  | { kind: "sep"; label: string }
  | {
      kind: "bubble";
      key: string;
      side: "in" | "out";
      body: string;
      time: string;
      failed: boolean;
      notify?: string;
    };

function buildNodes(messages: InboundMessage[]): Node[] {
  const nodes: Node[] = [];
  let lastDay = "";
  for (const m of messages) {
    const day = dayLabel(m.created_at);
    if (day && day !== lastDay) {
      nodes.push({ kind: "sep", label: day });
      lastDay = day;
    }
    const hm = timeHM(m.created_at);
    if (m.direction === "in") {
      nodes.push({
        kind: "bubble",
        key: `${m.id}-in`,
        side: "in",
        body: m.body,
        time: hm,
        failed: false,
        notify: m.notify || undefined,
      });
      if (m.reply) {
        nodes.push({
          kind: "bubble",
          key: `${m.id}-reply`,
          side: "out",
          body: m.reply.startsWith(GAGAL) ? m.reply.slice(GAGAL.length) : m.reply,
          time: hm,
          failed: m.reply.startsWith(GAGAL),
        });
      }
    } else {
      nodes.push({ kind: "bubble", key: `${m.id}-out`, side: "out", body: m.body, time: hm, failed: false });
    }
  }
  return nodes;
}

export default function ChatThread({
  waFrom,
  messages,
}: {
  waFrom: string;
  messages: InboundMessage[];
}) {
  const [items, setItems] = useState<InboundMessage[]>(messages);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const nodes = buildNodes(items);

  // Selalu gulir ke pesan terbaru.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [nodes.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: waFrom, text: t }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Gagal mengirim pesan");
        setBusy(false);
        return;
      }
      const now = new Date();
      // Simpan UTC agar seragam dengan baris database (tampilan dikonversi WIB).
      const stamp = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")} ${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}:${String(now.getUTCSeconds()).padStart(2, "0")}`;
      setItems((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          wa_from: waFrom,
          body: t,
          reply: "",
          kind: "general",
          ad_id: "",
          direction: "out",
          read: 1,
          notify: "",
          created_at: stamp,
        },
      ]);
      setText("");
    } catch {
      setError("Jaringan bermasalah — coba lagi");
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col">
      {/* Area chat */}
      <div
        ref={scrollRef}
        className="h-[56vh] min-h-[320px] overflow-y-auto px-3 py-4 sm:px-4 md:h-[52vh] md:min-h-[340px]"
        style={{
          backgroundColor: "#efe7db",
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(0,0,0,0.05) 1px, transparent 0)",
          backgroundSize: "18px 18px",
        }}
      >
        <div className="mx-auto flex max-w-2xl flex-col gap-1.5">
          {nodes.map((n) => {
            if (n.kind === "sep") {
              return (
                <div key={n.label} className="my-2 flex justify-center">
                  <span className="rounded-md bg-white/90 px-2.5 py-0.5 text-[11px] font-medium text-slate-500 shadow-sm">
                    {n.label}
                  </span>
                </div>
              );
            }
            if (n.side === "in") {
              return (
                <div key={n.key} className="flex items-end gap-2">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-500 text-xs font-semibold text-white">
                    P
                  </div>
                  <div className="max-w-[78%] rounded-2xl rounded-bl-md bg-white px-3.5 py-2 shadow-sm">
                    <p className="whitespace-pre-line break-words text-sm leading-relaxed text-slate-800">
                      {n.body}
                    </p>
                    {n.notify && (
                      <div
                        className={`mt-1 text-[10px] font-medium ${
                          n.notify === "ok" ? "text-emerald-600" : "text-red-600"
                        }`}
                        title="Status notifikasi pesanan ke admin"
                      >
                        {n.notify === "ok"
                          ? "Notif pesanan terkirim ke admin"
                          : "Notif pesanan ke admin gagal"}
                      </div>
                    )}
                    <div className="mt-1 text-right text-[10px] text-slate-400">
                      {n.time}
                    </div>
                  </div>
                </div>
              );
            }
            return (
              <div key={n.key} className="flex justify-end pl-9">
                <div
                  className={`max-w-[78%] rounded-2xl rounded-br-md px-3.5 py-2 shadow-sm ${
                    n.failed ? "border border-red-200 bg-red-50" : "bg-[#d9fdd3]"
                  }`}
                >
                  {n.failed && (
                    <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-600">
                      Gagal terkirim
                    </div>
                  )}
                  <p className="whitespace-pre-line break-words text-sm leading-relaxed text-slate-800">
                    {n.body}
                  </p>
                  <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-slate-400">
                    {n.time}
                    {!n.failed && (
                      <span className="text-slate-500" title="Terkirim">
                        ✓
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Kolom ketik */}
      <form
        onSubmit={send}
        className="flex items-center gap-2 border-t border-slate-200 bg-white px-3 py-2"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ketik balasan"
          className="flex-1 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-base text-slate-800 outline-none focus:border-emerald-400 sm:text-sm"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          title="Kirim"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white transition-colors hover:bg-emerald-600 disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
      {error && (
        <p className="border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
