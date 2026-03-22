import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "./stores/appStore";
import { CortexBar } from "./components/CortexBar";
import { SettingsModal } from "./components/SettingsModal";
import { UnifiedSearch } from "./components/UnifiedSearch";
import { ApiKeyGate } from "./pages/ApiKeyGate";
import { DotsGrid } from "./pages/DotsGrid";
import { DotDetail } from "./pages/DotDetail";
import { TweetPage } from "./pages/TweetPage";
import { Agent } from "./pages/Agent";

function App() {
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const page = useAppStore((s) => s.page);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);

  useEffect(() => {
    invoke<boolean>("check_api_key")
      .then(setHasApiKey)
      .catch(() => setHasApiKey(false));
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        useAppStore.getState().setSearchOpen(true);
      }
      if (e.key === "Escape") {
        const state = useAppStore.getState();
        if (state.searchOpen) {
          state.setSearchOpen(false);
        } else if (page.type !== "dots") {
          state.back();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [page]);

  if (hasApiKey === null) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-bg">
        <div className="w-4 h-4 border-2 border-border border-t-fg rounded-full animate-spin" />
      </div>
    );
  }

  if (!hasApiKey) {
    return <ApiKeyGate onAuthenticated={() => setHasApiKey(true)} />;
  }

  let content: React.ReactNode;
  switch (page.type) {
    case "dots":
      content = <DotsGrid />;
      break;
    case "dot":
      content = <DotDetail slug={page.slug} />;
      break;
    case "tweet":
      content = <TweetPage tweetId={page.id} fromDot={page.fromDot} />;
      break;
    case "agent":
      content = <Agent />;
      break;
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-bg text-fg">
      <CortexBar />
      <div className="flex-1 overflow-hidden flex flex-col">
        {content}
      </div>
      <UnifiedSearch />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

export default App;
