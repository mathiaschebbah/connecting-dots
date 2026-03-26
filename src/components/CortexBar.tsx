import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Settings, ChevronRight, ChevronLeft, X as XIcon } from "lucide-react";
import { useAppStore } from "../stores/appStore";
import { dotName } from "../lib/utils";

interface SyncEvent { worker: string; status: string; detail: string | null }

export function CortexBar() {
  const page = useAppStore((s) => s.page);
  const navigate = useAppStore((s) => s.navigate);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const webviewOpen = useAppStore((s) => s.webviewOpen);
  const setWebviewOpen = useAppStore((s) => s.setWebviewOpen);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const unlisten = listen<SyncEvent>("sync:event", (event) => {
      setSyncing(event.payload.status === "start");
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  async function closeWebview() {
    try { await invoke("close_tweet_panel"); } catch {}
    setWebviewOpen(false);
  }

  return (
    <div className="h-[53px] flex items-center gap-3 px-4 border-b border-border shrink-0 bg-background">
      <button onClick={() => navigate({ type: "dots" })} className="shrink-0" aria-label="Accueil">
        <span className="text-[15px] font-bold text-foreground">Connecting Dots</span>
      </button>

      {page.type === "dot" && (
        <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground min-w-0">
          <ChevronRight size={12} className="shrink-0" />
          <span className="text-foreground font-medium truncate">{dotName(page.slug)}</span>
        </div>
      )}

      {webviewOpen && (
        <div className="flex items-center gap-0.5">
          <button onClick={() => invoke("webview_back")} className="p-1.5 text-muted-foreground hover:text-foreground transition-all duration-150 rounded-full hover:bg-white/[0.08] active:scale-90" aria-label="Retour">
            <ChevronLeft size={16} />
          </button>
          <button onClick={() => invoke("webview_forward")} className="p-1.5 text-muted-foreground hover:text-foreground transition-all duration-150 rounded-full hover:bg-white/[0.08] active:scale-90" aria-label="Suivant">
            <ChevronRight size={16} />
          </button>
          <button onClick={closeWebview} className="p-1.5 text-muted-foreground hover:text-foreground transition-all duration-150 rounded-full hover:bg-white/[0.08] active:scale-90" aria-label="Fermer">
            <XIcon size={16} />
          </button>
        </div>
      )}

      {syncing && (
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#1d9bf0] opacity-50" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-[#1d9bf0]" />
        </span>
      )}

      <div className="flex-1" />

      <button onClick={() => setSettingsOpen(true)} className="p-2 text-muted-foreground hover:text-foreground transition-colors rounded-full hover:bg-white/[0.08]" aria-label="Parametres">
        <Settings size={18} />
      </button>
    </div>
  );
}
