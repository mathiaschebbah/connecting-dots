import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/appStore";
import { CAT_COLORS } from "./TweetCard";

interface CategoryCount {
  name: string;
  count: number;
}

interface DashboardStats {
  total_tweets: number;
  total_bookmarks: number;
  enriched_count: number;
  pending_enrichment: number;
  pending_embedding: number;
  categories: CategoryCount[];
  top_topics: [string, number][];
}

export function TopicRibbon() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const activeCategory = useAppStore((s) => s.activeCategory);
  const setActiveCategory = useAppStore((s) => s.setActiveCategory);
  const lens = useAppStore((s) => s.lens);

  useEffect(() => {
    invoke<DashboardStats>("get_dashboard_stats").then(setStats).catch(console.error);
    const i = setInterval(() => invoke<DashboardStats>("get_dashboard_stats").then(setStats).catch(console.error), 30000);
    return () => clearInterval(i);
  }, []);

  // Only show for River/Clusters lenses
  if (lens !== "river" && lens !== "clusters") return null;
  if (!stats || stats.categories.length === 0) return null;

  return (
    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-zinc-100 bg-white/80 backdrop-blur-sm shadow-sm overflow-x-auto shrink-0">
      <button
        onClick={() => setActiveCategory(null)}
        className={`text-[11px] font-medium px-2.5 py-1 rounded-full transition-all duration-200 ease-out shrink-0 flex items-center gap-1.5 ${
          !activeCategory
            ? "bg-violet-100 text-violet-700"
            : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
        }`}
      >
        Tout
        <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${!activeCategory ? "bg-violet-700/10" : "bg-zinc-200 text-zinc-500"}`}>
          {stats.total_tweets}
        </span>
      </button>
      {stats.categories.map((cat) => {
        const color = CAT_COLORS[cat.name] || "#71717A";
        const active = activeCategory === cat.name;
        return (
          <button
            key={cat.name}
            onClick={() => setActiveCategory(active ? null : cat.name)}
            className={`text-[11px] font-medium px-2.5 py-1 rounded-full transition-all duration-200 ease-out shrink-0 inline-flex items-center gap-2 ${
              active ? "" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
            }`}
            style={active ? { backgroundColor: `${color}15`, color: color } : {}}
          >
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
              {cat.name}
            </div>
            <span
              className={`text-[10px] px-1 rounded-full ${active ? "bg-current/10" : "text-zinc-400"}`}
            >
              {cat.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
