import { useState, useEffect, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { motion } from "framer-motion";
import { Search, ArrowUpDown } from "lucide-react";
import { useAppStore } from "../stores/appStore";
import { cn } from "../lib/utils";

interface Dot {
  id: number;
  name: string;
  slug: string;
  parent_id: number | null;
  description: string | null;
  color: string | null;
  icon: string | null;
  created_at: string;
  tweet_count: number;
  bookmark_count: number;
  children: Dot[];
}

type SortMode = "recent" | "name" | "count";

function Badge({ label, variant }: { label: string; variant: "green" | "neutral" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-medium uppercase tracking-wide",
        variant === "green"
          ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
          : "bg-secondary text-muted-fg border border-border"
      )}
    >
      {label}
    </span>
  );
}

function DotCard({ dot, index, onClick }: { dot: Dot; index: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group relative text-left w-full bg-card border border-border rounded-xl p-5 hover:border-muted-fg/30 transition-all duration-150 cursor-pointer"
    >
      {/* Dot name */}
      <h3 className="text-sm font-medium text-card-fg truncate leading-tight mb-2">
        {dot.name}
      </h3>

      {/* Subtitle: count + "signets" */}
      <p className="text-xs text-muted-fg mb-4">
        <span className="tabular-nums">{dot.bookmark_count}</span> signet{dot.bookmark_count !== 1 ? "s" : ""}
      </p>

      {/* Badges */}
      <div className="flex items-center gap-2">
        <Badge
          label={dot.bookmark_count > 0 ? "actif" : "vide"}
          variant={dot.bookmark_count > 0 ? "green" : "neutral"}
        />
        {dot.children.length > 0 && (
          <Badge label={`${dot.children.length} sous`} variant="neutral" />
        )}
        <span className="tabular-nums text-[10px] text-muted-fg ml-auto">
          {dot.tweet_count}
        </span>
      </div>
    </button>
  );
}

export function DotsGrid() {
  const [dots, setDots] = useState<Dot[]>([]);
  const [loading, setLoading] = useState(true);
  const [backfilling, setBackfilling] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortMode>("recent");
  const navigate = useAppStore((s) => s.navigate);

  const loadDots = useCallback(async () => {
    try {
      const result = await invoke<Dot[]>("list_dots");
      setDots(result);

      if (result.length === 0 && !backfilling) {
        setBackfilling(true);
        try {
          const count = await invoke<number>("backfill_dots");
          if (count > 0) {
            const refreshed = await invoke<Dot[]>("list_dots");
            setDots(refreshed);
          }
        } catch {
          /* empty */
        } finally {
          setBackfilling(false);
        }
      }
    } catch (e) {
      console.error("Failed to load dots:", e);
    } finally {
      setLoading(false);
    }
  }, [backfilling]);

  useEffect(() => {
    loadDots();
  }, []);

  useEffect(() => {
    const unlisten = listen<{ worker: string; status: string }>("sync:event", (event) => {
      if (event.payload.worker === "enricher" && event.payload.status === "done") {
        loadDots();
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [loadDots]);

  const filtered = useMemo(() => {
    let result = dots;
    if (search) {
      const q = search.toLowerCase();
      result = dots.filter((d) => d.name.toLowerCase().includes(q) || d.slug.includes(q));
    }
    const sorted = [...result];
    switch (sort) {
      case "name":
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "count":
        sorted.sort((a, b) => b.bookmark_count - a.bookmark_count);
        break;
      case "recent":
      default:
        break;
    }
    return sorted;
  }, [dots, search, sort]);

  if (loading || backfilling) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <div className="w-4 h-4 border-2 border-border border-t-fg rounded-full animate-spin" />
        {backfilling && (
          <span className="text-xs text-muted-fg">Organisation...</span>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-5xl mx-auto px-8 pt-8 pb-20">
        {/* Title */}
        <h1 className="text-2xl font-semibold tracking-tight text-fg mb-6">
          Signets
        </h1>

        {/* Toolbar */}
        <div className="flex items-center gap-3 mb-6">
          {/* Search */}
          <div className="relative w-64">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-fg"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Chercher un sujet"
              className="w-full pl-9 pr-3 py-2 bg-card border border-border rounded-lg text-[13px] text-fg placeholder:text-muted-fg focus:outline-none focus:ring-1 focus:ring-ring transition-all"
            />
          </div>

          {/* Sort */}
          <button
            onClick={() => {
              const modes: SortMode[] = ["recent", "name", "count"];
              const idx = modes.indexOf(sort);
              setSort(modes[(idx + 1) % modes.length]);
            }}
            className="flex items-center gap-2 px-3 py-2 bg-card border border-border rounded-lg text-xs text-fg/70 hover:border-muted-fg/30 transition-all"
          >
            <ArrowUpDown size={13} />
            {sort === "recent" ? "Recents" : sort === "name" ? "A-Z" : "Nombre"}
          </button>

          <div className="flex-1" />

          <span className="text-xs text-muted-fg tabular-nums">
            {dots.length} sujets
          </span>
        </div>

        {/* Grid */}
        {filtered.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-[13px] text-muted-fg">
              {dots.length === 0
                ? "Les sujets apparaitront avec vos signets"
                : "Aucun resultat"}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((dot, i) => (
              <DotCard
                key={dot.id}
                dot={dot}
                index={i}
                onClick={() => navigate({ type: "dot", slug: dot.slug })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
