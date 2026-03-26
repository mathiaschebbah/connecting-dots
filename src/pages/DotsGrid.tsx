import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Loader2, Plus, Search } from "lucide-react";
import { useAppStore } from "../stores/appStore";
import { slugify } from "../lib/utils";

interface Dot {
  id: number;
  name: string;
  slug: string;
  parent_id: number | null;
  description: string | null;
  color: string | null;
  created_at: string;
  bookmark_count: number;
  children: Dot[];
}

function DotCard({
  dot,
  highlight,
  onClick,
}: {
  dot: Dot;
  highlight?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full cursor-pointer rounded-2xl border border-border px-4 py-3.5 text-left hover:bg-white/[0.03]"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-2 truncate text-[14px] font-bold leading-tight text-foreground">
          {dot.color && (
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: dot.color }}
            />
          )}
          {dot.name}
        </span>
        <span
          className={`shrink-0 text-[13px] tabular-nums transition-colors duration-150 ${highlight ? "text-[#1d9bf0]" : "text-muted-foreground"}`}
        >
          {dot.bookmark_count}
        </span>
      </div>
      <div className="mt-1 truncate text-[12px] text-muted-foreground">{dot.slug}</div>
    </button>
  );
}

function CreateDotCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-secondary/50 px-4 py-3.5 text-muted-foreground hover:border-[#1d9bf0]/50 hover:text-foreground"
    >
      <Plus size={14} className="shrink-0" />
      <span className="text-[13px] font-medium">Nouveau dot</span>
    </button>
  );
}

export function DotsGrid() {
  const [dots, setDots] = useState<Dot[]>([]);
  const [searchResults, setSearchResults] = useState<Dot[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createSlug, setCreateSlug] = useState("");
  const [createColor, setCreateColor] = useState("#1d9bf0");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const backfilledRef = useRef(false);
  const navigate = useAppStore((s) => s.navigate);

  const loadDots = useCallback(async () => {
    try {
      const result = await invoke<Dot[]>("list_dots");
      setDots(result);
      return result;
    } catch {
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + one-time backfill if empty
  useEffect(() => {
    loadDots().then(async (result) => {
      if (result.length === 0 && !backfilledRef.current) {
        backfilledRef.current = true;
        try {
          const count = await invoke<number>("backfill_dots");
          if (count > 0) await loadDots();
        } catch {
          // noop
        }
      }
    });
  }, [loadDots]);

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

  useEffect(() => {
    if (!search.trim()) {
      setSearchResults(null);
      return;
    }

    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      const query = search.toLowerCase();
      const nameMatches = dots.filter(
        (dot) =>
          dot.name.toLowerCase().includes(query) || dot.slug.includes(query)
      );

      setSearching(true);
      try {
        const contentMatches = await invoke<Dot[]>("search_dots", { query: search.trim() });
        const seenIds = new Set(nameMatches.map((dot) => dot.id));
        const merged = [...nameMatches];
        for (const dot of contentMatches) {
          if (!seenIds.has(dot.id)) {
            seenIds.add(dot.id);
            merged.push(dot);
          }
        }
        setSearchResults(merged);
      } catch {
        setSearchResults(nameMatches);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(searchTimer.current);
  }, [search, dots]);

  async function handleCreateDot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = createName.trim();
    const nextSlug = createSlug.trim();

    if (!nextName || !nextSlug) {
      setCreateError("Nom et slug requis");
      return;
    }

    setCreating(true);
    setCreateError(null);
    try {
      await invoke("create_dot", {
        name: nextName,
        slug: nextSlug,
        color: createColor || null,
      });
      setCreateOpen(false);
      setCreateName("");
      setCreateSlug("");
      await loadDots();
      navigate({ type: "dot", slug: nextSlug });
    } catch (error) {
      setCreateError(String(error));
    } finally {
      setCreating(false);
    }
  }

  const displayed = searchResults ?? dots;

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-foreground" />
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-6 pt-4 pb-20">
          <div className="relative mx-auto mb-5 max-w-sm transition-all duration-300 ease-out focus-within:max-w-md">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <label htmlFor="search-dots" className="sr-only">
              Rechercher
            </label>
            <input
              id="search-dots"
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Rechercher dans les signets"
              className="w-full rounded-full bg-secondary py-2.5 pl-10 pr-3 text-[15px] text-foreground transition-all placeholder:text-muted-foreground focus:bg-background focus:outline-none focus:ring-1 focus:ring-[#1d9bf0]"
            />
          </div>

          {dots.length === 0 && searchResults === null ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              <CreateDotCard
                onClick={() => {
                  setCreateError(null);
                  setCreateOpen(true);
                }}
              />
            </div>
          ) : displayed.length === 0 ? (
            <p className="py-20 text-center text-[15px] text-muted-foreground">
              {searching ? "Recherche..." : "Aucun resultat"}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              <CreateDotCard
                onClick={() => {
                  setCreateError(null);
                  setCreateOpen(true);
                }}
              />
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

      <ActionModal
        open={createOpen}
        title="Créer un dot"
        onClose={() => {
          if (!creating) {
            setCreateOpen(false);
          }
        }}
      >
        <form className="space-y-3" onSubmit={handleCreateDot}>
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-muted-foreground">Nom</label>
            <input
              type="text"
              value={createName}
              onChange={(event) => {
                const nextName = event.target.value;
                const currentSlugFromName = slugify(createName);
                setCreateName(nextName);
                if (!createSlug || createSlug === currentSlugFromName) {
                  setCreateSlug(slugify(nextName));
                }
              }}
              autoFocus
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-[14px] text-foreground outline-none transition-colors focus:border-[#1d9bf0]"
              placeholder="Nom du dot"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-muted-foreground">Slug</label>
            <input
              type="text"
              value={createSlug}
              onChange={(event) => setCreateSlug(slugify(event.target.value))}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-[14px] text-foreground outline-none transition-colors focus:border-[#1d9bf0]"
              placeholder="nouveau-dot"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-muted-foreground">Couleur</label>
            <div className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2">
              <input
                type="color"
                value={createColor}
                onChange={(event) => setCreateColor(event.target.value)}
                className="h-8 w-10 rounded border-none bg-transparent p-0"
              />
              <span className="text-[13px] text-muted-foreground">{createColor}</span>
            </div>
          </div>

          {createError && (
            <p className="text-[12px] text-red-400">{createError}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="rounded-full border border-border px-4 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-white/[0.05]"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={creating}
              className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-[13px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {creating && <Loader2 size={14} className="animate-spin" />}
              Créer
            </button>
          </div>
        </form>
      </ActionModal>
    </>
  );
}

function ActionModal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-20 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="w-full max-w-md rounded-3xl border border-border bg-card p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4">
          <h2 className="text-[17px] font-semibold text-foreground">{title}</h2>
        </div>
        {children}
      </div>
    </div>
  );
}
