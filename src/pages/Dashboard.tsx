import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TweetCard, type Tweet } from "../components/TweetCard";

export function Dashboard() {
  const [tweetCount, setTweetCount] = useState<number>(0);
  const [recentTweets, setRecentTweets] = useState<Tweet[]>([]);

  const loadData = async () => {
    try {
      const count = await invoke<number>("get_tweet_count");
      setTweetCount(count);
      const tweets = await invoke<Tweet[]>("list_tweets", { limit: 20, offset: 0 });
      setRecentTweets(tweets);
    } catch (err) {
      console.error("Failed to load data:", err);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-8">
        <h2 className="text-xl font-semibold text-white/90 mb-1">Dashboard</h2>
        <p className="text-[13px] text-white/30">Your brain is syncing automatically</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-10">
        <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.05]">
          <div className="text-2xl font-bold text-white/90 tabular-nums">{tweetCount}</div>
          <div className="text-[11px] text-white/30 mt-1">Tweets indexed</div>
        </div>
        <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.05]">
          <div className="text-2xl font-bold text-violet-400 tabular-nums">298</div>
          <div className="text-[11px] text-white/30 mt-1">Bookmarks</div>
        </div>
        <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.05]">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-sm font-medium text-emerald-400">Active</span>
          </div>
          <div className="text-[11px] text-white/30 mt-1">Background sync</div>
        </div>
      </div>

      {/* Recent feed */}
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-[13px] font-medium text-white/50 uppercase tracking-wider">
          Latest from your feed
        </h3>
      </div>
      <div className="space-y-2">
        {recentTweets.length === 0 ? (
          <div className="text-[13px] text-white/20 py-12 text-center">
            Syncing in background...
          </div>
        ) : (
          recentTweets.map((tweet) => (
            <TweetCard key={tweet.id} tweet={tweet} compact />
          ))
        )}
      </div>
    </div>
  );
}
