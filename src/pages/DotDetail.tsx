import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ArrowLeft, Loader2, PencilLine, Search, Trash2 } from "lucide-react";
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

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function DotDetail({ slug }: { slug: string }) {
  const [data, setData] = useState<DotDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [renameSlug, setRenameSlug] = useState("");
  const [renameReason, setRenameReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<"rename" | "delete" | null>(null);
  const [movingTweetId, setMovingTweetId] = useState<string | null>(null);
  const panelOpen = useAppStore((s) => s.webviewOpen);
  const setPanelOpen = useAppStore((s) => s.setWebviewOpen);
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useAppStore((s) => s.navigate);
  const back = useAppStore((s) => s.back);

  async function openTweet(tweet: Tweet) {
    const url = tweet.tweet_url || `https://x.com/i/status/${tweet.id}`;
    const el = containerRef.current;
    if (!el) {
      invoke("open_in_browser", { url }).catch(() => {});
      return;
    }

    const panelWidth = Math.floor(window.innerWidth / 2);
    const leftOffset = window.innerWidth - panelWidth;

    setPanelOpen(true);
    try {
      await invoke("open_tweet_panel", {
        url,
        leftOffset,
        height: window.innerHeight,
        width: panelWidth,
      });
    } catch {
      invoke("open_in_browser", { url }).catch(() => {});
    }
  }

  async function closePanel() {
    try {
      await invoke("close_tweet_panel");
    } catch {
      // noop
    }
    setPanelOpen(false);
  }

  const load = useCallback(async () => {
    try {
      const result = await invoke<DotDetailData | null>("get_dot_detail", {
        slug,
        limit: 100,
        offset: 0,
      });
      setData(result);
      if (result?.dot) {
        setRenameName(result.dot.name);
        setRenameSlug(result.dot.slug);
      }
    } catch {
      // noop
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    setLoading(true);
    setActionError(null);
    load();
    scrollRef.current?.scrollTo(0, 0);
    return () => {
      invoke("close_tweet_panel").catch(() => {});
    };
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

  async function handleMoveTweet(tweet: Tweet, toSlug: string, reason?: string) {
    if (!data) return;
    setMovingTweetId(tweet.id);
    setActionError(null);
    try {
      await invoke("move_tweet_dot", {
        tweetId: tweet.id,
        fromDotSlug: data.dot.slug,
        toDotSlug: toSlug,
        reason: reason?.trim() || null,
      });
      await load();
    } finally {
      setMovingTweetId(null);
    }
  }

  async function handleRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data) return;

    const nextName = renameName.trim();
    const nextSlug = renameSlug.trim();
    if (!nextName || !nextSlug) {
      setActionError("Nom et slug requis");
      return;
    }

    setActionBusy("rename");
    setActionError(null);
    try {
      await invoke("rename_dot", {
        slug: data.dot.slug,
        newName: nextName,
        newSlug: nextSlug,
        reason: renameReason.trim() || null,
      });
      setRenameOpen(false);
      setRenameReason("");
      if (nextSlug !== data.dot.slug) {
        await closePanel();
        navigate({ type: "dot", slug: nextSlug });
      } else {
        await load();
      }
    } catch (error) {
      setActionError(String(error));
    } finally {
      setActionBusy(null);
    }
  }

  async function handleDeleteDot() {
    if (!data) return;

    setActionBusy("delete");
    setActionError(null);
    try {
      await invoke("delete_dot", { slug: data.dot.slug });
      setDeleteOpen(false);
      await closePanel();
      navigate({ type: "dots" });
    } catch (error) {
      setActionError(String(error));
    } finally {
      setActionBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <p className="text-[15px] text-muted-foreground">Ce sujet n&apos;existe pas</p>
        <button
          onClick={back}
          className="text-[15px] text-[#1d9bf0] hover:underline"
        >
          Retour aux signets
        </button>
      </div>
    );
  }

  const { dot, tweets, sub_dots } = data;
  const filtered = search
    ? tweets.filter((tweet) => {
        const query = search.toLowerCase();
        return (
          tweet.content.toLowerCase().includes(query) ||
          tweet.author_handle.toLowerCase().includes(query) ||
          tweet.ai_summary?.toLowerCase().includes(query)
        );
      })
    : tweets;

  return (
    <>
      <div ref={containerRef} className="flex flex-1 overflow-hidden">
        <div
          ref={scrollRef}
          className={`overflow-auto ${panelOpen ? "border-r border-border" : ""}`}
          style={{ width: panelOpen ? "50%" : "100%" }}
        >
          <div className="sticky top-0 z-10 border-b border-border bg-background px-4 py-2.5">
            <div className="mx-auto flex max-w-[680px] items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  onClick={() => {
                    closePanel();
                    back();
                  }}
                  className="rounded-full p-2 -ml-2 transition-all duration-150 hover:bg-white/[0.08] active:scale-90"
                  aria-label="Retour"
                >
                  <ArrowLeft size={20} className="text-foreground" />
                </button>
                <div className="min-w-0">
                  <h1 className="truncate text-[17px] font-bold leading-tight text-foreground">
                    {dot.name}
                  </h1>
                  <p className="truncate text-[13px] leading-tight text-muted-foreground">
                    {dot.bookmark_count} signets · {dot.slug}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setActionError(null);
                    setRenameName(dot.name);
                    setRenameSlug(dot.slug);
                    setRenameOpen(true);
                  }}
                  className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[13px] text-foreground transition-colors hover:bg-white/[0.05]"
                >
                  <PencilLine size={14} />
                  Renommer
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActionError(null);
                    setDeleteOpen(true);
                  }}
                  className="flex items-center gap-1.5 rounded-full border border-red-500/30 px-3 py-1.5 text-[13px] text-red-400 transition-colors hover:bg-red-500/10"
                >
                  <Trash2 size={14} />
                  Supprimer
                </button>
              </div>
            </div>
          </div>

          <div className="mx-auto max-w-[680px]">
            {actionError && (
              <div className="px-4 pt-3">
                <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-[13px] text-red-300">
                  {actionError}
                </div>
              </div>
            )}

            {sub_dots.length > 0 && (
              <div className="flex flex-wrap gap-2 px-4 py-3">
                {sub_dots.map((subDot) => (
                  <button
                    key={subDot.id}
                  onClick={() => {
                      closePanel();
                      navigate({ type: "dot", slug: subDot.slug });
                    }}
                    className="rounded-full border border-border px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-white/[0.03]"
                  >
                    {subDot.name}
                    <span className="ml-1 tabular-nums">{subDot.bookmark_count}</span>
                  </button>
                ))}
              </div>
            )}

            {tweets.length > 8 && (
              <div className="px-4 pt-3 pb-2">
                <div className="relative">
                  <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <label htmlFor="search-dot-detail" className="sr-only">
                    Rechercher
                  </label>
                  <input
                    id="search-dot-detail"
                    type="text"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Rechercher"
                    className="w-full rounded-full bg-secondary py-2 pl-10 pr-3 text-[15px] text-foreground transition-all placeholder:text-muted-foreground focus:bg-background focus:outline-none focus:ring-1 focus:ring-[#1d9bf0]"
                  />
                </div>
              </div>
            )}

            {filtered.length === 0 ? (
              <p className="py-16 text-center text-[15px] text-muted-foreground">
                Aucun signet dans ce sujet
              </p>
            ) : (
              filtered.map((tweet) => (
                <div key={tweet.id} onClick={() => openTweet(tweet)}>
                  <TweetCard
                    tweet={tweet}
                    hideTags
                    moveAction={{
                      currentDotSlug: dot.slug,
                      busy: movingTweetId === tweet.id,
                      onMove: (toSlug, reason) => handleMoveTweet(tweet, toSlug, reason),
                    }}
                  />
                </div>
              ))
            )}
          </div>
        </div>

        {panelOpen && (
          <div className="w-1/2 shrink-0 border-l border-border bg-background" />
        )}
      </div>

      <ActionModal
        open={renameOpen}
        title="Renommer le dot"
        onClose={() => {
          if (actionBusy !== "rename") {
            setRenameOpen(false);
          }
        }}
      >
        <form className="space-y-3" onSubmit={handleRename}>
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-muted-foreground">Nom</label>
            <input
              type="text"
              value={renameName}
              onChange={(event) => {
                const nextName = event.target.value;
                const currentSlugFromName = slugify(renameName);
                setRenameName(nextName);
                if (!renameSlug || renameSlug === currentSlugFromName) {
                  setRenameSlug(slugify(nextName));
                }
              }}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-[14px] text-foreground outline-none transition-colors focus:border-[#1d9bf0]"
              placeholder="Nom du dot"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-muted-foreground">Slug</label>
            <input
              type="text"
              value={renameSlug}
              onChange={(event) => setRenameSlug(slugify(event.target.value))}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-[14px] text-foreground outline-none transition-colors focus:border-[#1d9bf0]"
              placeholder="slug-du-dot"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-muted-foreground">Raison optionnelle</label>
            <textarea
              value={renameReason}
              onChange={(event) => setRenameReason(event.target.value)}
              rows={3}
              className="min-h-[88px] w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-[14px] text-foreground outline-none transition-colors focus:border-[#1d9bf0]"
              placeholder="Pourquoi ce renommage aide le classement"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setRenameOpen(false)}
              className="rounded-full border border-border px-4 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-white/[0.05]"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={actionBusy === "rename"}
              className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-[13px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {actionBusy === "rename" && <Loader2 size={14} className="animate-spin" />}
              Enregistrer
            </button>
          </div>
        </form>
      </ActionModal>

      <ActionModal
        open={deleteOpen}
        title="Supprimer ce dot"
        onClose={() => {
          if (actionBusy !== "delete") {
            setDeleteOpen(false);
          }
        }}
      >
        <div className="space-y-4">
          <p className="text-[14px] leading-6 text-foreground/85">
            Les tweets de <span className="font-semibold text-foreground">{dot.name}</span> seront
            retirés de ce dot et réassignés automatiquement si un autre dot existe déjà.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeleteOpen(false)}
              className="rounded-full border border-border px-4 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-white/[0.05]"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleDeleteDot}
              disabled={actionBusy === "delete"}
              className="inline-flex items-center gap-2 rounded-full bg-red-500 px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {actionBusy === "delete" && <Loader2 size={14} className="animate-spin" />}
              Supprimer
            </button>
          </div>
        </div>
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
