import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Sidebar } from "./components/Sidebar";
import { ApiKeyGate } from "./pages/ApiKeyGate";
import { Dashboard } from "./pages/Dashboard";
import { Bookmarks } from "./pages/Bookmarks";
import { Kanban } from "./pages/Kanban";
import { Network } from "./pages/Network";
import { Pinned } from "./pages/Pinned";
import { Agent } from "./pages/Agent";
import { Settings } from "./pages/Settings";

const PAGES: Record<string, React.FC> = {
  dashboard: Dashboard,
  bookmarks: Bookmarks,
  kanban: Kanban,
  network: Network,
  pinned: Pinned,
  agent: Agent,
  settings: Settings,
};

function App() {
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [currentPage, setCurrentPage] = useState("dashboard");

  useEffect(() => {
    invoke<boolean>("check_api_key").then(setHasApiKey).catch(() => setHasApiKey(false));
  }, []);

  // Loading state
  if (hasApiKey === null) {
    return (
      <div className="h-screen w-screen bg-neutral-950 flex items-center justify-center">
        <div className="text-neutral-500 text-sm">Loading...</div>
      </div>
    );
  }

  // Gate: no API key
  if (!hasApiKey) {
    return <ApiKeyGate onAuthenticated={() => setHasApiKey(true)} />;
  }

  // Main app
  const Page = PAGES[currentPage] ?? Dashboard;

  return (
    <div className="flex h-screen bg-neutral-950 text-white">
      <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} />
      <main className="flex-1 overflow-auto">
        <Page />
      </main>
    </div>
  );
}

export default App;
