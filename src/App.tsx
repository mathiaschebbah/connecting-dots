import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "./stores/appStore";
import { CortexBar } from "./components/CortexBar";
import { TopicRibbon } from "./components/TopicRibbon";
import { FocusPanel } from "./components/FocusPanel";
import { SettingsModal } from "./components/SettingsModal";
import { UnifiedSearch } from "./components/UnifiedSearch";
import { ApiKeyGate } from "./pages/ApiKeyGate";
import { ActivityFeed } from "./components/ActivityFeed";
import { River } from "./lenses/River";
import { Clusters } from "./lenses/Clusters";
import { Graph } from "./lenses/Graph";
import { Boards } from "./lenses/Boards";
import { Agent } from "./pages/Agent";
import { Pinned } from "./pages/Pinned";

const LENSES = {
  river: River,
  clusters: Clusters,
  graph: Graph,
  boards: Boards,
  agent: Agent,
  pinned: Pinned,
} as const;

function App() {
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const lens = useAppStore((s) => s.lens);

  useEffect(() => {
    invoke<boolean>("check_api_key").then(setHasApiKey).catch(() => setHasApiKey(false));
  }, []);

  // Cmd+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        useAppStore.getState().setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  if (hasApiKey === null) {
    return (
      <div className="h-screen w-screen bg-zinc-50 flex flex-col items-center justify-center gap-3">
        <div className="w-5 h-5 border-2 border-zinc-200 border-t-violet-600 rounded-full animate-spin" />
        <span className="text-[12px] text-zinc-400">Initialisation du moteur de pensée...</span>
      </div>
    );
  }

  if (!hasApiKey) {
    return <ApiKeyGate onAuthenticated={() => setHasApiKey(true)} />;
  }

  const LensComponent = LENSES[lens];

  return (
    <div className="flex flex-col h-screen bg-zinc-50 text-zinc-900 overflow-hidden">
      <CortexBar onSettingsOpen={() => setSettingsOpen(true)} />
      <TopicRibbon />

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-hidden">
          <LensComponent />
        </div>
        <FocusPanel />
      </div>

      <ActivityFeed />
      <UnifiedSearch />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

export default App;
