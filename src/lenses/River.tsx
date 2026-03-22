import { useEffect, useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Search, LayoutList, LayoutGrid, Zap, Bookmark, Rss, Globe, Clock, Shapes, Network, TrendingUp, TrendingDown, Filter } from "lucide-react";
import { useAppStore } from "../stores/appStore";
import { TweetCard, TweetRow as TweetRowView, CAT_COLORS, type Tweet } from "../components/TweetCard";

type SearchMode = "fulltext" | "semantic";
type ViewMode = "cards" | "list";
type SourceFilter = "all" | "bookmark" | "feed";
type GroupMode = "concepts" | "timeline";
type SignalFilter = "all" | "high" | "serious" | "noise";

const HIGH_SIGNAL_TYPES = ["tutorial", "announcement", "showcase", "thread", "resource", "alpha"];
const MID_SIGNAL_TYPES = ["news", "discussion", "question"];
const LOW_SIGNAL_TYPES = ["opinion", "meme", "personal"];

interface DashboardStats {
  total_tweets: number; total_bookmarks: number; enriched_count: number;
  pending_enrichment: number; pending_embedding: number;
  categories: { name: string; count: number }[]; top_topics: [string, number][];
}

type Trend = "rising" | "stable" | "declining";

interface ConceptGroup {
  cluster: string;
  category: string;
  tweets: Tweet[];
  recentCount: number; // tweets from last 24h
  olderCount: number; // tweets from 24h-72h ago
  trend: Trend;
}

export function River() {
  const [tweets, setTweets] = useState<Tweet[]>([]);
  const [query, setQuery] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("fulltext");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [groupMode, setGroupMode] = useState<GroupMode>("concepts");
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());
  const [signalFilter, setSignalFilter] = useState<SignalFilter>("all");
  const activeCategory = useAppStore((s) => s.activeCategory);
  const pushFocus = useAppStore((s) => s.pushFocus);
  const setLens = useAppStore((s) => s.setLens);
  const navigateToCluster = useAppStore((s) => s.navigateToCluster);

  const loadAll = async () => {
    setLoading(true);
    try {
      const source = sourceFilter === "all" ? undefined : sourceFilter;
      const [results, s] = await Promise.all([
        invoke<Tweet[]>("list_tweets", { limit: 500, offset: 0, source }),
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
      const source = sourceFilter === "all" ? undefined : sourceFilter;
      const command = searchMode === "semantic" ? "search_semantic" : "search_tweets";
      const results = await invoke<Tweet[]>(command, { query: query.trim(), limit: 50, source });
      setTweets(results);
    } catch (err) {
      console.error("Search failed:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, [sourceFilter]);
  useEffect(() => { const i = setInterval(loadAll, 15000); return () => clearInterval(i); }, [sourceFilter]);

  const filtered = useMemo(() => {
    let result = activeCategory ? tweets.filter((t) => t.ai_category === activeCategory) : tweets;
    if (signalFilter !== "all") {
      result = result.filter((t) => {
        const tp = t.ai_type || "";
        if (signalFilter === "high") return HIGH_SIGNAL_TYPES.includes(tp);
        if (signalFilter === "serious") return HIGH_SIGNAL_TYPES.includes(tp) || MID_SIGNAL_TYPES.includes(tp);
        if (signalFilter === "noise") return LOW_SIGNAL_TYPES.includes(tp);
        return true;
      });
    }
    return result;
  }, [tweets, activeCategory, signalFilter]);

  // === CONCEPT GROUPS: group by ai_cluster with trend detection ===
  const conceptGroups = useMemo((): ConceptGroup[] => {
    const map = new Map<string, { tweets: Tweet[]; category: string }>();
    const now = Date.now();
    const dayAgo = now - 86400_000;
    const threeDaysAgo = now - 3 * 86400_000;

    for (const t of filtered) {
      const cluster = (t as any).ai_cluster || t.ai_category || "uncategorized";
      const entry = map.get(cluster) || { tweets: [], category: t.ai_category || "other" };
      entry.tweets.push(t);
      map.set(cluster, entry);
    }

    return [...map.entries()]
      .map(([cluster, { tweets: tw, category }]) => {
        const recentCount = tw.filter((t) => t.created_at && new Date(t.created_at).getTime() > dayAgo).length;
        const olderCount = tw.filter((t) => {
          if (!t.created_at) return false;
          const ts = new Date(t.created_at).getTime();
          return ts > threeDaysAgo && ts <= dayAgo;
        }).length;

        // Trend: compare last 24h vs previous 48h (normalized per day)
        const olderPerDay = olderCount / 2;
        let trend: Trend = "stable";
        if (recentCount >= 2 && recentCount > olderPerDay * 1.5) trend = "rising";
        else if (olderPerDay >= 2 && recentCount < olderPerDay * 0.5) trend = "declining";

        return { cluster, category, tweets: tw, recentCount, olderCount, trend };
      })
      // Sort: rising first, then by recent activity, then by size
      .sort((a, b) => {
        const trendOrder = { rising: 0, stable: 1, declining: 2 };
        if (trendOrder[a.trend] !== trendOrder[b.trend]) return trendOrder[a.trend] - trendOrder[b.trend];
        if (a.recentCount !== b.recentCount) return b.recentCount - a.recentCount;
        return b.tweets.length - a.tweets.length;
      });
  }, [filtered]);

  // === TIME GROUPS: chronological fallback ===
  const timeGroups = useMemo(() => {
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
    if (lastHour.length) groups.push({ label: "Dernière heure", tweets: lastHour });
    if (today.length) groups.push({ label: "Aujourd'hui", tweets: today });
    if (thisWeek.length) groups.push({ label: "Cette semaine", tweets: thisWeek });
    if (older.length) groups.push({ label: "Plus ancien", tweets: older });
    return groups;
  }, [filtered]);

  // Signal stats
  const signalCounts = useMemo(() => {
    const c = { high: 0, mid: 0, low: 0 };
    for (const t of filtered) {
      const tp = t.ai_type || "";
      if (["tutorial", "announcement", "showcase", "thread"].includes(tp)) c.high++;
      else if (["news", "discussion", "question"].includes(tp)) c.mid++;
      else if (tp) c.low++;
    }
    return c;
  }, [filtered]);

  return (
    <div className="h-full overflow-y-auto px-6 py-4">
      <div className={viewMode === "list" ? "max-w-5xl mx-auto" : "max-w-3xl mx-auto"}>

        {/* Signal bar — compact, always visible */}
        {stats && !query && (
          <div className="flex items-center gap-4 mb-4 text-[11px]">
            <div className="flex items-center gap-1.5">
              <Zap size={12} className="text-violet-500" />
              <span className="font-medium text-zinc-700">{filtered.length}</span>
              <span className="text-zinc-400">posts</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span className="text-zinc-500">{signalCounts.high}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
              <span className="text-zinc-500">{signalCounts.mid}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-200" />
              <span className="text-zinc-500">{signalCounts.low}</span>
            </div>
            <span className="text-zinc-300">|</span>
            <span className="text-zinc-400">{conceptGroups.length} clusters</span>
            {conceptGroups.filter((g) => g.trend === "rising").length > 0 && (
              <>
                <span className="text-zinc-300">|</span>
                <span className="flex items-center gap-1 text-emerald-600 font-medium">
                  <TrendingUp size={11} />
                  {conceptGroups.filter((g) => g.trend === "rising").length} en hausse
                </span>
              </>
            )}
            {stats.pending_enrichment > 0 && (
              <>
                <span className="text-zinc-300">|</span>
                <span className="text-amber-500">{stats.pending_enrichment} en attente</span>
              </>
            )}
            <div className="flex-1" />
            <button
              onClick={() => setLens("graph")}
              className="flex items-center gap-1 text-zinc-400 hover:text-violet-600 transition-colors"
            >
              <Network size={11} />
              <span>Réseau</span>
            </button>
          </div>
        )}

        {/* Search + controls */}
        <form onSubmit={handleSearch} className="flex gap-2 mb-4">
          <div className="flex-1 relative group">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-violet-600 transition-colors" />
            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={searchMode === "semantic" ? "Décris ce que tu cherches..." : "Rechercher..."}
              className="w-full pl-9 pr-4 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-[13px] text-zinc-900 placeholder-zinc-400 focus:outline-none focus:bg-white focus:border-violet-600 focus:ring-1 focus:ring-violet-600/20 transition-all" />
          </div>

          {/* Source filter */}
          <div className="flex bg-zinc-100 rounded-md p-0.5 border border-zinc-200">
            <button type="button" onClick={() => setSourceFilter("all")}
              className={`px-2 py-1 text-[11px] font-medium rounded transition-all flex items-center gap-1 ${sourceFilter === "all" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-400 hover:text-zinc-600"}`}>
              <Globe size={11} /> Tout
            </button>
            <button type="button" onClick={() => setSourceFilter("bookmark")}
              className={`px-2 py-1 text-[11px] font-medium rounded transition-all flex items-center gap-1 ${sourceFilter === "bookmark" ? "bg-white text-violet-700 shadow-sm" : "text-zinc-400 hover:text-zinc-600"}`}>
              <Bookmark size={11} /> Signets
            </button>
            <button type="button" onClick={() => setSourceFilter("feed")}
              className={`px-2 py-1 text-[11px] font-medium rounded transition-all flex items-center gap-1 ${sourceFilter === "feed" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-400 hover:text-zinc-600"}`}>
              <Rss size={11} /> Flux
            </button>
          </div>

          {/* Signal filter — hype vs serious */}
          <div className="flex bg-zinc-100 rounded-md p-0.5 border border-zinc-200">
            <button type="button" onClick={() => setSignalFilter("all")}
              className={`px-2 py-1 text-[11px] font-medium rounded transition-all flex items-center gap-1 ${signalFilter === "all" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-400 hover:text-zinc-600"}`}>
              <Filter size={11} /> Tout
            </button>
            <button type="button" onClick={() => setSignalFilter("high")}
              className={`px-2 py-1 text-[11px] font-medium rounded transition-all flex items-center gap-1 ${signalFilter === "high" ? "bg-white text-emerald-700 shadow-sm" : "text-zinc-400 hover:text-zinc-600"}`}>
              <Zap size={11} /> Signal
            </button>
            <button type="button" onClick={() => setSignalFilter("serious")}
              className={`px-2 py-1 text-[11px] font-medium rounded transition-all flex items-center gap-1 ${signalFilter === "serious" ? "bg-white text-violet-700 shadow-sm" : "text-zinc-400 hover:text-zinc-600"}`}>
              Sérieux
            </button>
            <button type="button" onClick={() => setSignalFilter("noise")}
              className={`px-2 py-1 text-[11px] font-medium rounded transition-all flex items-center gap-1 ${signalFilter === "noise" ? "bg-white text-zinc-500 shadow-sm" : "text-zinc-400 hover:text-zinc-600"}`}>
              Bruit
            </button>
          </div>

          {/* Group mode */}
          <div className="flex bg-zinc-100 rounded-md p-0.5 border border-zinc-200">
            <button type="button" onClick={() => setGroupMode("concepts")}
              className={`px-2 py-1 text-[11px] font-medium rounded transition-all flex items-center gap-1 ${groupMode === "concepts" ? "bg-white text-violet-700 shadow-sm" : "text-zinc-400 hover:text-zinc-600"}`}>
              <Shapes size={11} /> Concepts
            </button>
            <button type="button" onClick={() => setGroupMode("timeline")}
              className={`px-2 py-1 text-[11px] font-medium rounded transition-all flex items-center gap-1 ${groupMode === "timeline" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-400 hover:text-zinc-600"}`}>
              <Clock size={11} /> Chrono
            </button>
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
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <div className="w-5 h-5 border-2 border-zinc-200 border-t-violet-600 rounded-full animate-spin" />
            <span className="text-[12px] text-zinc-400">
              {stats ? `${stats.enriched_count} enrichis, ${stats.pending_enrichment} en attente...` : "Chargement de ton espace de pensée..."}
            </span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-[14px] text-zinc-500 mb-1">
              {query ? "Aucun résultat." : "Ton espace de pensée est vide."}
            </div>
            <p className="text-[12px] text-zinc-400 max-w-sm mx-auto">
              {query ? "Essaie une autre recherche ou passe en mode sémantique." : "Les agents synchronisent tes signets et ton flux en arrière-plan. Les posts apparaîtront ici au fur et à mesure."}
            </p>
          </div>
        ) : groupMode === "concepts" ? (
          /* === CONCEPT VIEW: grouped by ai_cluster === */
          conceptGroups.map((group) => {
            const color = CAT_COLORS[group.category] || "#71717A";
            const isExpanded = expandedClusters.has(group.cluster);
            const defaultCount = viewMode === "list" ? 10 : 5;
            const showTweets = isExpanded ? group.tweets : group.tweets.slice(0, defaultCount);
            const hasMore = group.tweets.length > defaultCount && !isExpanded;
            return (
              <div key={group.cluster} className="mb-6">
                {/* Cluster header */}
                <div className="flex items-center gap-2 mb-2 sticky top-0 bg-zinc-50 py-1.5 z-10">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                  <button
                    onClick={() => navigateToCluster(group.cluster)}
                    className="text-[13px] font-semibold hover:underline transition-colors cursor-pointer"
                    style={{ color }}
                    title="Voir dans le réseau"
                  >{group.cluster}</button>
                  <span className="text-[11px] text-zinc-300">{group.tweets.length}</span>
                  {group.trend === "rising" && (
                    <span className="flex items-center gap-0.5 text-[10px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full font-medium">
                      <TrendingUp size={10} /> en hausse
                    </span>
                  )}
                  {group.trend === "declining" && (
                    <span className="flex items-center gap-0.5 text-[10px] text-zinc-400 bg-zinc-100 px-1.5 py-0.5 rounded-full">
                      <TrendingDown size={10} />
                    </span>
                  )}
                  {group.recentCount > 0 && (
                    <span className="text-[10px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full font-medium">
                      +{group.recentCount} nouveau{group.recentCount > 1 ? "x" : ""}
                    </span>
                  )}
                  <div className="flex-1 h-px bg-zinc-200 mx-2" />
                  <span className="text-[10px] text-zinc-300">{group.category}</span>
                </div>
                <div className={viewMode === "list" ? "space-y-1" : "space-y-2"}>
                  {showTweets.map((tweet) => (
                    <div key={tweet.id} onClick={() => pushFocus({ type: "tweet", id: tweet.id })}>
                      {viewMode === "list" ? <TweetRowView tweet={tweet} /> : <TweetCard tweet={tweet} compact />}
                    </div>
                  ))}
                </div>
                {hasMore && (
                  <button
                    onClick={() => setExpandedClusters((prev) => new Set([...prev, group.cluster]))}
                    className="mt-1.5 text-[11px] text-violet-600 hover:text-violet-800 font-medium transition-colors"
                  >
                    Voir {group.tweets.length - defaultCount} de plus dans {group.cluster}
                  </button>
                )}
                {isExpanded && group.tweets.length > defaultCount && (
                  <button
                    onClick={() => setExpandedClusters((prev) => { const n = new Set(prev); n.delete(group.cluster); return n; })}
                    className="mt-1.5 text-[11px] text-zinc-400 hover:text-zinc-600 font-medium transition-colors"
                  >
                    Réduire
                  </button>
                )}
              </div>
            );
          })
        ) : (
          /* === TIMELINE VIEW: chronological fallback === */
          timeGroups.map((group) => (
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
