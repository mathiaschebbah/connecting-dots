import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, Key, RefreshCw, Cpu } from "lucide-react";

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

  useEffect(() => {
    if (open) invoke<boolean>("check_api_key").then(setHasKey).catch(() => setHasKey(false));
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
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20" onClick={onClose}>
      <div className="absolute inset-0 bg-black/10" />
      <div
        className="relative bg-white border border-zinc-200 rounded-lg shadow-lg w-[480px] max-h-[60vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-200">
          <span className="text-[13px] font-semibold text-zinc-900">Settings</span>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-900 p-1 rounded-md hover:bg-zinc-100">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* API Key */}
          <div className="space-y-2">
            <div className="text-[12px] font-medium text-zinc-500">API Key</div>
            <div className="border border-zinc-200 rounded-lg p-3 bg-zinc-50 space-y-2">
              <div className="flex items-center gap-3">
                <Key size={14} className="text-zinc-400" />
                <span className="text-[13px] text-zinc-700 flex-1">Anthropic API Key</span>
                <div className={`w-2 h-2 rounded-full ${hasKey ? "bg-emerald-500" : "bg-zinc-300"}`} />
                <button onClick={() => setEditingKey(!editingKey)} className="text-[11px] text-violet-600 font-medium">
                  {editingKey ? "Cancel" : "Change"}
                </button>
              </div>
              {editingKey && (
                <form onSubmit={(e) => { e.preventDefault(); saveKey(); }} className="flex gap-2">
                  <input type="password" value={newKey} onChange={(e) => setNewKey(e.target.value)}
                    placeholder="sk-ant-..." autoFocus
                    className="flex-1 px-2 py-1.5 bg-white border border-zinc-200 rounded-md text-[12px] font-mono focus:outline-none focus:border-violet-600" />
                  <button type="submit" className="px-3 py-1.5 bg-zinc-900 text-white rounded-md text-[11px] font-medium">Save</button>
                </form>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="space-y-2">
            <div className="text-[12px] font-medium text-zinc-500">Manual actions</div>
            <div className="flex items-center gap-2">
              <button onClick={() => manualSync("bookmarks")} disabled={syncing}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 text-white rounded-md text-[11px] font-medium hover:bg-zinc-800 disabled:opacity-30">
                <RefreshCw size={12} className={syncing ? "animate-spin" : ""} /> Sync bookmarks
              </button>
              <button onClick={() => manualSync("feed")} disabled={syncing}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-zinc-200 text-zinc-700 rounded-md text-[11px] font-medium hover:bg-zinc-50 disabled:opacity-30">
                Sync feed
              </button>
              <button onClick={embedPending} disabled={syncing}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-zinc-200 text-zinc-700 rounded-md text-[11px] font-medium hover:bg-zinc-50 disabled:opacity-30">
                <Cpu size={12} /> Embed pending
              </button>
            </div>
            {syncResult && <div className="text-[11px] text-zinc-500">{syncResult}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
