import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Search, Bot, Loader2, X } from "lucide-react";
import { useAppStore } from "../stores/appStore";
import { CAT_COLORS, type Tweet } from "./TweetCard";

interface AgentEvent {
  type: "text" | "tool_start" | "tool_result" | "done" | "error";
  text?: string;
  tool?: string;
  input?: Record<string, unknown>;
  result?: unknown;
  message?: string;
}

export function UnifiedSearch() {
  const searchOpen = useAppStore((s) => s.searchOpen);
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const pushFocus = useAppStore((s) => s.pushFocus);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Tweet[]>([]);
  const [searching, setSearching] = useState(false);
  const [mode, setMode] = useState<"search" | "agent">("search");
  const [agentText, setAgentText] = useState("");
  const [agentRunning, setAgentRunning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const agentTextRef = useRef("");

  // Focus input when opened
  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery("");
      setResults([]);
      setAgentText("");
      setMode("search");
    }
  }, [searchOpen]);

  // Escape to close
  useEffect(() => {
    if (!searchOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setSearchOpen(false); e.stopPropagation(); }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [searchOpen, setSearchOpen]);

  // Agent event listener
  useEffect(() => {
    const unlisten = listen<AgentEvent>("agent:event", (event) => {
      const e = event.payload;
      switch (e.type) {
        case "text":
          agentTextRef.current += e.text || "";
          setAgentText(agentTextRef.current);
          break;
        case "tool_result":
          // If tool returns tweets, show them
          if (Array.isArray(e.result)) {
            const tweets = (e.result as any[]).filter((r: any) => r.id && r.content).map((r: any) => ({
              id: String(r.id), author_handle: String(r.author_handle || ""), author_name: r.author_name ? String(r.author_name) : null,
              content: String(r.content || r.text || ""), created_at: r.created_at ? String(r.created_at) : null,
              tweet_url: r.tweet_url ? String(r.tweet_url) : null, likes: Number(r.likes || 0), retweets: Number(r.retweets || 0),
              replies_count: Number(r.replies_count || 0), views: Number(r.views || 0), source: String(r.source || "agent"),
            })) as Tweet[];
            if (tweets.length > 0) setResults(tweets);
          }
          break;
        case "done":
          setAgentRunning(false);
          break;
        case "error":
          agentTextRef.current += `\nError: ${e.message}`;
          setAgentText(agentTextRef.current);
          setAgentRunning(false);
          break;
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const detectMode = (q: string): "search" | "agent" => {
    if (q.startsWith("/")) return "agent";
    const words = q.trim().split(/\s+/).length;
    if (words >= 5) return "agent";
    return "search";
  };

  const handleSubmit = async () => {
    const q = query.trim();
    if (!q) return;

    const m = detectMode(q);
    setMode(m);

    if (m === "agent") {
      setAgentRunning(true);
      agentTextRef.current = "";
      setAgentText("");
      setResults([]);
      try {
        await invoke("send_agent_message", { message: q.startsWith("/") ? q.slice(1) : q, history: [] });
      } catch (e) {
        setAgentText(`Error: ${e}`);
        setAgentRunning(false);
      }
    } else {
      setSearching(true);
      setResults([]);
      try {
        // Combined: try semantic first, fallback to fulltext
        const semantic = await invoke<Tweet[]>("search_semantic", { query: q, limit: 20 });
        if (semantic.length > 0) {
          setResults(semantic);
        } else {
          const fulltext = await invoke<Tweet[]>("search_tweets", { query: q, limit: 20 });
          setResults(fulltext);
        }
      } catch {
        try {
          const fulltext = await invoke<Tweet[]>("search_tweets", { query: q, limit: 20 });
          setResults(fulltext);
        } catch (e) {
          console.error(e);
        }
      } finally {
        setSearching(false);
      }
    }
  };

  if (!searchOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16" onClick={() => setSearchOpen(false)}>
      <div className="absolute inset-0 bg-black/10 backdrop-blur-[1px]" />
      <div
        className="relative bg-white border border-zinc-200 rounded-lg shadow-lg w-[600px] max-h-[70vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-200">
          {mode === "agent" && (agentRunning || agentText) ? (
            <Bot size={16} className="text-violet-600 shrink-0" />
          ) : (
            <Search size={16} className="text-zinc-400 shrink-0" />
          )}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
            placeholder="Search your brain, or ask a question..."
            className="flex-1 text-[14px] text-zinc-900 placeholder-zinc-400 bg-transparent outline-none"
          />
          {(searching || agentRunning) && <Loader2 size={16} className="text-violet-600 animate-spin shrink-0" />}
          <button onClick={() => setSearchOpen(false)} className="text-zinc-300 hover:text-zinc-600">
            <X size={16} />
          </button>
        </div>

        {/* Mode indicator */}
        {query.trim() && (
          <div className="px-4 py-1.5 border-b border-zinc-100 flex items-center gap-2 text-[11px]">
            <span className={`px-1.5 py-0.5 rounded ${detectMode(query) === "agent" ? "bg-violet-100 text-violet-700" : "bg-zinc-100 text-zinc-600"}`}>
              {detectMode(query) === "agent" ? "Agent mode" : "Search"}
            </span>
            <span className="text-zinc-400">
              {detectMode(query) === "agent" ? "Natural language → AI will search and analyze" : "Press Enter to search"}
            </span>
          </div>
        )}

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {/* Agent text response */}
          {agentText && (
            <div className="px-4 py-3 border-b border-zinc-100">
              <div className="text-[13px] text-zinc-700 leading-relaxed whitespace-pre-wrap">{agentText}</div>
            </div>
          )}

          {/* Tweet results */}
          {results.length > 0 && (
            <div className="py-1">
              {results.map((tweet) => {
                const catColor = tweet.ai_category ? CAT_COLORS[tweet.ai_category] || "#71717A" : null;
                return (
                  <button
                    key={tweet.id}
                    onClick={() => {
                      pushFocus({ type: "tweet", id: tweet.id });
                      setSearchOpen(false);
                    }}
                    className="w-full text-left px-4 py-2.5 hover:bg-zinc-50 transition-colors flex items-start gap-3 border-l-2"
                    style={{ borderLeftColor: catColor || "transparent" }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-[12px] font-medium text-zinc-900 truncate">
                          {tweet.author_name || tweet.author_handle}
                        </span>
                        <span className="text-[11px] text-zinc-400">@{tweet.author_handle}</span>
                        {catColor && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded ml-auto shrink-0"
                            style={{ backgroundColor: catColor + "10", color: catColor }}>
                            {tweet.ai_category}
                          </span>
                        )}
                      </div>
                      <p className="text-[12px] text-zinc-600 line-clamp-2">{tweet.content}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Empty state */}
          {!searching && !agentRunning && !agentText && results.length === 0 && query.trim() === "" && (
            <div className="px-4 py-6 text-center">
              <p className="text-[12px] text-zinc-400 mb-3">Search tweets or ask the agent a question</p>
              <div className="flex flex-col gap-1 max-w-sm mx-auto">
                {["embeddings", "AI agents frameworks", "find connections between RAG and vector search in my bookmarks"].map((s) => (
                  <button key={s} onClick={() => { setQuery(s); }}
                    className="text-[11px] text-zinc-500 hover:text-zinc-900 px-3 py-1.5 rounded-md border border-zinc-200 hover:bg-zinc-50 transition-colors text-left bg-white">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
