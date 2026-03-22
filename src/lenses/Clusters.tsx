import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/appStore";
import { TweetCard, CAT_COLORS, type Tweet } from "../components/TweetCard";
import { ChevronLeft } from "lucide-react";

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

export function Clusters() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [tweetsByCat, setTweetsByCat] = useState<Record<string, Tweet[]>>({});
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const [expandedTweets, setExpandedTweets] = useState<Tweet[]>([]);
  const pushFocus = useAppStore((s) => s.pushFocus);
  const activeCategory = useAppStore((s) => s.activeCategory);

  const load = async () => {
    try {
      const s = await invoke<DashboardStats>("get_dashboard_stats");
      setStats(s);

      // Load top tweets per category using the proper filter
      const map: Record<string, Tweet[]> = {};
      for (const cat of s.categories) {
        const tweets = await invoke<Tweet[]>("list_tweets_by_category", { category: cat.name, limit: 5 });
        map[cat.name] = tweets;
      }
      setTweetsByCat(map);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => { load(); }, []);

  const expandCategory = async (catName: string) => {
    setExpandedCat(catName);
    try {
      const tweets = await invoke<Tweet[]>("list_tweets_by_category", { category: catName, limit: 200 });
      setExpandedTweets(tweets);
    } catch (e) {
      console.error(e);
    }
  };

  if (!stats || stats.categories.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-[13px] text-zinc-500">Waiting for enrichment...</p>
          <p className="text-[12px] text-zinc-400 mt-1">Tweets are being categorized by the AI. Clusters will appear here.</p>
        </div>
      </div>
    );
  }

  // Filter categories if Topic Ribbon active
  const visibleCategories = activeCategory
    ? stats.categories.filter((c) => c.name === activeCategory)
    : stats.categories;

  // Expanded single-category view
  if (expandedCat) {
    const color = CAT_COLORS[expandedCat] || "#71717A";
    return (
      <div className="h-full overflow-y-auto px-6 py-4">
        <div className="max-w-3xl mx-auto">
          <button
            onClick={() => { setExpandedCat(null); setExpandedTweets([]); }}
            className="flex items-center gap-1 text-[12px] text-zinc-500 hover:text-zinc-900 mb-3 transition-colors"
          >
            <ChevronLeft size={14} /> All clusters
          </button>
          <div className="flex items-center gap-2 mb-4">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
            <h2 className="text-lg font-semibold tracking-tight" style={{ color }}>
              {expandedCat}
            </h2>
            <span className="text-[13px] text-zinc-400">{expandedTweets.length}</span>
          </div>
          <div className="space-y-2">
            {expandedTweets.map((t) => (
              <div key={t.id} onClick={() => pushFocus({ type: "tweet", id: t.id })}>
                <TweetCard tweet={t} />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-x-auto overflow-y-auto p-4">
      <div className="flex gap-3 min-h-full">
        {visibleCategories.map((cat) => {
          const color = CAT_COLORS[cat.name] || "#71717A";
          const tweets = tweetsByCat[cat.name] || [];
          return (
            <div key={cat.name} className="w-[300px] shrink-0 flex flex-col">
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-t-lg border border-zinc-200 border-b-0 bg-white border-l-2"
                style={{ borderLeftColor: color }}
              >
                <span className="text-[13px] font-medium text-zinc-900">{cat.name}</span>
                <span className="text-[11px] text-zinc-400 ml-auto">{cat.count}</span>
              </div>

              <div className="flex-1 bg-zinc-50 border border-zinc-200 rounded-b-lg p-2 space-y-2 overflow-y-auto">
                {tweets.map((t) => (
                  <div key={t.id} onClick={() => pushFocus({ type: "tweet", id: t.id })}>
                    <TweetCard tweet={t} compact />
                  </div>
                ))}
                {tweets.length === 0 && (
                  <div className="text-[11px] text-zinc-400 py-4 text-center">Loading...</div>
                )}
                {cat.count > 5 && (
                  <button
                    onClick={() => expandCategory(cat.name)}
                    className="w-full py-2 text-[11px] text-violet-600 font-medium hover:bg-zinc-100 rounded-md transition-colors"
                  >
                    +{cat.count - tweets.length} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
