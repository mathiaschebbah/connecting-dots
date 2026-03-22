import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Search, Settings } from "lucide-react";
import { useAppStore, type Lens } from "../stores/appStore";

const LENSES: { id: Lens; label: string }[] = [
  { id: "river", label: "River" },
  { id: "clusters", label: "Clusters" },
  { id: "graph", label: "Graph" },
  { id: "boards", label: "Boards" },
];

interface SyncEvent {
  worker: string;
  status: string;
  detail: string | null;
}

interface CortexBarProps {
  onSettingsOpen: () => void;
}

export function CortexBar({ onSettingsOpen }: CortexBarProps) {
  const lens = useAppStore((s) => s.lens);
  const setLens = useAppStore((s) => s.setLens);
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const [syncing, setSyncing] = useState(false);
  const [lastDetail, setLastDetail] = useState<string | null>(null);

  useEffect(() => {
    let activeWorkers = 0;
    const unlisten = listen<SyncEvent>("sync:event", (event) => {
      if (event.payload.status === "start") {
        activeWorkers++;
        setSyncing(true);
      } else {
        activeWorkers = Math.max(0, activeWorkers - 1);
        if (activeWorkers === 0) setSyncing(false);
        if (event.payload.detail) {
          setLastDetail(event.payload.detail);
          setTimeout(() => setLastDetail(null), 3000);
        }
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  return (
    <div className="h-10 flex items-center gap-4 px-4 border-b border-zinc-200 bg-white shrink-0">
      {/* Logo */}
      <span className="text-[13px] font-semibold tracking-tight text-zinc-900 shrink-0">
        Connecting Dots
      </span>

      {/* Pulse — connected to real sync events */}
      <div className="flex items-center gap-1.5 shrink-0">
        <div className={`w-1.5 h-1.5 rounded-full ${syncing ? "bg-emerald-500 animate-pulse" : "bg-emerald-400"}`} />
        <span className={`text-[10px] ${syncing ? "text-emerald-600" : "text-emerald-500"}`}>
          {syncing ? "Syncing" : "Live"}
        </span>
        {lastDetail && (
          <span className="text-[9px] text-zinc-400 ml-0.5">{lastDetail}</span>
        )}
      </div>

      {/* Lens switcher */}
      <div className="flex bg-zinc-100 rounded-md p-0.5 border border-zinc-200">
        {LENSES.map((l) => (
          <button
            key={l.id}
            onClick={() => setLens(l.id)}
            className={`px-3 py-1 text-[11px] font-medium rounded transition-all ${
              lens === l.id
                ? "bg-white text-zinc-900 shadow-sm"
                : "text-zinc-400 hover:text-zinc-600"
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>

      <div className="flex-1" />

      {/* Search trigger */}
      <button
        onClick={() => setSearchOpen(true)}
        className="flex items-center gap-2 px-3 py-1 bg-zinc-50 border border-zinc-200 rounded-md text-[12px] text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 transition-colors"
      >
        <Search size={14} />
        <span>Search</span>
        <kbd className="text-[10px] text-zinc-300 border border-zinc-200 bg-white px-1 py-0.5 rounded ml-2">
          ⌘K
        </kbd>
      </button>

      {/* Settings */}
      <button
        onClick={onSettingsOpen}
        className="text-zinc-400 hover:text-zinc-700 p-1 rounded-md hover:bg-zinc-100 transition-colors"
      >
        <Settings size={16} />
      </button>
    </div>
  );
}
