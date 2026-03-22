import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Search, LayoutList, LayoutGrid } from "lucide-react";
import { TweetCard, TweetRow as TweetRowView, CAT_COLORS, type Tweet } from "../components/TweetCard";
import { TweetDetail } from "../components/TweetDetail";

type SearchMode = "fulltext" | "semantic";
type ViewMode = "cards" | "list";

export function Bookmarks() {
  const [tweets, setTweets] = useState<Tweet[]>([]);
  const [query, setQuery] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("fulltext");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const loadAll = async () => {
    setLoading(true);
    try {
      const results = await invoke<Tweet[]>("list_tweets", { limit: 500, offset: 0, source: "bookmark" });
      setTweets(results);
      setTotal(results.length);
    } catch (err) {
      console.error("Failed to load tweets:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) { loadAll(); return; }
    setLoading(true);
    setActiveCategory(null);
    try {
      const command = searchMode === "semantic" ? "search_semantic" : "search_tweets";
      const results = await invoke<Tweet[]>(command, { query: query.trim(), limit: 50, source: "bookmark" });
      setTweets(results);
    } catch (err) {
      console.error("Search failed:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  // Category counts from loaded tweets
  const catCounts = new Map<string, number>();
  tweets.forEach((t) => {
    if (t.ai_category) catCounts.set(t.ai_category, (catCounts.get(t.ai_category) || 0) + 1);
  });
  const categories = [...catCounts.entries()].sort((a, b) => b[1] - a[1]);

  const filtered = activeCategory
    ? tweets.filter((t) => t.ai_category === activeCategory)
    : tweets;

  return (
    <div className="h-full flex">
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className={viewMode === "list" ? "max-w-5xl mx-auto" : "max-w-3xl mx-auto"}>
          <div className="mb-4 flex items-center gap-3">
            <h2 className="text-lg font-semibold tracking-tight text-zinc-900">Bookmarks</h2>
            <span className="text-[13px] text-zinc-400 tabular-nums">{total}</span>
            <div className="ml-auto flex items-center gap-1 bg-zinc-100 rounded-md p-0.5 border border-zinc-200">
              <button
                onClick={() => setViewMode("cards")}
                className={`p-1 rounded transition-all ${viewMode === "cards" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-400 hover:text-zinc-600"}`}
              >
                <LayoutGrid size={14} />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`p-1 rounded transition-all ${viewMode === "list" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-400 hover:text-zinc-600"}`}
              >
                <LayoutList size={14} />
              </button>
            </div>
          </div>

          <form onSubmit={handleSearch} className="flex gap-2 mb-4">
            <div className="flex-1 relative group">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-violet-600 transition-colors" />
              <input
                type="text" value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder={searchMode === "semantic" ? "Describe what you're looking for..." : "Search tweets..."}
                className="w-full pl-9 pr-4 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-[13px] text-zinc-900 placeholder-zinc-400 focus:outline-none focus:bg-white focus:border-violet-600 focus:ring-1 focus:ring-violet-600/20 transition-all"
              />
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
          </form>

          {/* Category filter */}
          {categories.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mb-4">
              <button
                onClick={() => setActiveCategory(null)}
                className={`text-[11px] font-medium px-2 py-1 rounded-md border transition-colors ${
                  !activeCategory
                    ? "bg-violet-100 text-violet-700 border-violet-200"
                    : "border-zinc-200 text-zinc-500 bg-white hover:border-zinc-300"
                }`}
              >
                All
              </button>
              {categories.map(([cat, count]) => {
                const color = CAT_COLORS[cat] || "#71717A";
                const active = activeCategory === cat;
                return (
                  <button
                    key={cat}
                    onClick={() => setActiveCategory(active ? null : cat)}
                    className={`text-[11px] font-medium px-2 py-1 rounded-md border transition-colors inline-flex items-center gap-1 ${
                      active ? "border-current" : "border-zinc-200 bg-white hover:border-zinc-300"
                    }`}
                    style={active ? { backgroundColor: color + "15", color, borderColor: color + "40" } : {}}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                    {cat}
                    <span className={active ? "opacity-60" : "text-zinc-300"}>{count}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className={viewMode === "list" ? "space-y-1" : "space-y-2"}>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-4 h-4 border-2 border-zinc-200 border-t-zinc-900 rounded-full animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-[13px] text-zinc-400 py-12 text-center">
                {query ? "No results." : "No bookmarks yet. They'll appear here as the background sync runs."}
              </div>
            ) : viewMode === "list" ? (
              filtered.map((tweet) => (
                <div key={tweet.id} onClick={() => setSelectedId(tweet.id)}>
                  <TweetRowView tweet={tweet} />
                </div>
              ))
            ) : (
              filtered.map((tweet) => (
                <div key={tweet.id} onClick={() => setSelectedId(tweet.id)}>
                  <TweetCard tweet={tweet} />
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {selectedId && (
        <TweetDetail
          tweetId={selectedId}
          onClose={() => setSelectedId(null)}
          onNavigate={(id) => setSelectedId(id)}
        />
      )}
    </div>
  );
}
