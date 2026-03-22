import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Search, Settings, Brain, Cpu, Link2, Sparkles, Bot, Users } from "lucide-react";
import { useAppStore, type Lens } from "../stores/appStore";

const LENSES: { id: Lens; label: string }[] = [
  { id: "river", label: "Flux" },
  { id: "clusters", label: "Clusters" },
  { id: "graph", label: "Réseau" },
  { id: "boards", label: "Tableaux" },
];

interface SyncEvent {
  worker: string;
  status: string;
  detail: string | null;
}

interface WorkerState {
  active: boolean;
  lastDetail: string | null;
}

interface CortexBarProps {
  onSettingsOpen: () => void;
}

const WORKER_ICONS: Record<string, typeof Brain> = {
  bookmarks: Brain,
  feed: Brain,
  enricher: Sparkles,
  resolver: Link2,
  topics: Cpu,
};

const WORKER_LABELS: Record<string, string> = {
  bookmarks: "Signets",
  feed: "Flux",
  enricher: "IA",
  resolver: "Liens",
  topics: "Sujets",
};

export function CortexBar({ onSettingsOpen }: CortexBarProps) {
  const lens = useAppStore((s) => s.lens);
  const setLens = useAppStore((s) => s.setLens);
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const [workers, setWorkers] = useState<Record<string, WorkerState>>({});

  useEffect(() => {
    const unlisten = listen<SyncEvent>("sync:event", (event) => {
      const { worker, status, detail } = event.payload;
      setWorkers((prev) => ({
        ...prev,
        [worker]: {
          active: status === "start",
          lastDetail: detail || prev[worker]?.lastDetail || null,
        },
      }));

      // Clear detail after 4 seconds
      if (detail) {
        setTimeout(() => {
          setWorkers((prev) => ({
            ...prev,
            [worker]: { ...prev[worker], lastDetail: null },
          }));
        }, 4000);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const activeCount = Object.values(workers).filter((w) => w.active).length;
  const anyActive = activeCount > 0;

  return (
    <div className="h-12 flex items-center gap-4 px-5 bg-white/80 backdrop-blur-xl border-b border-zinc-200/60 sticky top-0 z-50 shrink-0 transition-all duration-200 ease-out">
      {/* Logo */}
      <span className="text-[14px] font-bold tracking-tight text-zinc-900 shrink-0">
        Connecting Dots
      </span>

      {/* Workers status — live activity indicators */}
      <div className="flex items-center gap-2 px-2 py-1 bg-zinc-50/50 rounded-full border border-zinc-100 shrink-0">
        <div className={`relative w-2 h-2 rounded-full transition-all duration-300 ${anyActive ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] animate-pulse" : "bg-emerald-400"}`} />
        <div className="flex items-center -space-x-1">
          {Object.entries(workers).map(([name, state]) => {
            const Icon = WORKER_ICONS[name] || Cpu;
            return (
              <div
                key={name}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-all duration-200 ease-out ${
                  state.active
                    ? "text-emerald-700 bg-emerald-100/50 shadow-sm"
                    : state.lastDetail
                    ? "text-violet-600"
                    : "text-zinc-400 opacity-40"
                }`}
                title={`${WORKER_LABELS[name] || name}: ${state.active ? "actif" : "en attente"}`}
              >
                <Icon size={11} className={state.active ? "animate-spin" : ""} />
                {state.active && state.lastDetail && (
                  <span className="max-w-[80px] truncate">{state.lastDetail}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Lens switcher */}
      <div className="flex bg-zinc-100/80 rounded-full p-1 border border-zinc-200/50">
        {LENSES.map((l) => (
          <button
            key={l.id}
            onClick={() => setLens(l.id)}
            className={`px-4 py-1 text-[11px] font-semibold rounded-full transition-all duration-200 ease-out ${
              lens === l.id
                ? "bg-white text-violet-600 shadow-sm ring-1 ring-zinc-200/50"
                : "text-zinc-500 hover:text-zinc-800 hover:bg-zinc-200/50"
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>

      <div className="flex-1" />

      {/* Action Group */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => setLens("agent")}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200 ease-out ${
            lens === "agent"
              ? "bg-violet-100 text-violet-700 shadow-sm"
              : "text-zinc-500 hover:text-violet-600 hover:bg-violet-50"
          }`}
        >
          <Bot size={15} />
          <span>Agent</span>
        </button>

        <button
          onClick={() => setLens("pinned")}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200 ease-out ${
            lens === "pinned"
              ? "bg-violet-100 text-violet-700 shadow-sm"
              : "text-zinc-500 hover:text-violet-600 hover:bg-violet-50"
          }`}
        >
          <Users size={15} />
          <span>Comptes</span>
        </button>
      </div>

      {/* Search trigger */}
      <button
        onClick={() => setSearchOpen(true)}
        className="group flex items-center gap-3 px-3 py-1.5 bg-white border border-zinc-200 rounded-lg text-[12px] text-zinc-500 shadow-sm hover:border-violet-300 hover:shadow-md transition-all duration-200 ease-out"
      >
        <Search size={15} className="group-hover:text-violet-500 transition-colors" />
        <span className="font-medium">Rechercher</span>
        <kbd className="text-[10px] font-bold text-zinc-400 border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 rounded-md ml-4 shadow-inner">
          ⌘K
        </kbd>
      </button>

      {/* Settings */}
      <button
        onClick={onSettingsOpen}
        className="text-zinc-400 hover:text-violet-600 p-2 rounded-lg hover:bg-violet-50 transition-all duration-200 ease-out"
      >
        <Settings size={18} />
      </button>
    </div>
  );
}
