import { useState, useEffect, useCallback, useRef } from "react";
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

function DotCard({ dot, highlight, onClick }: { dot: Dot; highlight?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-left w-full border border-border rounded-xl px-4 py-3.5 cursor-pointer transition-all duration-150 ease-out hover:bg-white/[0.03] active:scale-[0.97]"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[14px] font-bold text-foreground truncate leading-tight">
          {dot.name}
        </span>
        <span className={`text-[13px] tabular-nums shrink-0 transition-colors duration-150 ${highlight ? "text-[#1d9bf0]" : "text-muted-foreground"}`}>
          {dot.bookmark_count}
        </span>
      </div>
    </button>
  );
}

export function DotsGrid() {
  const [dots, setDots] = useState<Dot[]>([]);
  const [searchResults, setSearchResults] = useState<Dot[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [backfilling, setBackfilling] = useState(false);
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
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
    } catch {
      /* silently fail */
    } finally { setLoading(false); }
  }, [backfilling]);

  useEffect(() => { loadDots(); }, []);

  useEffect(() => {
    const unlisten = listen<{ worker: string; status: string }>("sync:event", (event) => {
      if (event.payload.worker === "enricher" && event.payload.status === "done") loadDots();
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [loadDots]);

  // Debounced search: filter dot names locally + search tweet content via backend
  useEffect(() => {
    if (!search.trim()) {
      setSearchResults(null);
      return;
    }

    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      const q = search.toLowerCase();

      // Local filter by dot name
      const nameMatches = dots.filter((d) => d.name.toLowerCase().includes(q) || d.slug.includes(q));

      // Backend search by tweet content
      setSearching(true);
      try {
        const contentMatches = await invoke<Dot[]>("search_dots", { query: search.trim() });
        // Merge: name matches first, then content matches (deduplicated)
        const seenIds = new Set(nameMatches.map((d) => d.id));
        const merged = [...nameMatches];
        for (const dot of contentMatches) {
          if (!seenIds.has(dot.id)) {
            seenIds.add(dot.id);
            merged.push(dot);
          }
        }
        setSearchResults(merged);
      } catch {
        // Fallback to name-only
        setSearchResults(nameMatches);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(searchTimer.current);
  }, [search, dots]);

  const displayed = searchResults ?? dots;

  if (loading || backfilling) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-4 h-4 border-2 border-border border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-5xl mx-auto px-6 pt-4 pb-20 animate-fade-in-up">
        {/* Search */}
        <div className="relative max-w-sm mb-5 focus-within:max-w-md transition-all duration-300 ease-out">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <label htmlFor="search-dots" className="sr-only">Rechercher</label>
          <input
            id="search-dots"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher dans les signets"
            className="w-full pl-10 pr-3 py-2.5 bg-secondary rounded-full text-[15px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[#1d9bf0] focus:bg-background transition-all"
          />
        </div>

        {/* Results */}
        {displayed.length === 0 ? (
          <p className="text-center py-20 text-[15px] text-muted-foreground">
            {searching ? "Recherche..." : dots.length === 0 ? "Tes signets sont en cours d'analyse" : "Aucun resultat"}
          </p>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {displayed.map((dot) => (
              <DotCard
                key={dot.id}
                dot={dot}
                highlight={searchResults !== null}
                onClick={() => navigate({ type: "dot", slug: dot.slug })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
