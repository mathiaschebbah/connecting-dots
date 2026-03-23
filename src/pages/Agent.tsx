import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Send, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { TweetCard, type Tweet } from "../components/TweetCard";

interface AgentEvent {
  type: "text" | "tool_start" | "tool_result" | "done" | "error";
  text?: string;
  tool?: string;
  input?: Record<string, unknown>;
  result?: unknown;
  message?: string;
}

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  tools?: ToolBlock[];
}

interface ToolBlock {
  tool: string;
  input: Record<string, unknown>;
  result: unknown;
}

export function Agent() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentAssistant = useRef<{ text: string; tools: ToolBlock[] }>({ text: "", tools: [] });

  useEffect(() => {
    const unlisten = listen<AgentEvent>("agent:event", (event) => {
      const e = event.payload;

      switch (e.type) {
        case "text":
          currentAssistant.current.text += e.text || "";
          updateAssistantMessage();
          break;
        case "tool_start":
          currentAssistant.current.tools.push({
            tool: e.tool || "",
            input: e.input || {},
            result: null,
          });
          updateAssistantMessage();
          break;
        case "tool_result": {
          const tools = currentAssistant.current.tools;
          const last = tools[tools.length - 1];
          if (last && last.tool === e.tool) {
            last.result = e.result;
          }
          updateAssistantMessage();
          break;
        }
        case "done":
          setIsRunning(false);
          break;
        case "error":
          currentAssistant.current.text += `\n\nError: ${e.message}`;
          updateAssistantMessage();
          setIsRunning(false);
          break;
      }
    });

    return () => { unlisten.then((fn) => fn()); };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const updateAssistantMessage = () => {
    setMessages((prev) => {
      const updated = [...prev];
      const lastIdx = updated.length - 1;
      if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
        updated[lastIdx] = {
          role: "assistant",
          content: currentAssistant.current.text,
          tools: [...currentAssistant.current.tools],
        };
      } else {
        updated.push({
          role: "assistant",
          content: currentAssistant.current.text,
          tools: [...currentAssistant.current.tools],
        });
      }
      return updated;
    });
  };

  const sendMessage = async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || isRunning) return;
    setInput("");
    setIsRunning(true);

    const userMsg: ChatMsg = { role: "user", content: msg };
    setMessages((prev) => [...prev, userMsg]);

    currentAssistant.current = { text: "", tools: [] };

    const history = messages.map((m) => ({
      role: m.role,
      content: JSON.stringify(m.content),
    }));

    try {
      await invoke("send_agent_message", { message: msg, history });
    } catch (e) {
      setIsRunning(false);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${e}` },
      ]);
    }
  };

  const suggestions = [
    "Trouve mes signets sur les agents IA",
    "Quels sont les sujets que j'ai le plus sauvegardes ?",
    "Cherche les dernieres infos sur Claude Code",
    "Relie mes signets RAG avec ceux sur les embeddings",
  ];

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="px-6 py-3 border-b border-border">
        <h2 className="text-[17px] font-bold text-foreground">Agent</h2>
        <p className="text-[13px] text-muted-foreground">Explore tes signets, cherche sur X, organise par tags</p>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
        {messages.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="flex flex-col items-start justify-center h-full gap-4 py-20 max-w-lg"
          >
            <p className="text-[13px] text-muted-foreground">Qu'est-ce que tu veux explorer ?</p>
            <div className="flex flex-col gap-1.5 w-full">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => sendMessage(s)}
                  className="text-xs text-muted-foreground hover:text-foreground px-3 py-2 rounded-md border border-border hover:bg-card transition-colors text-left bg-transparent"
                >
                  {s}
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {messages.map((msg, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className={msg.role === "user" ? "flex justify-end" : ""}
          >
            {msg.role === "user" ? (
              <div className="max-w-[80%] px-3 py-2 rounded-lg bg-foreground text-background text-[13px]">
                {msg.content}
              </div>
            ) : (
              <div className="max-w-full">
                {msg.tools?.map((tool, j) => (
                  <div key={j} className="mb-3">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      <span className="text-[11px] text-emerald-400 font-medium capitalize">
                        {tool.tool.replace(/_/g, " ")}
                      </span>
                      {!tool.result && (
                        <Loader2 size={12} className="text-emerald-400 animate-spin" />
                      )}
                    </div>
                    {tool.result != null && renderToolResult(tool.tool, tool.result)}
                  </div>
                ))}

                {msg.content && (
                  <div className="text-[13px] text-foreground/80 leading-relaxed whitespace-pre-wrap">
                    {msg.content}
                  </div>
                )}
              </div>
            )}
          </motion.div>
        ))}

        {isRunning && messages[messages.length - 1]?.role !== "assistant" && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            Reflexion en cours...
          </div>
        )}
      </div>

      <div className="p-4 border-t border-border">
        <form
          onSubmit={(e) => { e.preventDefault(); sendMessage(); }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Pose une question..."
            disabled={isRunning}
            className="flex-1 px-3 py-2 bg-card border border-border rounded-md text-[13px] text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring transition-all disabled:opacity-50"
            autoFocus
          />
          <button
            type="submit"
            disabled={isRunning || !input.trim()}
            className="px-4 py-2 bg-foreground text-background rounded-md text-[13px] font-medium hover:opacity-90 disabled:opacity-30 transition-colors"
          >
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}

function normalizeTweet(raw: Record<string, unknown>): Tweet | null {
  try {
    return {
      id: String(raw.id || ""),
      author_handle: String(raw.author_handle || ""),
      author_name: raw.author_name ? String(raw.author_name) : null,
      content: String(raw.content || raw.text || ""),
      created_at: raw.created_at ? String(raw.created_at) : null,
      tweet_url: raw.tweet_url ? String(raw.tweet_url) : null,
      likes: Number(raw.likes || (raw.engagement as any)?.likes || 0),
      retweets: Number(raw.retweets || (raw.engagement as any)?.retweets || 0),
      replies_count: Number(raw.replies_count || (raw.engagement as any)?.replies || 0),
      views: Number(raw.views || (raw.engagement as any)?.views || 0),
      source: String(raw.source || "agent"),
    };
  } catch {
    return null;
  }
}

function renderToolResult(_tool: string, result: unknown): React.ReactNode {
  try {
    if (!result || typeof result !== "object") return null;

    if (Array.isArray(result) && result.length > 0) {
      const tweets = result.map(normalizeTweet).filter(Boolean) as Tweet[];
      if (tweets.length > 0) {
        return (
          <div className="space-y-1.5 pl-3 border-l-2 border-emerald-500/30">
            {tweets.slice(0, 5).map((tweet, i) => (
              <TweetCard key={tweet.id || i} tweet={tweet} compact />
            ))}
            {tweets.length > 5 && (
              <div className="text-[10px] text-muted-foreground pl-4">
                +{tweets.length - 5} de plus
              </div>
            )}
          </div>
        );
      }
    }

    const obj = result as Record<string, unknown>;

    if (obj.author_handle) {
      const tweet = normalizeTweet(obj);
      if (tweet) {
        return (
          <div className="pl-3 border-l-2 border-emerald-500/30">
            <TweetCard tweet={tweet} compact />
          </div>
        );
      }
    }

    if (obj.success) {
      return (
        <div className="text-[11px] text-emerald-400 pl-3 font-medium">
          Fait {obj.tag ? `-- tague "${obj.tag}"` : ""}
        </div>
      );
    }

    if (obj.error) {
      return <div className="text-[11px] text-red-400 pl-3">{String(obj.error)}</div>;
    }

    return (
      <pre className="text-[10px] text-muted-foreground pl-3 overflow-x-auto font-mono">
        {JSON.stringify(result, null, 2).slice(0, 500)}
      </pre>
    );
  } catch {
    return <div className="text-[10px] text-red-400 pl-3">Erreur d'affichage du resultat</div>;
  }
}
