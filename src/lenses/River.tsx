import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Search, LayoutList, LayoutGrid, TrendingUp, Zap, BookOpen } from "lucide-react";
import { useAppStore } from "../stores/appStore";
import { TweetCard, TweetRow as TweetRowView, type Tweet } from "../components/TweetCard";

type SearchMode = "fulltext" | "semantic";
type ViewMode = "cards" | "list";

interface CategoryCount { name: string; count: number; }
interface DashboardStats {
  total_tweets: number; total_bookmarks: number; enriched_count: number;
  pending_enrichment: number; pending_embedding: number;
  categories: CategoryCount[]; top_topics: [string, number][];
}

export function River() {
  const [tweets, setTweets] = useState<Tweet[]>([]);
  const [query, setQuery] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("fulltext");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const activeCategory = useAppStore((s) => s.activeCategory);
  const pushFocus = useAppStore((s) => s.pushFocus);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [results, s] = await Promise.all([
        invoke<Tweet[]>("list_tweets", { limit: 500, offset: 0 }),
        invoke<DashboardStats>("get_dashboard_stats"),
      ]);
      setTweets(results);
      setStats(s);
    } catch (err) {
      console.error("Failed to load:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) { loadAll(); return; }
    setLoading(true);
    try {
      const command = searchMode === "semantic" ? "search_semantic" : "search_tweets";
      const results = await invoke<Tweet[]>(command, { query: query.trim(), limit: 50 });
      setTweets(results);
    } catch (err) {
      console.error("Search failed:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); const i = setInterval(loadAll, 15000); return () => clearInterval(i); }, []);

  const filtered = activeCategory ? tweets.filter((t) => t.ai_category === activeCategory) : tweets;

  // Group by time
  const now = Date.now();
  const groups: { label: string; tweets: Tweet[] }[] = [];
  const hourAgo = now - 3600_000;
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const weekAgo = now - 7 * 86400_000;

  const lastHour: Tweet[] = [], today: Tweet[] = [], thisWeek: Tweet[] = [], older: Tweet[] = [];
  for (const t of filtered) {
    const ts = t.created_at ? new Date(t.created_at).getTime() : 0;
    if (ts > hourAgo) lastHour.push(t);
    else if (ts > dayStart.getTime()) today.push(t);
    else if (ts > weekAgo) thisWeek.push(t);
    else older.push(t);
  }
  if (lastHour.length) groups.push({ label: `Last hour`, tweets: lastHour });
  if (today.length) groups.push({ label: `Today`, tweets: today });
  if (thisWeek.length) groups.push({ label: `This week`, tweets: thisWeek });
  if (older.length) groups.push({ label: `Older`, tweets: older });

  // Compute digest stats
  const signalCounts = { high: 0, mid: 0, low: 0 };
  const typeMap: Record<string, number> = {};
  for (const t of filtered) {
    const tp = t.ai_type || "";
    if (["tutorial", "announcement", "showcase", "thread"].includes(tp)) signalCounts.high++;
    else if (["news", "discussion", "question"].includes(tp)) signalCounts.mid++;
    else if (tp) signalCounts.low++;
    if (tp) typeMap[tp] = (typeMap[tp] || 0) + 1;
  }
  const topTypes = Object.entries(typeMap).sort((a, b) => b[1] - a[1]).slice(0, 3);

  return (
    <div className="h-full overflow-y-auto px-6 py-4">
      <div className={viewMode === "list" ? "max-w-5xl mx-auto" : "max-w-3xl mx-auto"}>

        {/* Brain Digest */}
        {stats && !query && (
          <div className="mb-5 p-4 bg-white border border-zinc-200 rounded-lg">
            <div className="flex items-start gap-6">
              {/* Signal breakdown */}
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <Zap size={14} className="text-violet-600" />
                  <span className="text-[12px] font-semibold text-zinc-900">Brain Digest</span>
                  <span className="text-[11px] text-zinc-400">{filtered.length} tweets</span>
                </div>
                <div className="flex items-center gap-4 text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="text-zinc-600">{signalCounts.high} high signal</span>
                    <span className="text-zinc-400">(tutorials, announcements, threads)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-zinc-400" />
                    <span className="text-zinc-600">{signalCounts.mid} mid</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-zinc-200" />
                    <span className="text-zinc-600">{signalCounts.low} noise</span>
                  </div>
                </div>
              </div>

              {/* Trending topics */}
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <TrendingUp size={12} className="text-zinc-500" />
                  <span className="text-[11px] font-medium text-zinc-500">Trending</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {stats.top_topics.slice(0, 6).map(([topic, count]) => (
                    <span key={topic} className="text-[10px] text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-50 border border-zinc-100">
                      {topic} <span className="text-zinc-300">{count}</span>
                    </span>
                  ))}
                </div>
              </div>

              {/* Content types */}
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <BookOpen size={12} className="text-zinc-500" />
                  <span className="text-[11px] font-medium text-zinc-500">Types</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {topTypes.map(([type, count]) => (
                    <span key={type} className="text-[10px] text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-50 border border-zinc-100 capitalize">
                      {type} <span className="text-zinc-300">{count}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Search + controls */}
        <form onSubmit={handleSearch} className="flex gap-2 mb-4">
          <div className="flex-1 relative group">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-violet-600 transition-colors" />
            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={searchMode === "semantic" ? "Describe what you're looking for..." : "Search tweets..."}
              className="w-full pl-9 pr-4 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-[13px] text-zinc-900 placeholder-zinc-400 focus:outline-none focus:bg-white focus:border-violet-600 focus:ring-1 focus:ring-violet-600/20 transition-all" />
          </div>
          <div className="flex bg-zinc-100 rounded-md p-0.5 border border-zinc-200">
            <button type="button" onClick={() => setSearchMode("fulltext")}
              className={`px-3 py-1 text-[11px] font-medium rounded transition-all ${searchMode === "fulltext" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-400 hover:text-zinc-600"}`}>
              Exact
            </button>
            <button type="button" onClick={() => setSearchMode("semantic")}
              className={`px-3 py-1 text-[11px] font-medium rounded transition-all ${searchMode === "semantic" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-400 hover:text-zinc-600"}`}>
              Semantic
            </button>
          </div>
          <div className="flex bg-zinc-100 rounded-md p-0.5 border border-zinc-200">
            <button type="button" onClick={() => setViewMode("cards")}
              className={`p-1 rounded transition-all ${viewMode === "cards" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-400 hover:text-zinc-600"}`}>
              <LayoutGrid size={14} />
            </button>
            <button type="button" onClick={() => setViewMode("list")}
              className={`p-1 rounded transition-all ${viewMode === "list" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-400 hover:text-zinc-600"}`}>
              <LayoutList size={14} />
            </button>
          </div>
        </form>

        {/* Feed */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-4 h-4 border-2 border-zinc-200 border-t-zinc-900 rounded-full animate-spin" />
          </div>
        ) : groups.length === 0 ? (
          <div className="text-[13px] text-zinc-400 py-12 text-center">
            {query ? "No results." : "Your brain is syncing. Tweets will appear here automatically."}
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="mb-6">
              <div className="flex items-center gap-2 text-[12px] font-medium text-zinc-400 mb-2 sticky top-0 bg-zinc-50 py-1 z-10">
                {group.label}
                <span className="text-zinc-300">{group.tweets.length}</span>
              </div>
              <div className={viewMode === "list" ? "space-y-1" : "space-y-2"}>
                {group.tweets.map((tweet) => (
                  <div key={tweet.id} onClick={() => pushFocus({ type: "tweet", id: tweet.id })}>
                    {viewMode === "list" ? <TweetRowView tweet={tweet} /> : <TweetCard tweet={tweet} compact />}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
