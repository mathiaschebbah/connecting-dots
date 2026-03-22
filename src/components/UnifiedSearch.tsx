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
      // reset
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
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4" onClick={() => setSearchOpen(false)}>
      <div className="absolute inset-0 bg-zinc-900/20 backdrop-blur-md" />
      <div
        className="relative bg-white border border-zinc-200/60 rounded-2xl shadow-xl w-full max-w-[640px] max-h-[75vh] flex flex-col overflow-hidden transition-all duration-200 ease-out"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Header */}
        <div className="flex items-center gap-3.5 px-5 py-4 border-b border-zinc-100">
          <div className="flex items-center justify-center w-5 h-5">
            {detectMode(query) === "agent" ? (
              <Bot size={20} className="text-violet-600 transition-all duration-200" />
            ) : (
              <Search size={20} className="text-zinc-400 transition-all duration-200" />
            )}
          </div>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
            placeholder="Cherche dans ton cerveau, ou pose une question..."
            className="flex-1 text-[15px] text-zinc-900 placeholder-zinc-400 bg-transparent outline-none font-normal"
          />
          <div className="flex items-center gap-2">
            {(searching || agentRunning) && <Loader2 size={16} className="text-violet-600 animate-spin" />}
            <button
              onClick={() => setSearchOpen(false)}
              className="p-1 rounded-md text-zinc-300 hover:text-zinc-500 hover:bg-zinc-100 transition-all duration-200"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Mode indicator */}
        {query.trim() && (
          <div className="px-5 py-2.5 bg-zinc-50/50 border-b border-zinc-100 flex items-center gap-2">
            <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold transition-all duration-200 ${
              detectMode(query) === "agent"
                ? "bg-violet-100 text-violet-700 shadow-sm border border-violet-200/50"
                : "bg-zinc-200/60 text-zinc-600"
            }`}>
              {detectMode(query) === "agent" ? "Mode agent" : "Recherche"}
            </span>
            <span className="text-[12px] text-zinc-500 font-medium">
              {detectMode(query) === "agent" ? "L'IA va chercher et analyser" : "Appuie sur Entrée"}
            </span>
          </div>
        )}

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-2">
          {/* Agent text response */}
          {agentText && (
            <div className="mx-2 my-2 p-4 bg-violet-50/30 border border-violet-100/50 rounded-xl">
              <div className="text-[14px] text-zinc-800 leading-relaxed whitespace-pre-wrap">{agentText}</div>
            </div>
          )}

          {/* Tweet results */}
          {results.length > 0 && (
            <div className="space-y-1">
              {results.map((tweet) => {
                const catColor = tweet.ai_category ? CAT_COLORS[tweet.ai_category] || "#71717A" : null;
                return (
                  <button
                    key={tweet.id}
                    onClick={() => {
                      pushFocus({ type: "tweet", id: tweet.id });
                      setSearchOpen(false);
                    }}
                    className="group w-full text-left px-4 py-3 hover:bg-zinc-50 rounded-xl transition-all duration-200 ease-out flex items-start gap-4 relative overflow-hidden"
                  >
                    {catColor && (
                      <div className="absolute left-0 top-3 bottom-3 w-1 rounded-full transition-all duration-200 group-hover:w-1.5"
                           style={{ backgroundColor: catColor }} />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[13px] font-semibold text-zinc-900 truncate">
                          {tweet.author_name || tweet.author_handle}
                        </span>
                        <span className="text-[12px] text-zinc-400">@{tweet.author_handle}</span>
                        {catColor && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full ml-auto uppercase tracking-tight"
                            style={{ backgroundColor: catColor + "15", color: catColor }}>
                            {tweet.ai_category}
                          </span>
                        )}
                      </div>
                      <p className="text-[13px] text-zinc-600 line-clamp-2 leading-snug group-hover:text-zinc-900 transition-colors">
                        {tweet.content}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Empty state */}
          {!searching && !agentRunning && !agentText && results.length === 0 && query.trim() === "" && (
            <div className="px-6 py-10 text-center flex flex-col items-center">
              <div className="w-12 h-12 bg-zinc-50 rounded-full flex items-center justify-center mb-4 border border-zinc-100">
                <Search size={20} className="text-zinc-300" />
              </div>
              <p className="text-[14px] font-medium text-zinc-900 mb-1">Que cherches-tu ?</p>
              <p className="text-[12px] text-zinc-500 mb-6">Cherche dans tes signets ou pose une question complexe.</p>
              <div className="flex flex-wrap justify-center gap-2 max-w-md">
                {["embeddings", "frameworks d'agents IA", "connexions entre RAG et vector search"].map((s) => (
                  <button
                    key={s}
                    onClick={() => setQuery(s)}
                    className="text-[12px] text-zinc-600 hover:text-violet-600 px-4 py-2 rounded-full border border-zinc-200 bg-white hover:border-violet-200 hover:bg-violet-50/50 transition-all duration-200 ease-out shadow-sm"
                  >
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
