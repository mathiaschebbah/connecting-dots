import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TweetCard, CAT_COLORS, type Tweet } from "../components/TweetCard";
import { TweetDetail } from "../components/TweetDetail";

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

export function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentTweets, setRecentTweets] = useState<Tweet[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadData = async () => {
    try {
      const [s, tweets] = await Promise.all([
        invoke<DashboardStats>("get_dashboard_stats"),
        invoke<Tweet[]>("list_tweets", { limit: 15, offset: 0 }),
      ]);
      setStats(s);
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

  const maxCat = stats?.categories?.[0]?.count || 1;

  return (
    <div className="h-full flex">
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="max-w-4xl mx-auto">
          {/* Header with inline stats */}
          <div className="mb-6">
            <h2 className="text-lg font-semibold tracking-tight text-zinc-900 mb-1">Dashboard</h2>
            {stats && (
              <div className="flex items-center gap-4 text-[12px] text-zinc-500">
                <span>{stats.total_tweets} tweets</span>
                <span className="text-zinc-300">/</span>
                <span>{stats.total_bookmarks} bookmarks</span>
                <span className="text-zinc-300">/</span>
                <span>{stats.enriched_count} enriched</span>
                {stats.pending_enrichment > 0 && (
                  <>
                    <span className="text-zinc-300">/</span>
                    <span className="text-amber-600">{stats.pending_enrichment} pending</span>
                  </>
                )}
                <span className="flex items-center gap-1.5 ml-auto">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-emerald-600">Syncing</span>
                </span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-12 gap-6">
            {/* Left: Topic map + recent */}
            <div className="col-span-8">
              {/* Category breakdown */}
              {stats && stats.categories.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-[12px] font-medium text-zinc-500 mb-3">Topic map</h3>
                  <div className="space-y-1.5">
                    {stats.categories.map((cat) => {
                      const color = CAT_COLORS[cat.name] || "#71717A";
                      const pct = Math.round((cat.count / maxCat) * 100);
                      return (
                        <div key={cat.name} className="flex items-center gap-3">
                          <span className="text-[12px] text-zinc-700 w-24 text-right truncate">{cat.name}</span>
                          <div className="flex-1 h-5 bg-zinc-100 rounded overflow-hidden">
                            <div
                              className="h-full rounded transition-all"
                              style={{ width: `${pct}%`, backgroundColor: color + "30" }}
                            />
                          </div>
                          <span className="text-[11px] text-zinc-400 w-8 text-right tabular-nums">{cat.count}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Recent feed */}
              <div>
                <h3 className="text-[12px] font-medium text-zinc-500 mb-3">Recent</h3>
                <div className="space-y-2">
                  {recentTweets.length === 0 ? (
                    <div className="text-[13px] text-zinc-400 py-8 text-center">Syncing in background...</div>
                  ) : (
                    recentTweets.map((tweet) => (
                      <div key={tweet.id} onClick={() => setSelectedId(tweet.id)}>
                        <TweetCard tweet={tweet} compact />
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Right: Topics + pipeline */}
            <div className="col-span-4 space-y-6">
              {/* Top topics */}
              {stats && stats.top_topics.length > 0 && (
                <div>
                  <h3 className="text-[12px] font-medium text-zinc-500 mb-3">Trending topics</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {stats.top_topics.slice(0, 15).map(([topic, count]) => (
                      <span
                        key={topic}
                        className="text-[11px] font-medium px-2 py-1 rounded-md border border-zinc-200 text-zinc-600 bg-white hover:border-violet-300 hover:text-violet-700 cursor-pointer transition-colors"
                      >
                        {topic} <span className="text-zinc-300">{count}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Pipeline status */}
              {stats && (
                <div>
                  <h3 className="text-[12px] font-medium text-zinc-500 mb-3">Pipeline</h3>
                  <div className="space-y-2">
                    <PipelineRow label="Enrichment" done={stats.enriched_count} total={stats.total_tweets} />
                    <PipelineRow label="Embeddings" done={stats.total_tweets - stats.pending_embedding} total={stats.total_tweets} />
                  </div>
                </div>
              )}
            </div>
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

function PipelineRow({ label, done, total }: { label: string; done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="text-zinc-600">{label}</span>
        <span className="text-zinc-400 tabular-nums">{done}/{total}</span>
      </div>
      <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-violet-500 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
