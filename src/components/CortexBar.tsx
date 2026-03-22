import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Search, Settings, Bot, ChevronRight } from "lucide-react";
import { useAppStore } from "../stores/appStore";
import { cn } from "../lib/utils";

interface SyncEvent {
  worker: string;
  status: string;
  detail: string | null;
}

export function CortexBar() {
  const page = useAppStore((s) => s.page);
  const navigate = useAppStore((s) => s.navigate);
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const unlisten = listen<SyncEvent>("sync:event", (event) => {
      setSyncing(event.payload.status === "start");
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <div className="h-11 flex items-center gap-3 px-5 border-b border-border shrink-0 bg-bg">
      {/* Logo */}
      <button
        onClick={() => navigate({ type: "dots" })}
        className="flex items-center gap-2 shrink-0 group"
      >
        <span className="text-sm font-medium text-fg group-hover:text-white transition-colors">
          Connecting Dots
        </span>
      </button>

      {/* Breadcrumb */}
      {(page.type === "dot" || page.type === "tweet") && (
        <div className="flex items-center gap-1.5 text-xs text-muted-fg">
          <ChevronRight size={11} />
          {page.type === "dot" && (
            <span className="text-fg/70 font-medium truncate max-w-[140px]">
              {page.slug}
            </span>
          )}
          {page.type === "tweet" && (
            <>
              {page.fromDot && (
                <>
                  <button
                    onClick={() => navigate({ type: "dot", slug: page.fromDot! })}
                    className="text-fg/70 hover:text-white font-medium truncate max-w-[100px] transition-colors"
                  >
                    {page.fromDot}
                  </button>
                  <ChevronRight size={9} />
                </>
              )}
              <span className="text-muted-fg">tweet</span>
            </>
          )}
        </div>
      )}

      {/* Sync indicator */}
      {syncing && (
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
      )}

      <div className="flex-1" />

      {/* Agent button */}
      <button
        onClick={() => navigate({ type: "agent" })}
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all",
          page.type === "agent"
            ? "bg-secondary text-fg"
            : "text-muted-fg hover:text-fg"
        )}
      >
        <Bot size={13} />
        Agent
      </button>

      {/* Search trigger */}
      <button
        onClick={() => setSearchOpen(true)}
        className="flex items-center gap-2 px-2.5 py-1 text-muted-fg hover:text-fg transition-colors"
      >
        <Search size={14} />
        <kbd className="text-[10px] font-mono font-medium text-muted-fg border border-border bg-secondary px-1.5 py-0.5 rounded">
          K
        </kbd>
      </button>

      {/* Settings */}
      <button
        onClick={() => setSettingsOpen(true)}
        className="text-muted-fg hover:text-fg p-1.5 rounded-md transition-colors"
      >
        <Settings size={15} />
      </button>
    </div>
  );
}
