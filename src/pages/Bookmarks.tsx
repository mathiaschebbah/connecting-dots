import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TweetCard, type Tweet } from "../components/TweetCard";

type SearchMode = "fulltext" | "semantic";

export function Bookmarks() {
  const [tweets, setTweets] = useState<Tweet[]>([]);
  const [query, setQuery] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("fulltext");
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);

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
    if (!query.trim()) {
      loadAll();
      return;
    }

    setLoading(true);
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

  useEffect(() => {
    loadAll();
  }, []);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6 flex items-baseline gap-3">
        <h2 className="text-xl font-semibold text-white/90">Bookmarks</h2>
        <span className="text-[13px] text-white/25 tabular-nums">{total}</span>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-2 mb-6">
        <div className="flex-1 relative">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/20" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchMode === "semantic" ? "Describe what you're looking for..." : "Search tweets..."}
            className="w-full pl-10 pr-4 py-2.5 bg-white/[0.04] border border-white/[0.06] rounded-xl text-[13px] text-white placeholder-white/20 focus:outline-none focus:border-violet-500/40 focus:bg-white/[0.06] transition-all"
          />
        </div>
        <div className="flex rounded-xl border border-white/[0.06] overflow-hidden">
          <button
            type="button"
            onClick={() => setSearchMode("fulltext")}
            className={`px-3.5 py-2.5 text-[12px] font-medium transition-all ${
              searchMode === "fulltext"
                ? "bg-white/[0.08] text-white"
                : "text-white/25 hover:text-white/50"
            }`}
          >
            Exact
          </button>
          <button
            type="button"
            onClick={() => setSearchMode("semantic")}
            className={`px-3.5 py-2.5 text-[12px] font-medium transition-all ${
              searchMode === "semantic"
                ? "bg-violet-500/20 text-violet-300"
                : "text-white/25 hover:text-white/50"
            }`}
          >
            Semantic
          </button>
        </div>
      </form>

      {/* Results */}
      <div className="space-y-2">
        {loading ? (
          <div className="text-[13px] text-white/20 py-12 text-center">
            Searching...
          </div>
        ) : tweets.length === 0 ? (
          <div className="text-[13px] text-white/20 py-12 text-center">
            {query ? "No results." : "No bookmarks yet. They'll appear here once synced."}
          </div>
        ) : (
          tweets.map((tweet) => <TweetCard key={tweet.id} tweet={tweet} />)
        )}
      </div>
    </div>
  );
}
