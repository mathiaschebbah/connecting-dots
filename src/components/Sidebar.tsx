import { NavLink } from "./NavLink";

const NAV_ITEMS = [
  { label: "Dashboard", path: "dashboard", icon: "⌂" },
  { label: "Bookmarks", path: "bookmarks", icon: "◉" },
  { label: "Kanban", path: "kanban", icon: "▦" },
  { label: "Network", path: "network", icon: "◈" },
  { label: "Pinned", path: "pinned", icon: "◎" },
  { label: "Agent", path: "agent", icon: "▷" },
] as const;

interface SidebarProps {
  currentPage: string;
  onNavigate: (page: string) => void;
}

export function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  return (
    <aside className="w-56 h-screen bg-neutral-900 border-r border-neutral-800 flex flex-col">
      <div className="p-4 border-b border-neutral-800">
        <h1 className="text-sm font-bold text-white tracking-wide">
          Connecting Dots
        </h1>
      </div>
      <nav className="flex-1 p-2 space-y-0.5">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.path}
            label={item.label}
            icon={item.icon}
            active={currentPage === item.path}
            onClick={() => onNavigate(item.path)}
          />
        ))}
      </nav>
      <div className="p-2 border-t border-neutral-800">
        <NavLink
          label="Settings"
          icon="⚙"
          active={currentPage === "settings"}
          onClick={() => onNavigate("settings")}
        />
      </div>
    </aside>
  );
}
