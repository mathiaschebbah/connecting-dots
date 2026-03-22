import React, { useState } from "react";
import { Sidebar } from "./components/Sidebar";
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
  const [currentPage, setCurrentPage] = useState("dashboard");
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
