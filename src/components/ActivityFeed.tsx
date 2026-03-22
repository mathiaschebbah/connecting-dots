import { useEffect, useState, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { Brain, Sparkles, Link2, Cpu, ChevronDown, ChevronUp } from "lucide-react";

interface SyncEvent {
  worker: string;
  status: string;
  detail: string | null;
}

interface ActivityItem {
  id: number;
  worker: string;
  detail: string;
  timestamp: number;
}

const WORKER_META: Record<string, { icon: typeof Brain; label: string; color: string }> = {
  bookmarks: { icon: Brain, label: "Signets", color: "#059669" },
  feed: { icon: Brain, label: "Flux", color: "#0891B2" },
  enricher: { icon: Sparkles, label: "Enrichissement IA", color: "#7C3AED" },
  resolver: { icon: Link2, label: "Résolution liens", color: "#EA580C" },
  topics: { icon: Cpu, label: "Sujets", color: "#2563EB" },
};

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return "à l'instant";
  if (diff < 3600000) return `il y a ${Math.floor(diff / 60000)}m`;
  return `il y a ${Math.floor(diff / 3600000)}h`;
}

export function ActivityFeed() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [expanded, setExpanded] = useState(true);
  const idRef = useRef(0);

  useEffect(() => {
    const unlisten = listen<SyncEvent>("sync:event", (event) => {
      const { worker, status, detail } = event.payload;
      if (status === "done" && detail) {
        const newItem: ActivityItem = {
          id: idRef.current++,
          worker,
          detail,
          timestamp: Date.now(),
        };
        setItems((prev) => [newItem, ...prev].slice(0, 50));
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="p-3 border-t border-zinc-100 bg-zinc-50/40">
      <div className={`bg-white border border-zinc-200/60 shadow-sm rounded-xl transition-all duration-300 ease-out overflow-hidden ${expanded ? 'ring-1 ring-zinc-100/50' : ''}`}>
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-[11px] text-zinc-600 hover:bg-zinc-50/80 transition-all duration-200 group"
        >
          <div className="relative flex items-center justify-center p-1.5 bg-violet-50 rounded-full">
            <div className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />
            <div className="absolute inset-0 w-full h-full rounded-full bg-violet-500/20 animate-ping" />
          </div>
          <span className="font-semibold tracking-tight text-zinc-700">Activité IA</span>
          <span className="px-1.5 py-0.5 bg-zinc-100 text-zinc-400 text-[10px] rounded-full font-bold tabular-nums">
            {items.length}
          </span>
          <div className="flex-1" />
          <div className={`flex items-center justify-center rounded-full px-2 py-1 transition-all duration-200 ${expanded ? 'bg-zinc-100 text-zinc-600' : 'text-zinc-400 group-hover:text-zinc-600'}`}>
            {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </div>
        </button>

        {expanded && (
          <div className="max-h-52 overflow-y-auto px-2 pb-2 space-y-1 border-t border-zinc-50">
            {items.slice(0, 15).map((item) => {
              const meta = WORKER_META[item.worker] || WORKER_META.enricher;
              const Icon = meta.icon;
              return (
                <div
                  key={item.id}
                  className="flex items-center gap-3 px-2.5 py-2 rounded-lg hover:bg-zinc-50 transition-all duration-200 group border border-transparent hover:border-zinc-100/50"
                >
                  <div
                    className="p-1.5 rounded-md flex items-center justify-center relative shrink-0"
                    style={{ backgroundColor: `${meta.color}15` }}
                  >
                    <div
                      className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full border border-white"
                      style={{ backgroundColor: meta.color }}
                    />
                    <Icon size={12} style={{ color: meta.color }} />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-zinc-600 truncate text-[10.5px] font-medium leading-tight mb-0.5">
                      {item.detail}
                    </span>
                    <span className="text-zinc-400 text-[9px] font-semibold tracking-wider uppercase opacity-70">
                      {timeAgo(item.timestamp)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
