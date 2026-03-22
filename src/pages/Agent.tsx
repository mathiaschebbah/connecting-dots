import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
        case "tool_result":
          const tools = currentAssistant.current.tools;
          const last = tools[tools.length - 1];
          if (last && last.tool === e.tool) {
            last.result = e.result;
          }
          updateAssistantMessage();
          break;
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

  const sendMessage = async () => {
    if (!input.trim() || isRunning) return;
    const msg = input.trim();
    setInput("");
    setIsRunning(true);

    const userMsg: ChatMsg = { role: "user", content: msg };
    setMessages((prev) => [...prev, userMsg]);

    currentAssistant.current = { text: "", tools: [] };

    // Build history for Claude (simplified)
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

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-5 py-3 border-b border-white/[0.06] bg-[#0c0c10]/90">
        <h2 className="text-[15px] font-semibold text-white/90">Agent</h2>
        <p className="text-[11px] text-white/25">Ask anything about your bookmarks and Twitter</p>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-4 py-20">
            <div className="w-12 h-12 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="1.5">
                <path d="M12 2a3 3 0 0 0-3 3v1H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3V5a3 3 0 0 0-3-3z" />
                <circle cx="9" cy="13" r="1" fill="#a78bfa" />
                <circle cx="15" cy="13" r="1" fill="#a78bfa" />
              </svg>
            </div>
            <div>
              <p className="text-[13px] text-white/40 mb-2">What do you want to explore?</p>
              <div className="flex flex-col gap-2">
                {[
                  "Find tweets about AI agents in my bookmarks",
                  "What are the main topics I've bookmarked?",
                  "Search Twitter for the latest on Claude Code",
                  "Connect my RAG bookmarks with the embedding ones",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => { setInput(suggestion); }}
                    className="text-[11px] text-violet-400/50 hover:text-violet-400 px-3 py-1.5 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] border border-white/[0.04] transition-all text-left"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`${msg.role === "user" ? "flex justify-end" : ""}`}>
            {msg.role === "user" ? (
              <div className="max-w-[80%] px-4 py-2.5 rounded-2xl bg-violet-500/20 text-[13px] text-white/90">
                {msg.content}
              </div>
            ) : (
              <div className="max-w-full">
                {/* Tool results */}
                {msg.tools?.map((tool, j) => (
                  <div key={j} className="mb-3">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-violet-400" />
                      <span className="text-[10px] text-violet-400/60 uppercase tracking-wider font-medium">
                        {tool.tool.replace(/_/g, " ")}
                      </span>
                      {!tool.result && (
                        <div className="w-3 h-3 border border-violet-500/30 border-t-violet-500 rounded-full animate-spin" />
                      )}
                    </div>
                    {tool.result && renderToolResult(tool.tool, tool.result)}
                  </div>
                ))}

                {/* Text */}
                {msg.content && (
                  <div className="text-[13px] text-white/70 leading-relaxed whitespace-pre-wrap">
                    {msg.content}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {isRunning && messages[messages.length - 1]?.role !== "assistant" && (
          <div className="flex items-center gap-2 text-[12px] text-white/20">
            <div className="w-4 h-4 border-2 border-violet-500/20 border-t-violet-500 rounded-full animate-spin" />
            Thinking...
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-4 border-t border-white/[0.06]">
        <form
          onSubmit={(e) => { e.preventDefault(); sendMessage(); }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask the agent..."
            disabled={isRunning}
            className="flex-1 px-4 py-3 bg-white/[0.04] border border-white/[0.06] rounded-xl text-[13px] text-white placeholder-white/20 focus:outline-none focus:border-violet-500/40 transition-all disabled:opacity-50"
            autoFocus
          />
          <button
            type="submit"
            disabled={isRunning || !input.trim()}
            className="px-5 py-3 bg-violet-500 text-white rounded-xl text-[13px] font-medium hover:bg-violet-400 disabled:opacity-30 transition-all"
          >
            Send
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

function renderToolResult(tool: string, result: unknown) {
  try {
    if (!result || typeof result !== "object") return null;

    // Handle arrays (tweets)
    if (Array.isArray(result) && result.length > 0) {
      const tweets = result.map(normalizeTweet).filter(Boolean) as Tweet[];
      if (tweets.length > 0) {
        return (
          <div className="space-y-1.5 pl-3 border-l-2 border-violet-500/10">
            {tweets.slice(0, 5).map((tweet, i) => (
              <TweetCard key={tweet.id || i} tweet={tweet} compact />
            ))}
            {tweets.length > 5 && (
              <div className="text-[10px] text-white/20 pl-4">
                +{tweets.length - 5} more
              </div>
            )}
          </div>
        );
      }
    }

    const obj = result as Record<string, unknown>;

    // Single tweet
    if (obj.author_handle) {
      const tweet = normalizeTweet(obj);
      if (tweet) {
        return (
          <div className="pl-3 border-l-2 border-violet-500/10">
            <TweetCard tweet={tweet} compact />
          </div>
        );
      }
    }

    // Success
    if (obj.success) {
      return (
        <div className="text-[11px] text-emerald-400/60 pl-3">
          Done {obj.tag ? `— tagged as "${obj.tag}"` : ""}
        </div>
      );
    }

    // Error
    if (obj.error) {
      return <div className="text-[11px] text-red-400/60 pl-3">{String(obj.error)}</div>;
    }

    // Fallback: show as JSON
    return (
      <pre className="text-[10px] text-white/20 pl-3 overflow-x-auto">
        {JSON.stringify(result, null, 2).slice(0, 500)}
      </pre>
    );
  } catch {
    return <div className="text-[10px] text-red-400/40 pl-3">Failed to render result</div>;
  }
}
