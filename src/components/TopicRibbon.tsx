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

  // Don't show for Graph/Boards lenses
  if (lens === "graph" || lens === "boards") return null;
  if (!stats || stats.categories.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 px-4 py-1.5 border-b border-zinc-100 bg-white overflow-x-auto shrink-0">
      <button
        onClick={() => setActiveCategory(null)}
        className={`text-[11px] font-medium px-2 py-1 rounded-md border transition-colors shrink-0 ${
          !activeCategory
            ? "bg-violet-100 text-violet-700 border-violet-200"
            : "border-zinc-200 text-zinc-500 bg-white hover:border-zinc-300"
        }`}
      >
        All {stats.total_tweets}
      </button>
      {stats.categories.map((cat) => {
        const color = CAT_COLORS[cat.name] || "#71717A";
        const active = activeCategory === cat.name;
        return (
          <button
            key={cat.name}
            onClick={() => setActiveCategory(active ? null : cat.name)}
            className={`text-[11px] font-medium px-2 py-1 rounded-md border transition-colors shrink-0 inline-flex items-center gap-1 ${
              active ? "border-current" : "border-zinc-200 bg-white hover:border-zinc-300"
            }`}
            style={active ? { backgroundColor: color + "15", color, borderColor: color + "40" } : {}}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
            {cat.name}
            <span className={active ? "opacity-60" : "text-zinc-300"}>{cat.count}</span>
          </button>
        );
      })}
    </div>
  );
}
