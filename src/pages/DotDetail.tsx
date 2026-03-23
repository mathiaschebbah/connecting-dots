import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ArrowLeft, Search } from "lucide-react";
import { useAppStore } from "../stores/appStore";
import { TweetCard, type Tweet } from "../components/TweetCard";

interface Dot {
  id: number;
  name: string;
  slug: string;
  parent_id: number | null;
  description: string | null;
  color: string | null;
  tweet_count: number;
  bookmark_count: number;
  children: Dot[];
}

interface DotDetailData {
  dot: Dot;
  tweets: Tweet[];
  sub_dots: Dot[];
}

export function DotDetail({ slug }: { slug: string }) {
  const [data, setData] = useState<DotDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const panelOpen = useAppStore((s) => s.webviewOpen);
  const setPanelOpen = useAppStore((s) => s.setWebviewOpen);
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useAppStore((s) => s.navigate);
  const back = useAppStore((s) => s.back);

  async function openTweet(tweet: Tweet) {
    const url = tweet.tweet_url || `https://x.com/i/status/${tweet.id}`;
    const el = containerRef.current;
    if (!el) { invoke("open_in_browser", { url }).catch(() => {}); return; }

    const panelWidth = Math.floor(window.innerWidth / 2);
    const leftOffset = window.innerWidth - panelWidth;

    setPanelOpen(true);
    try {
      await invoke("open_tweet_panel", { url, leftOffset, height: window.innerHeight, width: panelWidth });
    } catch {
      invoke("open_in_browser", { url }).catch(() => {});
    }
  }

  async function closePanel() {
    try { await invoke("close_tweet_panel"); } catch {}
    setPanelOpen(false);
  }

  const load = useCallback(async () => {
    try {
      const result = await invoke<DotDetailData | null>("get_dot_detail", { slug, limit: 100, offset: 0, bookmarksOnly: true });
      setData(result);
    } catch {
      /* silently fail */
    } finally { setLoading(false); }
  }, [slug]);

  useEffect(() => {
    setLoading(true);
    load();
    scrollRef.current?.scrollTo(0, 0);
    return () => { invoke("close_tweet_panel").catch(() => {}); };
  }, [load]);

  useEffect(() => {
    const unlisten = listen<{ worker: string; status: string }>("sync:event", (event) => {
      if (event.payload.worker === "enricher" && event.payload.status === "done") load();
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [load]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-4 h-4 border-2 border-border border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <p className="text-[15px] text-muted-foreground">Ce sujet n'existe pas</p>
        <button onClick={back} className="text-[15px] text-[#1d9bf0] hover:underline">Retour aux signets</button>
      </div>
    );
  }

  const { dot, tweets, sub_dots } = data;

  const filtered = search
    ? tweets.filter((t) =>
        t.content.toLowerCase().includes(search.toLowerCase()) ||
        t.author_handle.toLowerCase().includes(search.toLowerCase()) ||
        t.ai_summary?.toLowerCase().includes(search.toLowerCase())
      )
    : tweets;

  return (
    <div ref={containerRef} className="flex-1 flex overflow-hidden">
      {/* Left panel */}
      <div
        ref={scrollRef}
        className={`overflow-auto transition-all duration-200 ${panelOpen ? "border-r border-border" : ""}`}
        style={{ width: panelOpen ? "50%" : "100%" }}
      >
        {/* Sticky header */}
        <div className="sticky top-0 z-10 bg-background border-b border-border px-4 py-2.5">
          <div className="flex items-center justify-between max-w-[680px] mx-auto">
            <div className="flex items-center gap-3">
              <button
                onClick={() => { closePanel(); back(); }}
                className="p-2 -ml-2 rounded-full hover:bg-white/[0.08] transition-all duration-150 active:scale-90"
                aria-label="Retour"
              >
                <ArrowLeft size={20} className="text-foreground" />
              </button>
              <div>
                <h1 className="text-[17px] font-bold text-foreground leading-tight">{dot.name}</h1>
                <p className="text-[13px] text-muted-foreground leading-tight">{dot.bookmark_count} signets</p>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-[680px] mx-auto">
          {/* Sub-dots */}
          {sub_dots.length > 0 && (
            <div className="px-4 py-3 flex flex-wrap gap-2">
              {sub_dots.map((sd) => (
                <button
                  key={sd.id}
                  onClick={() => { closePanel(); navigate({ type: "dot", slug: sd.slug }); }}
                  className="px-3 py-1.5 border border-border rounded-full text-[13px] text-muted-foreground hover:bg-white/[0.03] transition-colors"
                >
                  {sd.name} <span className="ml-1 tabular-nums">{sd.bookmark_count}</span>
                </button>
              ))}
            </div>
          )}

          {/* Search */}
          {tweets.length > 8 && (
            <div className="px-4 pt-1 pb-2">
              <div className="relative">
                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <label htmlFor="search-dot-detail" className="sr-only">Rechercher</label>
                <input
                  id="search-dot-detail"
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher"
                  className="w-full pl-10 pr-3 py-2 bg-secondary rounded-full text-[15px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[#1d9bf0] focus:bg-background transition-all"
                />
              </div>
            </div>
          )}

          {/* Tweets — zero gap, border-b only like X */}
          {filtered.length === 0 ? (
            <p className="text-center py-16 text-[15px] text-muted-foreground">Aucun signet dans ce sujet</p>
          ) : (
            filtered.map((tweet) => (
              <div key={tweet.id} onClick={() => openTweet(tweet)}>
                <TweetCard tweet={tweet} hideTags />
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right: webview overlay area */}
      {panelOpen && (
        <div className="w-1/2 shrink-0 bg-background border-l border-border" />
      )}
    </div>
  );
}
