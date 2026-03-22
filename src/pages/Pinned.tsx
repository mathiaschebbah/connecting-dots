import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Plus, X } from "lucide-react";
import { TweetCard, type Tweet } from "../components/TweetCard";
import { TweetDetail } from "../components/TweetDetail";

interface PinnedAccount {
  handle: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  pinned_since: string;
  poll_interval_secs: number;
  last_polled_at: string | null;
  notes: string | null;
  tweet_count: number;
}

function getInitialColor(handle: string): string {
  const colors = ["#7C3AED", "#0891B2", "#2563EB", "#059669", "#DB2777", "#D97706", "#EA580C"];
  let hash = 0;
  for (const c of handle) hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

export function Pinned() {
  const [accounts, setAccounts] = useState<PinnedAccount[]>([]);
  const [selectedHandle, setSelectedHandle] = useState<string | null>(null);
  const [tweets, setTweets] = useState<Tweet[]>([]);
  const [selectedTweetId, setSelectedTweetId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newHandle, setNewHandle] = useState("");

  const loadAccounts = async () => {
    try {
      const a = await invoke<PinnedAccount[]>("list_pinned_accounts");
      setAccounts(a);
    } catch (e) { console.error(e); }
  };

  const loadTweets = async (handle: string) => {
    try {
      const t = await invoke<Tweet[]>("get_account_tweets", { handle, limit: 100 });
      setTweets(t);
    } catch (e) { console.error(e); }
  };

  useEffect(() => { loadAccounts(); }, []);
  useEffect(() => {
    if (selectedHandle) loadTweets(selectedHandle);
    else setTweets([]);
  }, [selectedHandle]);

  const pinNew = async () => {
    if (!newHandle.trim()) return;
    const handle = newHandle.trim().replace(/^@/, "");
    try {
      await invoke("pin_account", { handle });
      setNewHandle("");
      setShowAdd(false);
      loadAccounts();
    } catch (e) { console.error(e); }
  };

  const unpin = async (handle: string) => {
    try {
      await invoke("unpin_account", { handle });
      if (selectedHandle === handle) { setSelectedHandle(null); setTweets([]); }
      loadAccounts();
    } catch (e) { console.error(e); }
  };

  if (accounts.length === 0 && !showAdd) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="max-w-xs text-left">
          <p className="text-[13px] text-zinc-700 mb-1">Track specific accounts</p>
          <p className="text-[12px] text-zinc-400 mb-4">Pin accounts to watch their tweets across your timeline. Their content is indexed and searchable automatically.</p>
          <button
            onClick={() => setShowAdd(true)}
            className="px-3 py-1.5 bg-zinc-900 text-white rounded-md text-[12px] font-medium hover:bg-zinc-800 transition-colors"
          >
            Pin an account
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex">
      <div className="w-[260px] border-r border-zinc-200 bg-white flex flex-col shrink-0">
        <div className="px-4 py-3 border-b border-zinc-200 flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-zinc-900">Pinned Accounts</h2>
          <button onClick={() => setShowAdd(!showAdd)} className="text-zinc-400 hover:text-zinc-700 p-1 rounded-md hover:bg-zinc-100">
            <Plus size={16} />
          </button>
        </div>

        {showAdd && (
          <form onSubmit={(e) => { e.preventDefault(); pinNew(); }} className="px-3 py-2 border-b border-zinc-100">
            <div className="flex gap-1">
              <input
                type="text" value={newHandle} onChange={(e) => setNewHandle(e.target.value)}
                placeholder="@handle"
                className="flex-1 px-2 py-1.5 bg-zinc-50 border border-zinc-200 rounded-md text-[12px] focus:outline-none focus:border-violet-600"
                autoFocus
              />
              <button type="submit" className="px-2 py-1.5 bg-zinc-900 text-white rounded-md text-[11px] font-medium">Pin</button>
            </div>
          </form>
        )}

        <div className="flex-1 overflow-y-auto">
          {accounts.map((a) => {
            const color = getInitialColor(a.handle);
            const active = selectedHandle === a.handle;
            return (
              <button
                key={a.handle}
                onClick={() => setSelectedHandle(active ? null : a.handle)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors group ${
                  active ? "bg-violet-50 border-r-2 border-violet-600" : "hover:bg-zinc-50"
                }`}
              >
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0"
                  style={{ backgroundColor: color + "15", color }}
                >
                  {a.handle[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-zinc-900 truncate">
                    {a.display_name || a.handle}
                  </div>
                  <div className="text-[11px] text-zinc-400 truncate">
                    @{a.handle} · {a.tweet_count} tweets
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); unpin(a.handle); }}
                  className="opacity-0 group-hover:opacity-100 text-zinc-300 hover:text-red-500 transition-all"
                >
                  <X size={14} />
                </button>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {selectedHandle ? (
          <div className="max-w-3xl mx-auto">
            <div className="mb-4 flex items-baseline gap-3">
              <h3 className="text-lg font-semibold tracking-tight text-zinc-900">@{selectedHandle}</h3>
              <span className="text-[13px] text-zinc-400">{tweets.length} tweets</span>
            </div>
            <div className="space-y-2">
              {tweets.map((t) => (
                <div key={t.id} onClick={() => setSelectedTweetId(t.id)}>
                  <TweetCard tweet={t} compact />
                </div>
              ))}
              {tweets.length === 0 && (
                <p className="text-[13px] text-zinc-400 py-8">No tweets from this account in your database yet. They'll appear as the sync picks them up.</p>
              )}
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center">
            <p className="text-[13px] text-zinc-400">Select an account to see their tweets</p>
          </div>
        )}
      </div>

      {selectedTweetId && (
        <TweetDetail
          tweetId={selectedTweetId}
          onClose={() => setSelectedTweetId(null)}
          onNavigate={(id) => setSelectedTweetId(id)}
        />
      )}
    </div>
  );
}
