import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Key, RefreshCw, Cpu } from "lucide-react";

export function Settings() {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [keySaving, setKeySaving] = useState(false);

  useEffect(() => {
    invoke<boolean>("check_api_key").then(setHasKey).catch(() => setHasKey(false));
  }, []);

  const saveKey = async () => {
    if (!newKey.trim()) return;
    setKeySaving(true);
    try {
      await invoke("set_api_key", { apiKey: newKey.trim() });
      setHasKey(true);
      setEditingKey(false);
      setNewKey("");
    } catch (e) {
      console.error(e);
    } finally {
      setKeySaving(false);
    }
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
    <div className="h-full overflow-y-auto px-6 py-5">
      <div className="max-w-xl">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900 mb-6">Settings</h2>

        <section className="mb-8">
          <h3 className="text-[12px] font-medium text-zinc-500 mb-3">API Key</h3>
          <div className="border border-zinc-200 rounded-lg p-4 bg-white space-y-3">
            <div className="flex items-center gap-3">
              <Key size={16} className="text-zinc-400" />
              <div className="flex-1">
                <div className="text-[13px] text-zinc-700">Anthropic API Key</div>
                <div className="text-[11px] text-zinc-400">
                  {hasKey === null ? "Checking..." : hasKey ? "Configured" : "Not set"}
                </div>
              </div>
              <div className={`w-2 h-2 rounded-full ${hasKey ? "bg-emerald-500" : "bg-zinc-300"}`} />
              <button
                onClick={() => setEditingKey(!editingKey)}
                className="text-[12px] text-violet-600 font-medium hover:bg-violet-50 px-2 py-1 rounded-md transition-colors"
              >
                {editingKey ? "Cancel" : "Change"}
              </button>
            </div>
            {editingKey && (
              <form onSubmit={(e) => { e.preventDefault(); saveKey(); }} className="flex gap-2">
                <input
                  type="password"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder="sk-ant-..."
                  className="flex-1 px-3 py-1.5 bg-zinc-50 border border-zinc-200 rounded-md text-[13px] text-zinc-900 placeholder-zinc-400 focus:outline-none focus:bg-white focus:border-violet-600 focus:ring-1 focus:ring-violet-600/20 transition-all font-mono"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={keySaving || !newKey.trim()}
                  className="px-3 py-1.5 bg-zinc-900 text-white rounded-md text-[12px] font-medium hover:bg-zinc-800 disabled:opacity-30 transition-colors"
                >
                  {keySaving ? "Saving..." : "Save"}
                </button>
              </form>
            )}
          </div>
        </section>

        <section className="mb-8">
          <h3 className="text-[12px] font-medium text-zinc-500 mb-3">Manual actions</h3>
          <div className="space-y-2">
            <div className="border border-zinc-200 rounded-lg p-4 bg-white flex items-center gap-3">
              <RefreshCw size={16} className={`text-zinc-400 ${syncing ? "animate-spin" : ""}`} />
              <div className="flex-1">
                <div className="text-[13px] text-zinc-700">Sync data</div>
                <div className="text-[11px] text-zinc-400">Pull latest tweets from Twitter</div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => manualSync("bookmarks")} disabled={syncing}
                  className="px-3 py-1.5 bg-zinc-900 text-white rounded-md text-[12px] font-medium hover:bg-zinc-800 disabled:opacity-30 transition-colors">
                  Bookmarks
                </button>
                <button onClick={() => manualSync("feed")} disabled={syncing}
                  className="border border-zinc-200 text-zinc-700 px-3 py-1.5 rounded-md text-[12px] font-medium hover:bg-zinc-50 disabled:opacity-30 transition-colors">
                  Feed
                </button>
              </div>
            </div>
            <div className="border border-zinc-200 rounded-lg p-4 bg-white flex items-center gap-3">
              <Cpu size={16} className="text-zinc-400" />
              <div className="flex-1">
                <div className="text-[13px] text-zinc-700">Embed pending</div>
                <div className="text-[11px] text-zinc-400">Generate vector embeddings for search</div>
              </div>
              <button onClick={embedPending} disabled={syncing}
                className="border border-zinc-200 text-zinc-700 px-3 py-1.5 rounded-md text-[12px] font-medium hover:bg-zinc-50 disabled:opacity-30 transition-colors">
                Run
              </button>
            </div>
          </div>
          {syncResult && (
            <div className="mt-2 text-[11px] text-zinc-500 px-1">{syncResult}</div>
          )}
        </section>
      </div>
    </div>
  );
}
