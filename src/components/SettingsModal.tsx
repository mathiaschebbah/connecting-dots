import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2 } from "lucide-react";
import { cn } from "../lib/utils";

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

interface XAccount {
  handle: string;
  name: string;
  avatar_url: string | null;
}

interface ApiUsage {
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
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
  const [syncingAction, setSyncingAction] = useState<"bookmarks" | "reenrich" | null>(null);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [xAccount, setXAccount] = useState<XAccount | null>(null);
  const [apiUsage, setApiUsage] = useState<ApiUsage | null>(null);

  useEffect(() => {
    if (open) {
      invoke<boolean>("check_api_key").then(setHasKey).catch(() => setHasKey(false));
      invoke<DashboardStats>("get_dashboard_stats").then(setStats).catch(() => setStats(null));
      invoke<XAccount>("get_x_account").then((a) => { console.log("x_account:", a); setXAccount(a); }).catch((e) => { console.error("get_x_account failed:", e); setXAccount(null); });
      invoke<ApiUsage>("get_api_usage").then(setApiUsage).catch(() => setApiUsage(null));
    }
  }, [open]);

  const deleteKey = async () => {
    await invoke("delete_api_key");
    setHasKey(false);
  };

  const saveKey = async () => {
    if (!newKey.trim()) return;
    await invoke("set_api_key", { apiKey: newKey.trim() });
    setHasKey(true);
    setEditingKey(false);
    setNewKey("");
  };

  const syncBookmarks = async () => {
    setSyncing(true);
    setSyncingAction("bookmarks");
    setSyncResult(null);
    try {
      const result = await invoke<{ new_tweets: number; total_tweets: number }>("sync_bookmarks");
      setSyncResult(
        `Signets : +${result.new_tweets} nouveaux (${result.total_tweets} au total)`
      );
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
      setSyncResult(`${count} tweets remis en file d'enrichissement.`);
    } catch (e) {
      setSyncResult(`Erreur : ${e}`);
    } finally {
      setSyncing(false);
      setSyncingAction(null);
    }
  };

  return (
    <AnimatePresence>
      {open && (
      <div
        className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-3 pt-[10vh] backdrop-blur-sm"
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
          className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
            <h2 className="text-[15px] font-semibold text-foreground">Paramètres</h2>
            <button
              onClick={onClose}
              className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
              aria-label="Fermer"
            >
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="divide-y divide-border">
              {/* X Account */}
              <div className="px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-medium text-foreground">
                      Compte X
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                      {xAccount ? (
                        <>
                          <span className="h-2 w-2 rounded-full bg-foreground" />
                          <span>Connecté</span>
                        </>
                      ) : (
                        <span>Vérification...</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* API Key */}
              <div className="px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-medium text-foreground">
                      Clé API Anthropic
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                      {hasKey === null ? (
                        <Loader2 size={10} className="animate-spin" />
                      ) : (
                        <span
                          className={cn(
                            "h-2 w-2 rounded-full",
                            hasKey ? "bg-foreground" : "bg-muted-foreground"
                          )}
                        />
                      )}
                      <span>
                        {hasKey === null
                          ? "Vérification..."
                          : hasKey
                            ? "Connectée"
                            : "Non configurée"}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {hasKey && !editingKey && (
                      <button
                        onClick={deleteKey}
                        className="shrink-0 text-[12px] font-medium text-muted-foreground transition-colors hover:text-red-400"
                      >
                        Supprimer
                      </button>
                    )}
                    <button
                      onClick={() => setEditingKey(!editingKey)}
                      className="shrink-0 rounded-full border border-border px-3.5 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-white/[0.05]"
                    >
                      {editingKey ? "Annuler" : hasKey ? "Modifier" : "Ajouter"}
                    </button>
                  </div>
                </div>
                {editingKey && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      saveKey();
                    }}
                    className="mt-3 flex gap-2"
                  >
                    <input
                      type="password"
                      value={newKey}
                      onChange={(e) => setNewKey(e.target.value)}
                      placeholder="sk-ant-..."
                      autoFocus
                      className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-[13px] font-mono text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-[#1d9bf0]"
                    />
                    <button
                      type="submit"
                      className="shrink-0 rounded-lg bg-foreground px-3.5 py-2 text-[12px] font-medium text-background transition-opacity hover:opacity-90"
                    >
                      Sauver
                    </button>
                  </form>
                )}
              </div>

              {/* API Usage */}
              {apiUsage && apiUsage.estimated_cost_usd > 0 && (
                <div className="px-5 py-4">
                  <div className="text-[12px] font-medium text-muted-foreground">Consommation API</div>
                  <div className="mt-2 space-y-1 text-[13px] text-foreground/80">
                    <div>
                      <span className="font-semibold text-foreground">${apiUsage.estimated_cost_usd.toFixed(2)}</span>
                      <span className="ml-1.5 text-muted-foreground">estimés</span>
                    </div>
                    <div className="text-[12px] text-muted-foreground">
                      {apiUsage.input_tokens.toLocaleString()} tokens in / {apiUsage.output_tokens.toLocaleString()} tokens out
                    </div>
                  </div>
                </div>
              )}

              {/* Stats */}
              {stats && (
                <div className="px-5 py-4">
                  <div className="text-[12px] font-medium text-muted-foreground">Apprentissage</div>
                  <div className="mt-3 flex divide-x divide-border rounded-xl border border-border">
                    <div className="flex-1 px-3 py-2.5 text-center">
                      <div className="text-[18px] font-semibold text-foreground tabular-nums">
                        {(stats.correction_rate_7d * 100).toFixed(1)}%
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">Taux 7j</div>
                    </div>
                    <div className="flex-1 px-3 py-2.5 text-center">
                      <div className="text-[18px] font-semibold text-foreground tabular-nums">
                        {stats.active_patterns}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">Patterns</div>
                    </div>
                    <div className="flex-1 px-3 py-2.5 text-center">
                      <div className="text-[18px] font-semibold text-foreground tabular-nums">
                        {stats.total_corrections}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">Corrections</div>
                    </div>
                  </div>

                  {stats.confusion_pairs.length > 0 && (
                    <div className="mt-3">
                      <div className="text-[11px] font-medium text-muted-foreground">Confusions fréquentes</div>
                      <div className="mt-1.5 space-y-1">
                        {stats.confusion_pairs.slice(0, 3).map((pair) => (
                          <div
                            key={`${pair.from_slug}:${pair.to_slug}`}
                            className="flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[12px] hover:bg-white/[0.03]"
                          >
                            <span className="truncate pr-3 text-foreground/80">
                              {pair.from_slug} <span className="text-muted-foreground">→</span> {pair.to_slug}
                            </span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">{pair.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="px-5 py-4">
                <div className="text-[12px] font-medium text-muted-foreground">Actions</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={syncBookmarks}
                    disabled={syncing}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3.5 py-2 text-[12px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    {syncingAction === "bookmarks" && (
                      <Loader2 size={12} className="animate-spin" />
                    )}
                    Sync signets
                  </button>
                  <button
                    onClick={resetEnrichments}
                    disabled={syncing}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-[12px] font-medium text-foreground/70 transition-colors hover:bg-white/[0.05] hover:text-foreground disabled:opacity-60"
                  >
                    {syncingAction === "reenrich" && (
                      <Loader2 size={12} className="animate-spin" />
                    )}
                    Ré-enrichir tout
                  </button>
                </div>

                {syncResult && (
                  <div className="mt-3 rounded-lg border border-border bg-background/60 px-3 py-2.5 text-[12px] text-muted-foreground">
                    {syncResult}
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
      )}
    </AnimatePresence>
  );
}
