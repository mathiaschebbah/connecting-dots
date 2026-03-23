import { useState, useEffect, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Search } from "lucide-react";
import { useAppStore } from "../stores/appStore";

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

function DotCard({ dot, onClick }: { dot: Dot; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-left w-full border border-border rounded-xl px-5 py-4 hover:bg-white/[0.03] transition-colors duration-100 cursor-pointer"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[15px] font-bold text-foreground truncate">{dot.name}</span>
        <span className="text-[13px] text-muted-foreground tabular-nums shrink-0">{dot.bookmark_count}</span>
      </div>
    </button>
  );
}

export function DotsGrid() {
  const [dots, setDots] = useState<Dot[]>([]);
  const [loading, setLoading] = useState(true);
  const [backfilling, setBackfilling] = useState(false);
  const [search, setSearch] = useState("");
  const navigate = useAppStore((s) => s.navigate);

  const loadDots = useCallback(async () => {
    try {
      const result = await invoke<Dot[]>("list_dots");
      setDots(result);
      if (result.length === 0 && !backfilling) {
        setBackfilling(true);
        try {
          const count = await invoke<number>("backfill_dots");
          if (count > 0) setDots(await invoke<Dot[]>("list_dots"));
        } catch {} finally { setBackfilling(false); }
      }
    } catch (e) {
      console.error("Failed to load dots:", e);
    } finally { setLoading(false); }
  }, [backfilling]);

  useEffect(() => { loadDots(); }, []);

  useEffect(() => {
    const unlisten = listen<{ worker: string; status: string }>("sync:event", (event) => {
      if (event.payload.worker === "enricher" && event.payload.status === "done") loadDots();
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [loadDots]);

  const filtered = useMemo(() => {
    if (!search) return dots;
    const q = search.toLowerCase();
    return dots.filter((d) => d.name.toLowerCase().includes(q) || d.slug.includes(q));
  }, [dots, search]);

  if (loading || backfilling) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-4 h-4 border-2 border-border border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-[1200px] mx-auto px-6 pt-3 pb-20">
        {/* Search */}
        <div className="relative mb-4 max-w-md">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher"
            className="w-full pl-10 pr-3 py-2.5 bg-secondary rounded-full text-[15px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[#1d9bf0] focus:bg-background transition-all"
          />
        </div>

        {/* Dots */}
        {filtered.length === 0 ? (
          <p className="text-center py-20 text-[15px] text-muted-foreground">
            {dots.length === 0 ? "Tes signets sont en cours d'analyse" : "Aucun sujet ne correspond"}
          </p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {filtered.map((dot) => (
              <DotCard key={dot.id} dot={dot} onClick={() => navigate({ type: "dot", slug: dot.slug })} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
