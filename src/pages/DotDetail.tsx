import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { motion } from "framer-motion";
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const navigate = useAppStore((s) => s.navigate);
  const back = useAppStore((s) => s.back);

  const load = useCallback(async () => {
    try {
      const result = await invoke<DotDetailData | null>("get_dot_detail", {
        slug,
        limit: 100,
        offset: 0,
        bookmarksOnly: true,
      });
      setData(result);
    } catch (e) {
      console.error("Failed to load dot:", e);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    setLoading(true);
    load();
    scrollRef.current?.scrollTo(0, 0);
  }, [load]);

  useEffect(() => {
    const unlisten = listen<{ worker: string; status: string }>("sync:event", (event) => {
      if (event.payload.worker === "enricher" && event.payload.status === "done") {
        load();
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [load]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-4 h-4 border-2 border-border border-t-fg rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <p className="text-[13px] text-muted-fg">Dot introuvable</p>
        <button onClick={back} className="text-xs text-fg hover:underline">
          Retour
        </button>
      </div>
    );
  }

  const { dot, tweets, sub_dots } = data;
  const color = dot.color || "#666";

  const filtered = search
    ? tweets.filter(
        (t) =>
          t.content.toLowerCase().includes(search.toLowerCase()) ||
          t.author_handle.toLowerCase().includes(search.toLowerCase()) ||
          t.ai_summary?.toLowerCase().includes(search.toLowerCase())
      )
    : tweets;

  return (
    <div ref={scrollRef} className="flex-1 overflow-auto">
      <div className="max-w-2xl mx-auto px-6 pt-8 pb-20">
        {/* Back */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
        >
          <button
            onClick={back}
            className="flex items-center gap-2 text-xs text-muted-fg hover:text-fg transition-colors mb-6"
          >
            <ArrowLeft size={13} />
            Signets
          </button>
        </motion.div>

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
          className="mb-8"
        >
          <div className="flex items-center gap-3 mb-1">
            <div
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: color }}
            />
            <h1 className="text-2xl font-semibold tracking-tight text-fg">
              {dot.name}
            </h1>
          </div>
          <p className="text-xs text-muted-fg ml-[22px] tabular-nums">
            {dot.bookmark_count} signets
          </p>
        </motion.div>

        {/* Sub-dots */}
        {sub_dots.length > 0 && (
          <div className="mb-6 flex flex-wrap gap-2">
            {sub_dots.map((sd) => (
              <button
                key={sd.id}
                onClick={() => navigate({ type: "dot", slug: sd.slug })}
                className="px-3 py-1.5 bg-card border border-border rounded-md text-xs text-fg/70 hover:text-fg hover:border-muted-fg/30 transition-all"
              >
                {sd.name}{" "}
                <span className="text-muted-fg ml-1 tabular-nums">
                  {sd.bookmark_count}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Search */}
        {tweets.length > 5 && (
          <div className="relative mb-6">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-fg"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrer..."
              className="w-full pl-9 pr-3 py-2 bg-card border border-border rounded-lg text-[13px] text-fg placeholder:text-muted-fg focus:outline-none focus:ring-1 focus:ring-ring transition-all"
            />
          </div>
        )}

        {/* Bookmarks */}
        <div className="space-y-2">
          {filtered.length === 0 ? (
            <p className="text-center py-12 text-[13px] text-muted-fg">
              Aucun signet
            </p>
          ) : (
            filtered.map((tweet, i) => (
              <motion.div
                key={tweet.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2, delay: Math.min(i * 0.02, 0.3) }}
                onClick={() => navigate({ type: "tweet", id: tweet.id, fromDot: slug })}
              >
                <TweetCard tweet={tweet} />
              </motion.div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
