import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Search, Settings, ChevronRight } from "lucide-react";
import { useAppStore } from "../stores/appStore";
import { dotName } from "../lib/utils";

interface SyncEvent { worker: string; status: string; detail: string | null }

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
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  return (
    <div className="h-[53px] flex items-center gap-3 px-4 border-b border-border shrink-0 bg-background/80 backdrop-blur-md">
      <button onClick={() => navigate({ type: "dots" })} className="shrink-0" aria-label="Accueil">
        <span className="text-[15px] font-bold text-foreground">Connecting Dots</span>
      </button>

      {(page.type === "dot" || page.type === "tweet") && (
        <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground min-w-0">
          <ChevronRight size={12} className="shrink-0" />
          {page.type === "dot" && (
            <span className="text-foreground font-medium truncate">{dotName(page.slug)}</span>
          )}
          {page.type === "tweet" && page.fromDot && (
            <button
              onClick={() => navigate({ type: "dot", slug: page.fromDot! })}
              className="text-foreground hover:underline font-medium truncate"
              aria-label="Retour au sujet"
            >
              {dotName(page.fromDot)}
            </button>
          )}
        </div>
      )}

      {syncing && (
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#1d9bf0] opacity-50" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-[#1d9bf0]" />
        </span>
      )}

      <div className="flex-1" />

      <button onClick={() => setSearchOpen(true)} className="p-2 text-muted-foreground hover:text-foreground transition-colors rounded-full hover:bg-white/[0.08]" aria-label="Rechercher">
        <Search size={18} />
      </button>

      <button onClick={() => setSettingsOpen(true)} className="p-2 text-muted-foreground hover:text-foreground transition-colors rounded-full hover:bg-white/[0.08]" aria-label="Parametres">
        <Settings size={18} />
      </button>
    </div>
  );
}
