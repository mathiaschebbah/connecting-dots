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
      const results = await invoke<Tweet[]>("list_tweets", { limit: 50, offset: 0 });
      setTweets(results);
      const count = await invoke<number>("get_tweet_count");
      setTotal(count);
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
      const results = await invoke<Tweet[]>(command, { query: query.trim(), limit: 30 });
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
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-white">
          Bookmarks
          <span className="text-neutral-500 font-normal text-sm ml-2">
            {total} tweets
          </span>
        </h2>
      </div>

      {/* Search bar */}
      <form onSubmit={handleSearch} className="flex gap-2 mb-6">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            searchMode === "semantic"
              ? "Describe what you're looking for..."
              : "Search tweets..."
          }
          className="flex-1 px-4 py-2.5 bg-neutral-900 border border-neutral-800 rounded-lg text-white placeholder-neutral-600 text-sm focus:outline-none focus:border-neutral-600 transition-colors"
        />
        <div className="flex rounded-lg border border-neutral-800 overflow-hidden">
          <button
            type="button"
            onClick={() => setSearchMode("fulltext")}
            className={`px-3 py-2.5 text-xs transition-colors ${
              searchMode === "fulltext"
                ? "bg-neutral-800 text-white"
                : "bg-neutral-900 text-neutral-500 hover:text-neutral-300"
            }`}
          >
            Exact
          </button>
          <button
            type="button"
            onClick={() => setSearchMode("semantic")}
            className={`px-3 py-2.5 text-xs transition-colors ${
              searchMode === "semantic"
                ? "bg-neutral-800 text-white"
                : "bg-neutral-900 text-neutral-500 hover:text-neutral-300"
            }`}
          >
            Semantic
          </button>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2.5 bg-white text-neutral-950 rounded-lg text-sm font-medium hover:bg-neutral-200 disabled:opacity-50 transition-colors"
        >
          Search
        </button>
      </form>

      {/* Results */}
      <div className="space-y-3">
        {loading ? (
          <div className="text-sm text-neutral-600 py-8 text-center">
            Searching...
          </div>
        ) : tweets.length === 0 ? (
          <div className="text-sm text-neutral-600 py-8 text-center">
            {query
              ? "No results found."
              : "No tweets yet. They'll appear here once the sync runs."}
          </div>
        ) : (
          tweets.map((tweet) => <TweetCard key={tweet.id} tweet={tweet} />)
        )}
      </div>
    </div>
  );
}
