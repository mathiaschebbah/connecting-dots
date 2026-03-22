import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";
import { X, Key, RefreshCw, Cpu, Radar, Trash2, Sparkles } from "lucide-react";
import { cn } from "../lib/utils";

interface MonitoredTopic {
  id: number;
  query: string;
  created_at: string;
  last_polled_at: string | null;
  poll_interval_secs: number;
  is_active: boolean;
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
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [topics, setTopics] = useState<MonitoredTopic[]>([]);

  const loadTopics = () => {
    invoke<MonitoredTopic[]>("list_monitored_topics").then(setTopics).catch(console.error);
  };

  useEffect(() => {
    if (open) {
      invoke<boolean>("check_api_key").then(setHasKey).catch(() => setHasKey(false));
      loadTopics();
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
    setSyncResult(null);
    try {
      const result = await invoke<{ new_tweets: number; total_tweets: number }>(
        type === "bookmarks" ? "sync_bookmarks" : "sync_feed"
      );
      setSyncResult(`${type}: +${result.new_tweets} new (${result.total_tweets} total)`);
    } catch (e) {
      setSyncResult(`Error: ${e}`);
    } finally {
      setSyncing(false);
    }
  };

  const embedPending = async () => {
    setSyncing(true);
    try {
      const result = await invoke<{ embedded_count: number; remaining: number }>("embed_pending");
      setSyncResult(`Embedded ${result.embedded_count}, ${result.remaining} remaining`);
    } catch (e) {
      setSyncResult(`Error: ${e}`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4" onClick={onClose}>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        />
        <motion.div
          initial={{ opacity: 0, y: -8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.98 }}
          transition={{ duration: 0.15 }}
          className="relative bg-card border border-border rounded-xl shadow-2xl w-[520px] max-h-[70vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <span className="text-[15px] font-semibold tracking-tight text-fg">Parametres</span>
            <button onClick={onClose} className="text-muted-fg hover:text-fg p-1.5 rounded-lg hover:bg-secondary transition-all">
              <X size={18} />
            </button>
          </div>

          <div className="p-6 space-y-6">
            {/* API Key */}
            <div className="space-y-3">
              <div className="text-xs font-semibold text-muted-fg uppercase tracking-wider">Cle API</div>
              <div className="border border-border rounded-xl p-4 bg-secondary space-y-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-card rounded-lg border border-border">
                    <Key size={14} className="text-muted-fg" />
                  </div>
                  <span className="text-[13px] text-fg/80 font-medium flex-1">Cle API Anthropic</span>
                  <div className={cn("w-2.5 h-2.5 rounded-full", hasKey ? "bg-emerald-500" : "bg-muted-fg")} />
                  <button onClick={() => setEditingKey(!editingKey)} className="text-[11px] text-fg font-semibold px-2.5 py-1 rounded-lg hover:bg-card transition-all">
                    {editingKey ? "Annuler" : "Modifier"}
                  </button>
                </div>
                {editingKey && (
                  <form onSubmit={(e) => { e.preventDefault(); saveKey(); }} className="flex gap-2">
                    <input type="password" value={newKey} onChange={(e) => setNewKey(e.target.value)}
                      placeholder="sk-ant-..." autoFocus
                      className="flex-1 px-3 py-2 bg-bg border border-border rounded-lg text-xs font-mono text-fg focus:outline-none focus:ring-1 focus:ring-ring transition-all" />
                    <button type="submit" className="px-4 py-2 bg-fg text-bg rounded-lg text-[11px] font-semibold hover:opacity-90 transition-all">Sauver</button>
                  </form>
                )}
              </div>
            </div>

            {/* Monitored Topics */}
            {topics.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-secondary rounded-lg">
                    <Radar size={12} className="text-muted-fg" />
                  </div>
                  <span className="text-xs font-semibold text-muted-fg uppercase tracking-wider">Sujets surveilles</span>
                  <span className="px-1.5 py-0.5 bg-secondary text-muted-fg text-[10px] rounded-full font-bold tabular-nums">{topics.length}</span>
                </div>
                <div className="space-y-1.5">
                  {topics.map((t) => (
                    <div key={t.id} className="flex items-center gap-3 px-3 py-2.5 bg-secondary border border-border rounded-xl group hover:border-muted-fg/30 transition-all">
                      <div className={cn("w-2 h-2 rounded-full shrink-0", t.is_active ? "bg-emerald-500" : "bg-muted-fg")} />
                      <span className="text-xs text-fg/80 font-medium flex-1 truncate">{t.query}</span>
                      {t.last_polled_at && (
                        <span className="text-[10px] text-muted-fg shrink-0 tabular-nums">
                          {new Date(t.last_polled_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                      <button
                        onClick={async () => {
                          await invoke("delete_monitored_topic", { id: t.id });
                          loadTopics();
                        }}
                        className="opacity-0 group-hover:opacity-100 text-muted-fg hover:text-red-400 transition-all p-1 rounded-lg hover:bg-card"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="space-y-3">
              <div className="text-xs font-semibold text-muted-fg uppercase tracking-wider">Actions manuelles</div>
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => manualSync("bookmarks")} disabled={syncing}
                  className="flex items-center gap-2 px-4 py-2 bg-fg text-bg rounded-lg text-[11px] font-semibold hover:opacity-90 disabled:opacity-30 transition-all">
                  <RefreshCw size={13} className={syncing ? "animate-spin" : ""} /> Sync signets
                </button>
                <button onClick={() => manualSync("feed")} disabled={syncing}
                  className="flex items-center gap-2 px-4 py-2 bg-secondary border border-border text-fg/80 rounded-lg text-[11px] font-semibold hover:bg-card disabled:opacity-30 transition-all">
                  <RefreshCw size={13} /> Sync flux
                </button>
                <button onClick={embedPending} disabled={syncing}
                  className="flex items-center gap-2 px-4 py-2 bg-secondary border border-border text-fg/80 rounded-lg text-[11px] font-semibold hover:bg-card disabled:opacity-30 transition-all">
                  <Cpu size={13} /> Embeddings
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    setSyncing(true);
                    try {
                      const count = await invoke<number>("reset_enrichments");
                      setSyncResult(`${count} tweets remis en file d'enrichissement. Le worker IA va les re-traiter.`);
                    } catch (e) { setSyncResult(`Erreur: ${e}`); }
                    finally { setSyncing(false); }
                  }}
                  disabled={syncing}
                  className="flex items-center gap-2 px-4 py-2 border border-amber-500/30 text-amber-400 bg-amber-500/10 rounded-lg text-[11px] font-semibold hover:bg-amber-500/20 disabled:opacity-30 transition-all"
                >
                  <Sparkles size={13} /> Re-enrichir tout
                </button>
                <span className="text-[10px] text-muted-fg font-medium">Force le re-traitement IA</span>
              </div>
              {syncResult && <div className="text-[11px] text-muted-fg">{syncResult}</div>}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
