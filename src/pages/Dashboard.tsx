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
      const tweets = await invoke<Tweet[]>("list_tweets", { limit: 10, offset: 0 });
      setRecentTweets(tweets);
    } catch (err) {
      console.error("Failed to load data:", err);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-6 max-w-4xl">
      <h2 className="text-lg font-semibold text-white mb-6">Dashboard</h2>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="p-4 bg-neutral-900 rounded-lg border border-neutral-800">
          <div className="text-2xl font-bold text-white">{tweetCount}</div>
          <div className="text-xs text-neutral-500 mt-1">Tweets in DB</div>
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
            Syncing in background...
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
