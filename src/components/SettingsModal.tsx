import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";
import { X, Trash2, Loader2 } from "lucide-react";
import { cn } from "../lib/utils";

interface MonitoredTopic {
  id: number;
  query: string;
  created_at: string;
  last_polled_at: string | null;
  poll_interval_secs: number;
  is_active: boolean;
}

interface ConfusionPair {
  from_slug: string;
  to_slug: string;
  count: number;
}

interface DashboardStats {
  correction_rate_7d: number;
  active_patterns: number;
  total_corrections: number;
  confusion_pairs: ConfusionPair[];
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: Props) {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [editingKey, setEditingKey] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncingAction, setSyncingAction] = useState<"bookmarks" | "feed" | "embeddings" | "reenrich" | null>(null);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [topics, setTopics] = useState<MonitoredTopic[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);

  const loadTopics = () => {
    invoke<MonitoredTopic[]>("list_monitored_topics").then(setTopics).catch(() => { /* silently fail */ });
  };

  useEffect(() => {
    if (open) {
      invoke<boolean>("check_api_key").then(setHasKey).catch(() => setHasKey(false));
      loadTopics();
      invoke<DashboardStats>("get_dashboard_stats").then(setStats).catch(() => setStats(null));
    }
  }, [open]);

  if (!open) return null;

  const saveKey = async () => {
    if (!newKey.trim()) return;
    await invoke("set_api_key", { apiKey: newKey.trim() });
    setHasKey(true);
    setEditingKey(false);
    setNewKey("");
  };

  const manualSync = async (type: "bookmarks" | "feed") => {
    setSyncing(true);
    setSyncingAction(type);
    setSyncResult(null);
    try {
      const result = await invoke<{ new_tweets: number; total_tweets: number }>(
        type === "bookmarks" ? "sync_bookmarks" : "sync_feed"
      );
      setSyncResult(
        `${type === "bookmarks" ? "Signets" : "Flux"} : +${result.new_tweets} nouveaux (${result.total_tweets} au total)`
      );
    } catch (e) {
      setSyncResult(`Erreur : ${e}`);
    } finally {
      setSyncing(false);
      setSyncingAction(null);
    }
  };

  const embedPending = async () => {
    setSyncing(true);
    setSyncingAction("embeddings");
    try {
      const result = await invoke<{ embedded_count: number; remaining: number }>("embed_pending");
      setSyncResult(`Embeddings : ${result.embedded_count} traités, ${result.remaining} restants`);
    } catch (e) {
      setSyncResult(`Erreur : ${e}`);
    } finally {
      setSyncing(false);
      setSyncingAction(null);
    }
  };

  const resetEnrichments = async () => {
    setSyncing(true);
    setSyncingAction("reenrich");
    try {
      const count = await invoke<number>("reset_enrichments");
      setSyncResult(`${count} tweets remis en file d'enrichissement. Le worker IA va les re-traiter.`);
    } catch (e) {
      setSyncResult(`Erreur : ${e}`);
    } finally {
      setSyncing(false);
      setSyncingAction(null);
    }
  };

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-16 backdrop-blur-sm sm:pt-20"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-label="Paramètres"
      >
        <motion.div
          initial={{ opacity: 0, y: -8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.98 }}
          transition={{ duration: 0.15 }}
          className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
            <div>
              <h2 className="text-[17px] font-semibold text-foreground">Paramètres</h2>
              <p className="mt-1 text-[13px] text-muted-foreground">
                API, synchronisation et apprentissage continu
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded-full border border-border p-2 text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-foreground"
              aria-label="Fermer"
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-6">
            <div className="space-y-6">
              <section className="space-y-3">
                <div className="text-[12px] font-medium text-muted-foreground">Clé API</div>

                <div className="rounded-2xl border border-border bg-secondary/25 p-4 sm:p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-semibold text-foreground">
                        Clé API Anthropic
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[13px] text-muted-foreground">
                        {hasKey === null ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <span
                            className={cn(
                              "h-2.5 w-2.5 rounded-full",
                              hasKey ? "bg-emerald-500" : "bg-muted-foreground"
                            )}
                          />
                        )}
                        <span>
                          {hasKey === null
                            ? "Vérification en cours"
                            : hasKey
                              ? "Connectée"
                              : "Aucune clé configurée"}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() => setEditingKey(!editingKey)}
                      className="rounded-full border border-border px-4 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-white/[0.05]"
                    >
                      {editingKey ? "Annuler" : hasKey ? "Modifier" : "Ajouter"}
                    </button>
                  </div>
                  {editingKey && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        saveKey();
                      }}
                      className="mt-4 flex flex-col gap-2 sm:flex-row"
                    >
                      <input
                        type="password"
                        value={newKey}
                        onChange={(e) => setNewKey(e.target.value)}
                        placeholder="sk-ant-..."
                        autoFocus
                        className="w-full rounded-full border border-border bg-background px-4 py-2.5 text-[14px] font-mono text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-[#1d9bf0]"
                      />
                      <button
                        type="submit"
                        className="inline-flex items-center justify-center rounded-full bg-foreground px-4 py-2.5 text-[13px] font-medium text-background transition-opacity hover:opacity-90"
                      >
                        Sauver
                      </button>
                    </form>
                  )}
                </div>
              </section>

              {topics.length > 0 && (
                <section className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[12px] font-medium text-muted-foreground">Sujets surveillés</div>
                    <div className="text-[12px] text-muted-foreground tabular-nums">{topics.length}</div>
                  </div>

                  <div className="space-y-2">
                    {topics.map((t) => (
                      <div
                        key={t.id}
                        className="group flex items-center gap-3 rounded-2xl border border-border px-4 py-3 transition-colors hover:bg-white/[0.03]"
                      >
                        <span
                          className={cn(
                            "h-2.5 w-2.5 shrink-0 rounded-full",
                            t.is_active ? "bg-emerald-500" : "bg-muted-foreground"
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[14px] font-semibold text-foreground">
                            {t.query}
                          </div>
                          <div className="mt-1 text-[12px] text-muted-foreground">
                            {t.last_polled_at
                              ? new Date(t.last_polled_at).toLocaleDateString("fr-FR", {
                                  day: "numeric",
                                  month: "short",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : "Jamais synchronisé"}
                          </div>
                        </div>
                        <span className="hidden text-[12px] text-muted-foreground sm:inline">
                          {t.is_active ? "Actif" : "Pause"}
                        </span>
                        <button
                          onClick={async () => {
                            await invoke("delete_monitored_topic", { id: t.id });
                            loadTopics();
                          }}
                          className="rounded-full border border-transparent p-2 text-muted-foreground opacity-0 transition-all hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                          aria-label="Supprimer"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {stats && (
                <section className="space-y-3">
                  <div className="text-[12px] font-medium text-muted-foreground">Apprentissage continu</div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-border bg-secondary/25 px-4 py-3.5">
                      <div className="text-[12px] font-medium text-muted-foreground">Taux 7j</div>
                      <div className="mt-2 text-[24px] font-semibold text-foreground tabular-nums">
                        {(stats.correction_rate_7d * 100).toFixed(1)}%
                      </div>
                    </div>
                    <div className="rounded-2xl border border-border bg-secondary/25 px-4 py-3.5">
                      <div className="text-[12px] font-medium text-muted-foreground">Patterns</div>
                      <div className="mt-2 text-[24px] font-semibold text-foreground tabular-nums">
                        {stats.active_patterns}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-border bg-secondary/25 px-4 py-3.5">
                      <div className="text-[12px] font-medium text-muted-foreground">Corrections</div>
                      <div className="mt-2 text-[24px] font-semibold text-foreground tabular-nums">
                        {stats.total_corrections}
                      </div>
                    </div>
                  </div>

                  {stats.confusion_pairs.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[12px] font-medium text-muted-foreground">
                        Paires les plus confondues
                      </div>
                      {stats.confusion_pairs.slice(0, 3).map((pair) => (
                        <div
                          key={`${pair.from_slug}:${pair.to_slug}`}
                          className="flex items-center justify-between rounded-full border border-border px-4 py-3 text-[13px]"
                        >
                          <span className="truncate pr-4 text-foreground/85">
                            {pair.from_slug} → {pair.to_slug}
                          </span>
                          <span className="tabular-nums text-muted-foreground">{pair.count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}

              <section className="space-y-3">
                <div className="text-[12px] font-medium text-muted-foreground">Actions manuelles</div>

                <div className="rounded-2xl border border-border bg-secondary/25 p-4 sm:p-5">
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => manualSync("bookmarks")}
                      disabled={syncing}
                      className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-[13px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60"
                    >
                      {syncingAction === "bookmarks" ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : null}
                      Sync signets
                    </button>
                    <button
                      onClick={() => manualSync("feed")}
                      disabled={syncing}
                      className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-white/[0.05] disabled:opacity-60"
                    >
                      {syncingAction === "feed" ? <Loader2 size={14} className="animate-spin" /> : null}
                      Sync flux
                    </button>
                    <button
                      onClick={embedPending}
                      disabled={syncing}
                      className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-white/[0.05] disabled:opacity-60"
                    >
                      {syncingAction === "embeddings" ? <Loader2 size={14} className="animate-spin" /> : null}
                      Embeddings
                    </button>
                    <button
                      onClick={resetEnrichments}
                      disabled={syncing}
                      className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-[13px] font-medium text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-60"
                    >
                      {syncingAction === "reenrich" ? <Loader2 size={14} className="animate-spin" /> : null}
                      Ré-enrichir tout
                    </button>
                  </div>

                  <p className="mt-3 text-[12px] text-muted-foreground">
                    Relance les workers de collecte et de traitement IA sans quitter l'application.
                  </p>

                  {syncResult && (
                    <div className="mt-4 rounded-2xl border border-border bg-background/70 px-4 py-3 text-[13px] text-muted-foreground">
                      {syncResult}
                    </div>
                  )}
                </div>
              </section>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
