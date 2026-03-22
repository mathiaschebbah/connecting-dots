import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/appStore";
import { TweetCard, CAT_COLORS, type Tweet } from "../components/TweetCard";
import { ChevronLeft } from "lucide-react";

interface ClusterStat {
  cluster: string;
  category: string | null;
  count: number;
}

export function Clusters() {
  const [clusters, setClusters] = useState<ClusterStat[]>([]);
  const [tweetsByCluster, setTweetsByCluster] = useState<Record<string, Tweet[]>>({});
  const [expandedCluster, setExpandedCluster] = useState<string | null>(null);
  const [expandedTweets, setExpandedTweets] = useState<Tweet[]>([]);
  const [loading, setLoading] = useState(true);
  const pushFocus = useAppStore((s) => s.pushFocus);
  const activeCategory = useAppStore((s) => s.activeCategory);

  const load = async () => {
    try {
      const stats = await invoke<ClusterStat[]>("get_cluster_stats");
      setClusters(stats);

      // Load top 5 tweets per cluster in parallel (top 20 clusters)
      const top = stats.slice(0, 20);
      const results = await Promise.all(
        top.map((cs) => invoke<Tweet[]>("list_tweets_by_cluster", { cluster: cs.cluster, limit: 5 })
          .then((tweets) => ({ cluster: cs.cluster, tweets }))
          .catch(() => ({ cluster: cs.cluster, tweets: [] as Tweet[] }))
        )
      );
      const map: Record<string, Tweet[]> = {};
      for (const r of results) map[r.cluster] = r.tweets;
      setTweetsByCluster(map);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const expandCluster = async (clusterName: string) => {
    setExpandedCluster(clusterName);
    try {
      const tweets = await invoke<Tweet[]>("list_tweets_by_cluster", { cluster: clusterName, limit: 200 });
      setExpandedTweets(tweets);
    } catch (e) {
      console.error(e);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <div className="w-5 h-5 border-2 border-zinc-200 border-t-violet-600 rounded-full animate-spin" />
          <p className="text-[12px] text-zinc-400">Chargement des clusters...</p>
        </div>
      </div>
    );
  }

  if (clusters.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-[13px] text-zinc-500">En attente d'enrichissement...</p>
          <p className="text-[12px] text-zinc-400 mt-1">Les posts sont catégorisés par l'IA. Les clusters apparaîtront ici.</p>
        </div>
      </div>
    );
  }

  // Filter by activeCategory if set
  const visibleClusters = activeCategory
    ? clusters.filter((c) => c.category === activeCategory)
    : clusters;

  // Expanded single-cluster view
  if (expandedCluster) {
    const cs = clusters.find((c) => c.cluster === expandedCluster);
    const color = cs?.category ? CAT_COLORS[cs.category] || "#71717A" : "#71717A";
    return (
      <div className="h-full overflow-y-auto px-6 py-4">
        <div className="max-w-3xl mx-auto">
          <button
            onClick={() => { setExpandedCluster(null); setExpandedTweets([]); }}
            className="flex items-center gap-1 text-[12px] text-zinc-500 hover:text-zinc-900 mb-3 transition-colors"
          >
            <ChevronLeft size={14} /> Tous les clusters
          </button>
          <div className="flex items-center gap-2 mb-4">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
            <h2 className="text-lg font-semibold tracking-tight" style={{ color }}>
              {expandedCluster}
            </h2>
            {cs?.category && (
              <span className="text-[11px] text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-100">{cs.category}</span>
            )}
            <span className="text-[13px] text-zinc-400">{expandedTweets.length}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {expandedTweets.map((t) => (
              <div key={t.id} onClick={() => pushFocus({ type: "tweet", id: t.id })}>
                <TweetCard tweet={t} compact />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Group clusters by domain for visual organization
  const domainGroups = new Map<string, ClusterStat[]>();
  visibleClusters.forEach((cs) => {
    const domain = cs.category || "other";
    const arr = domainGroups.get(domain) || [];
    arr.push(cs);
    domainGroups.set(domain, arr);
  });

  return (
    <div className="h-full overflow-x-auto overflow-y-auto p-5">
      <div className="flex gap-4 min-h-full">
        {[...domainGroups.entries()].map(([domain, domainClusters]) => {
          const color = CAT_COLORS[domain] || "#71717A";
          return (
            <div key={domain} className="w-[320px] shrink-0 flex flex-col">
              {/* Domain header */}
              <div
                className="flex items-center gap-2.5 px-4 py-3 rounded-t-xl bg-white border border-zinc-200/60 border-b-0 shadow-sm border-l-[3px]"
                style={{ borderLeftColor: color }}
              >
                <span className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ backgroundColor: color }} />
                <span className="text-[12px] font-bold text-zinc-600 uppercase tracking-wider">{domain}</span>
                <span className="px-1.5 py-0.5 bg-zinc-100 text-zinc-400 text-[10px] rounded-full font-bold ml-auto">
                  {domainClusters.reduce((s, c) => s + c.count, 0)}
                </span>
              </div>

              {/* Clusters within domain */}
              <div className="flex-1 bg-zinc-50/50 border border-zinc-200/60 border-t-0 rounded-b-xl p-3 space-y-4 overflow-y-auto">
                {domainClusters.map((cs) => {
                  const tweets = tweetsByCluster[cs.cluster] || [];
                  return (
                    <div key={cs.cluster}>
                      {/* Cluster sub-header */}
                      <button
                        onClick={() => expandCluster(cs.cluster)}
                        className="w-full flex items-center gap-2 px-3 py-1.5 mb-2 rounded-lg hover:bg-white hover:shadow-sm transition-all duration-200 text-left"
                      >
                        <span className="text-[12px] font-semibold text-zinc-700">{cs.cluster}</span>
                        <span className="px-1.5 py-0.5 bg-zinc-100 text-zinc-400 text-[10px] rounded-full font-bold ml-auto">{cs.count}</span>
                      </button>

                      {/* Top tweets */}
                      <div className="space-y-2">
                        {tweets.slice(0, 3).map((t) => (
                          <div key={t.id} onClick={() => pushFocus({ type: "tweet", id: t.id })}>
                            <TweetCard tweet={t} compact />
                          </div>
                        ))}
                      </div>

                      {cs.count > 3 && (
                        <button
                          onClick={() => expandCluster(cs.cluster)}
                          className="w-full py-1.5 text-[11px] text-violet-600 font-semibold hover:bg-violet-50 rounded-lg transition-all duration-200 mt-2"
                        >
                          +{cs.count - Math.min(tweets.length, 3)} de plus
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
