import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TweetCard, type Tweet } from "../components/TweetCard";

interface SyncResult {
  new_tweets: number;
  total_tweets: number;
}

export function Dashboard() {
  const [tweetCount, setTweetCount] = useState<number>(0);
  const [recentTweets, setRecentTweets] = useState<Tweet[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);

  const loadData = async () => {
    try {
      const count = await invoke<number>("get_tweet_count");
      setTweetCount(count);
      const tweets = await invoke<Tweet[]>("list_tweets", { limit: 10, offset: 0 });
      setRecentTweets(tweets);
    } catch (err) {
      console.error("Failed to load data:", err);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await invoke<SyncResult>("sync_bookmarks");
      setLastSync(`+${result.new_tweets} new, ${result.total_tweets} total`);
      await loadData();
    } catch (err) {
      console.error("Sync failed:", err);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    loadData();
    // Refresh every 30s
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-white">Dashboard</h2>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="px-4 py-2 text-sm bg-neutral-800 text-white rounded-lg hover:bg-neutral-700 disabled:opacity-50 transition-colors"
        >
          {syncing ? "Syncing..." : "Sync Now"}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="p-4 bg-neutral-900 rounded-lg border border-neutral-800">
          <div className="text-2xl font-bold text-white">{tweetCount}</div>
          <div className="text-xs text-neutral-500 mt-1">Tweets in DB</div>
        </div>
        <div className="p-4 bg-neutral-900 rounded-lg border border-neutral-800">
          <div className="text-2xl font-bold text-white">
            {lastSync || "—"}
          </div>
          <div className="text-xs text-neutral-500 mt-1">Last sync</div>
        </div>
        <div className="p-4 bg-neutral-900 rounded-lg border border-neutral-800">
          <div className="text-2xl font-bold text-green-400">Active</div>
          <div className="text-xs text-neutral-500 mt-1">Workers</div>
        </div>
      </div>

      {/* Recent tweets */}
      <h3 className="text-sm font-medium text-neutral-400 mb-3">
        Recent tweets
      </h3>
      <div className="space-y-3">
        {recentTweets.length === 0 ? (
          <div className="text-sm text-neutral-600 py-8 text-center">
            No tweets yet. Click "Sync Now" to fetch your bookmarks.
          </div>
        ) : (
          recentTweets.map((tweet) => (
            <TweetCard key={tweet.id} tweet={tweet} />
          ))
        )}
      </div>
    </div>
  );
}
