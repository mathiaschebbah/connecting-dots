import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Search, Bot, Loader2, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useAppStore } from "../stores/appStore";
import { type Tweet } from "./TweetCard";

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
  const navigate = useAppStore((s) => s.navigate);

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
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4" onClick={() => setSearchOpen(false)}>
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
          className="relative bg-card border border-border rounded-xl w-full max-w-[560px] max-h-[70vh] flex flex-col overflow-hidden shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border">
            {detectMode(query) === "agent" ? (
              <Bot size={16} className="text-emerald-400 shrink-0" />
            ) : (
              <Search size={16} className="text-muted-fg shrink-0" />
            )}
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
              placeholder="Chercher dans les signets..."
              className="flex-1 text-sm text-fg placeholder-muted-fg bg-transparent outline-none"
            />
            {(searching || agentRunning) && <Loader2 size={14} className="text-fg animate-spin" />}
            <button onClick={() => setSearchOpen(false)} className="p-1 text-muted-fg hover:text-fg">
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {agentText && (
              <div className="mx-2 my-2 p-4 bg-secondary border border-border rounded-lg">
                <div className="text-[13px] text-fg/70 leading-relaxed whitespace-pre-wrap">{agentText}</div>
              </div>
            )}

            {results.length > 0 && (
              <div className="space-y-0.5">
                {results.map((tweet) => (
                  <button
                    key={tweet.id}
                    onClick={() => { navigate({ type: "tweet", id: tweet.id }); setSearchOpen(false); }}
                    className="group w-full text-left px-4 py-3 hover:bg-secondary rounded-lg transition-colors flex flex-col gap-1"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-fg truncate">{tweet.author_name || tweet.author_handle}</span>
                      <span className="text-[11px] text-muted-fg">@{tweet.author_handle}</span>
                    </div>
                    <p className="text-xs text-muted-fg line-clamp-2 leading-snug group-hover:text-fg/70">{tweet.ai_summary || tweet.content}</p>
                  </button>
                ))}
              </div>
            )}

            {!searching && !agentRunning && !agentText && results.length === 0 && query.trim() === "" && (
              <div className="px-4 py-8 text-center">
                <p className="text-xs text-muted-fg">Cherche dans tes signets ou pose une question</p>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
