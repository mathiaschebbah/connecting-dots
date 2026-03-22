import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, Key, RefreshCw, Cpu, Radar, Trash2, Sparkles } from "lucide-react";

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
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-zinc-900/20 backdrop-blur-md" />
      <div
        className="relative bg-white border border-zinc-200/60 rounded-2xl shadow-xl w-[520px] max-h-[70vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
          <span className="text-[15px] font-bold tracking-tight text-zinc-900">Paramètres</span>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-900 p-1.5 rounded-lg hover:bg-zinc-100 transition-all duration-200">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* API Key */}
          <div className="space-y-3">
            <div className="text-[12px] font-semibold text-zinc-500 uppercase tracking-wider">Clé API</div>
            <div className="border border-zinc-200/60 rounded-xl p-4 bg-zinc-50/50 space-y-3 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white rounded-lg border border-zinc-200/60 shadow-sm">
                  <Key size={14} className="text-zinc-500" />
                </div>
                <span className="text-[13px] text-zinc-700 font-medium flex-1">Clé API Anthropic</span>
                <div className={`w-2.5 h-2.5 rounded-full ${hasKey ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]" : "bg-zinc-300"}`} />
                <button onClick={() => setEditingKey(!editingKey)} className="text-[11px] text-violet-600 font-semibold px-2.5 py-1 rounded-lg hover:bg-violet-50 transition-all">
                  {editingKey ? "Annuler" : "Modifier"}
                </button>
              </div>
              {editingKey && (
                <form onSubmit={(e) => { e.preventDefault(); saveKey(); }} className="flex gap-2">
                  <input type="password" value={newKey} onChange={(e) => setNewKey(e.target.value)}
                    placeholder="sk-ant-..." autoFocus
                    className="flex-1 px-3 py-2 bg-white border border-zinc-200/60 rounded-lg text-[12px] font-mono shadow-sm focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-all" />
                  <button type="submit" className="px-4 py-2 bg-zinc-900 text-white rounded-lg text-[11px] font-semibold shadow-sm hover:bg-zinc-800 transition-all">Sauver</button>
                </form>
              )}
            </div>
          </div>

          {/* Monitored Topics */}
          {topics.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-blue-50 rounded-lg">
                  <Radar size={12} className="text-blue-500" />
                </div>
                <span className="text-[12px] font-semibold text-zinc-500 uppercase tracking-wider">Sujets surveillés</span>
                <span className="px-1.5 py-0.5 bg-zinc-100 text-zinc-400 text-[10px] rounded-full font-bold">{topics.length}</span>
              </div>
              <div className="space-y-1.5">
                {topics.map((t) => (
                  <div key={t.id} className="flex items-center gap-3 px-3 py-2.5 bg-white border border-zinc-200/60 rounded-xl shadow-sm group hover:border-zinc-300 transition-all duration-200">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${t.is_active ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]" : "bg-zinc-300"}`} />
                    <span className="text-[12px] text-zinc-700 font-medium flex-1 truncate">{t.query}</span>
                    {t.last_polled_at && (
                      <span className="text-[10px] text-zinc-400 shrink-0">
                        {new Date(t.last_polled_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                    <button
                      onClick={async () => {
                        await invoke("delete_monitored_topic", { id: t.id });
                        loadTopics();
                      }}
                      className="opacity-0 group-hover:opacity-100 text-zinc-300 hover:text-red-500 transition-all p-1 rounded-lg hover:bg-red-50"
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
            <div className="text-[12px] font-semibold text-zinc-500 uppercase tracking-wider">Actions manuelles</div>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => manualSync("bookmarks")} disabled={syncing}
                className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-lg text-[11px] font-semibold shadow-sm hover:bg-zinc-800 hover:shadow-md disabled:opacity-30 transition-all duration-200">
                <RefreshCw size={13} className={syncing ? "animate-spin" : ""} /> Sync signets
              </button>
              <button onClick={() => manualSync("feed")} disabled={syncing}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-zinc-200/60 text-zinc-700 rounded-lg text-[11px] font-semibold shadow-sm hover:bg-zinc-50 hover:shadow-md disabled:opacity-30 transition-all duration-200">
                <RefreshCw size={13} /> Sync flux
              </button>
              <button onClick={embedPending} disabled={syncing}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-zinc-200/60 text-zinc-700 rounded-lg text-[11px] font-semibold shadow-sm hover:bg-zinc-50 hover:shadow-md disabled:opacity-30 transition-all duration-200">
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
                className="flex items-center gap-2 px-4 py-2 border border-amber-200/60 text-amber-700 bg-amber-50 rounded-lg text-[11px] font-semibold shadow-sm hover:bg-amber-100 hover:shadow-md disabled:opacity-30 transition-all duration-200"
              >
                <Sparkles size={13} /> Re-enrichir tout
              </button>
              <span className="text-[10px] text-zinc-400 font-medium">Force le re-traitement IA</span>
            </div>
            {syncResult && <div className="text-[11px] text-zinc-500">{syncResult}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
