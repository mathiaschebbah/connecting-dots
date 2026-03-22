import { Heart, Repeat2, MessageCircle, Eye, Zap, BookOpen, Megaphone, MessageSquare, Lightbulb, Newspaper, Image as ImageIcon, ExternalLink } from "lucide-react";

interface Tweet {
  id: string;
  author_handle: string;
  author_name: string | null;
  content: string;
  created_at: string | null;
  tweet_url: string | null;
  likes: number;
  retweets: number;
  replies_count: number;
  views: number;
  source: string;
  ai_category?: string | null;
  ai_summary?: string | null;
  ai_type?: string | null;
  ai_topics?: string[];
  has_media?: boolean;
}

const CAT_COLORS: Record<string, string> = {
  AI: "#7C3AED",
  "Dev Tools": "#0891B2",
  "Web Dev": "#2563EB",
  "Crypto/Finance": "#059669",
  Design: "#DB2777",
  Science: "#D97706",
  Business: "#EA580C",
  Politics: "#DC2626",
  Humor: "#65A30D",
  Personal: "#64748B",
  Other: "#71717A",
};

const TYPE_CONFIG: Record<string, { icon: typeof Zap; label: string; signal: "high" | "mid" | "low" }> = {
  tutorial: { icon: BookOpen, label: "Tutorial", signal: "high" },
  announcement: { icon: Megaphone, label: "Announcement", signal: "high" },
  showcase: { icon: Lightbulb, label: "Showcase", signal: "high" },
  thread: { icon: MessageSquare, label: "Thread", signal: "high" },
  news: { icon: Newspaper, label: "News", signal: "mid" },
  discussion: { icon: MessageSquare, label: "Discussion", signal: "mid" },
  question: { icon: MessageSquare, label: "Question", signal: "mid" },
  opinion: { icon: Zap, label: "Opinion", signal: "low" },
  meme: { icon: Zap, label: "Meme", signal: "low" },
  personal: { icon: Zap, label: "Personal", signal: "low" },
};

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr.slice(0, 10);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getInitialColor(handle: string): string {
  const colors = ["#7C3AED", "#0891B2", "#2563EB", "#059669", "#DB2777", "#D97706", "#EA580C"];
  let hash = 0;
  for (const c of handle) hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

function getSignalLevel(tweet: Tweet): "high" | "mid" | "low" | null {
  const typeConf = tweet.ai_type ? TYPE_CONFIG[tweet.ai_type] : null;
  if (typeConf) return typeConf.signal;
  return null;
}

export function TweetCard({ tweet, compact }: { tweet: Tweet; compact?: boolean }) {
  const avatarColor = getInitialColor(tweet.author_handle);
  const catColor = tweet.ai_category ? CAT_COLORS[tweet.ai_category] || CAT_COLORS.Other : null;
  const typeConf = tweet.ai_type ? TYPE_CONFIG[tweet.ai_type] : null;
  const signal = getSignalLevel(tweet);
  const hasSummary = tweet.ai_summary && tweet.ai_summary.length > 5;

  return (
    <div
      className="bg-white border border-zinc-200 rounded-lg p-4 hover:border-zinc-300 transition-colors cursor-pointer border-l-2"
      style={{ borderLeftColor: catColor || "transparent" }}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-semibold shrink-0"
          style={{ backgroundColor: avatarColor + "15", color: avatarColor }}
        >
          {tweet.author_handle[0]?.toUpperCase()}
        </div>

        <div className="flex-1 min-w-0">
          {/* Header: author + meta */}
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[13px] font-medium text-zinc-900 truncate">
              {tweet.author_name || tweet.author_handle}
            </span>
            <span className="text-[12px] text-zinc-400 truncate">
              @{tweet.author_handle}
            </span>
            <span className="text-[11px] text-zinc-300 ml-auto shrink-0">
              {timeAgo(tweet.created_at)}
            </span>
          </div>

          {/* AI Summary (primary) or content (fallback) */}
          {hasSummary ? (
            <>
              <p className="text-[13px] text-zinc-800 font-medium leading-relaxed mb-1">
                {tweet.ai_summary}
              </p>
              <p className={`text-[12px] text-zinc-400 leading-relaxed ${compact ? "line-clamp-1" : "line-clamp-2"}`}>
                {tweet.content}
              </p>
            </>
          ) : (
            <p className={`text-[13px] text-zinc-700 leading-relaxed ${compact ? "line-clamp-2" : "line-clamp-4"}`}>
              {tweet.content}
            </p>
          )}

          {/* Topics */}
          {tweet.ai_topics && tweet.ai_topics.length > 0 && !compact && (
            <div className="flex flex-wrap gap-1 mt-2">
              {tweet.ai_topics.slice(0, 4).map((topic) => (
                <span key={topic} className="text-[10px] text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-50 border border-zinc-100">
                  {topic}
                </span>
              ))}
            </div>
          )}

          {/* Footer: category + type + signal + engagement */}
          <div className="flex items-center gap-2 mt-2 text-[11px]">
            {catColor && (
              <span
                className="inline-flex items-center gap-1 font-medium px-1.5 py-0.5 rounded"
                style={{ backgroundColor: catColor + "10", color: catColor }}
              >
                {tweet.ai_category}
              </span>
            )}
            {typeConf && (
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                signal === "high" ? "bg-emerald-50 text-emerald-700" :
                signal === "mid" ? "bg-zinc-100 text-zinc-600" :
                "bg-zinc-50 text-zinc-400"
              }`}>
                <typeConf.icon size={10} />
                {typeConf.label}
              </span>
            )}

            <div className="flex items-center gap-3 ml-auto text-zinc-400">
              {tweet.has_media && (
                <span className="flex items-center gap-1 text-zinc-300">
                  <ImageIcon size={12} />
                </span>
              )}
              <span className="flex items-center gap-1 hover:text-red-500 cursor-pointer transition-colors">
                <Heart size={12} /> {fmt(tweet.likes)}
              </span>
              <span className="flex items-center gap-1 hover:text-emerald-600 cursor-pointer transition-colors">
                <Repeat2 size={12} /> {fmt(tweet.retweets)}
              </span>
              <span className="flex items-center gap-1 hover:text-violet-600 cursor-pointer transition-colors">
                <MessageCircle size={12} /> {fmt(tweet.replies_count)}
              </span>
              {tweet.views > 0 && (
                <span className="flex items-center gap-1">
                  <Eye size={12} /> {fmt(tweet.views)}
                </span>
              )}
              {tweet.tweet_url && (
                <a
                  href={tweet.tweet_url} target="_blank" rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-1 hover:text-violet-600 transition-colors"
                >
                  <ExternalLink size={11} />
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Compact single-line row for dense list views */
export function TweetRow({ tweet }: { tweet: Tweet }) {
  const catColor = tweet.ai_category ? CAT_COLORS[tweet.ai_category] || CAT_COLORS.Other : null;
  const signal = getSignalLevel(tweet);

  return (
    <div
      className="flex items-center gap-3 px-3 py-2 bg-white border border-zinc-200 rounded-md hover:border-zinc-300 transition-colors cursor-pointer border-l-2"
      style={{ borderLeftColor: catColor || "transparent" }}
    >
      {catColor && (
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 w-20 text-center truncate"
          style={{ backgroundColor: catColor + "10", color: catColor }}>
          {tweet.ai_category}
        </span>
      )}
      {!catColor && <span className="w-20 shrink-0" />}
      {signal && (
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
          signal === "high" ? "bg-emerald-500" : signal === "mid" ? "bg-zinc-400" : "bg-zinc-200"
        }`} />
      )}
      <span className="text-[11px] text-zinc-400 shrink-0 w-24 truncate">@{tweet.author_handle}</span>
      <span className="text-[12px] text-zinc-700 truncate flex-1">
        {tweet.ai_summary || tweet.content}
      </span>
      <span className="text-[11px] text-zinc-300 shrink-0">{timeAgo(tweet.created_at)}</span>
    </div>
  );
}

export type { Tweet };
export { CAT_COLORS };
