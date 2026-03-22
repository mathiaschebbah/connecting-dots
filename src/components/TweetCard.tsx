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
  ai_cluster?: string | null;
  ai_summary?: string | null;
  ai_type?: string | null;
  ai_topics?: string[];
  has_media?: boolean;
}

const CAT_COLORS: Record<string, string> = {
  "ai/ml": "#7C3AED",
  "dev-tools": "#0891B2",
  "web": "#2563EB",
  "crypto": "#059669",
  "design": "#DB2777",
  "science": "#D97706",
  "business": "#EA580C",
  "politics": "#DC2626",
  "culture": "#65A30D",
  "other": "#71717A",
  // Legacy support
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
  tutorial: { icon: BookOpen, label: "Tutoriel", signal: "high" },
  announcement: { icon: Megaphone, label: "Annonce", signal: "high" },
  showcase: { icon: Lightbulb, label: "Démo", signal: "high" },
  thread: { icon: MessageSquare, label: "Thread", signal: "high" },
  resource: { icon: BookOpen, label: "Ressource", signal: "high" },
  alpha: { icon: Zap, label: "Alpha", signal: "high" },
  news: { icon: Newspaper, label: "Actu", signal: "mid" },
  discussion: { icon: MessageSquare, label: "Discussion", signal: "mid" },
  question: { icon: MessageSquare, label: "Question", signal: "mid" },
  opinion: { icon: Zap, label: "Opinion", signal: "low" },
  meme: { icon: Zap, label: "Meme", signal: "low" },
  personal: { icon: Zap, label: "Perso", signal: "low" },
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
  const isHighSignal = signal === "high";
  const isLowSignal = signal === "low";

  return (
    <div
      className={`group relative flex flex-col gap-4 rounded-xl border border-zinc-200/60 p-4 shadow-sm transition-all duration-200 ease-out hover:scale-[1.01] hover:shadow-md hover:border-zinc-300 cursor-pointer ${
        isHighSignal ? "border-l-[3px]" : "border-l border-l-zinc-200/60"
      } ${isLowSignal ? "bg-zinc-50/50 opacity-70 grayscale-[0.2] hover:opacity-100 hover:grayscale-0" : "bg-white"}`}
      style={{ borderLeftColor: catColor || "transparent" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0 shadow-inner ring-1 ring-black/5"
            style={{ backgroundColor: avatarColor + "15", color: avatarColor }}
          >
            {tweet.author_handle[0]?.toUpperCase()}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[13px] font-semibold text-zinc-900 truncate leading-none mb-1">
              {tweet.author_name || tweet.author_handle}
            </span>
            <span className="text-[11px] text-zinc-400 font-medium truncate leading-none">
              @{tweet.author_handle}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isHighSignal && (
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" title="Contenu signal fort" />
          )}
          <span className="text-[11px] text-zinc-400 font-medium whitespace-nowrap">
            {timeAgo(tweet.created_at)}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        {hasSummary ? (
          <div className="space-y-2">
            <p className="text-[14px] text-zinc-900 font-medium leading-snug tracking-tight">
              {tweet.ai_summary}
            </p>
            <p className={`text-[12px] text-zinc-400 leading-relaxed ${compact ? "line-clamp-1" : "line-clamp-2"}`}>
              {tweet.content}
            </p>
          </div>
        ) : (
          <p className={`text-[13px] text-zinc-700 leading-relaxed font-medium ${compact ? "line-clamp-2" : "line-clamp-4"}`}>
            {tweet.content}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {tweet.ai_cluster && catColor && (
          <span
            className="text-[11px] font-bold px-2.5 py-1 rounded-full border border-current/10"
            style={{ backgroundColor: catColor + "10", color: catColor }}
          >
            {tweet.ai_cluster}
          </span>
        )}
        {typeConf && (
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
            isHighSignal ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : "bg-zinc-100 text-zinc-600 border border-zinc-200/50"
          }`}>
            <typeConf.icon size={11} className={isHighSignal ? "text-emerald-500" : "text-zinc-400"} />
            {typeConf.label}
          </span>
        )}
        {tweet.ai_topics && tweet.ai_topics.length > 0 && !compact &&
          tweet.ai_topics.slice(0, 3).map((topic) => (
            <span key={topic} className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-zinc-50 text-zinc-500 border border-zinc-100 hover:bg-zinc-100 transition-colors">
              {topic}
            </span>
          ))
        }
      </div>

      <div className="flex items-center justify-between pt-3 mt-1 border-t border-zinc-100/80">
        <div className="flex items-center gap-4 text-zinc-400 font-medium">
          <span className="flex items-center gap-1.5 hover:text-red-500 transition-colors cursor-pointer group/stat">
            <Heart size={13} className="group-hover/stat:fill-red-500 transition-all" />
            <span className="text-[11px]">{fmt(tweet.likes)}</span>
          </span>
          <span className="flex items-center gap-1.5 hover:text-emerald-600 transition-colors cursor-pointer">
            <Repeat2 size={13} />
            <span className="text-[11px]">{fmt(tweet.retweets)}</span>
          </span>
          <span className="flex items-center gap-1.5 hover:text-violet-600 transition-colors cursor-pointer">
            <MessageCircle size={13} />
            <span className="text-[11px]">{fmt(tweet.replies_count)}</span>
          </span>
          {tweet.views > 0 && (
            <span className="flex items-center gap-1.5 opacity-60">
              <Eye size={13} />
              <span className="text-[11px]">{fmt(tweet.views)}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {tweet.has_media && <ImageIcon size={13} className="text-zinc-300" />}
          {tweet.tweet_url && (
            <a
              href={tweet.tweet_url} target="_blank" rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-zinc-300 hover:text-violet-600 transition-colors"
            >
              <ExternalLink size={13} />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/** Compact single-line row for dense list views */
export function TweetRow({ tweet }: { tweet: Tweet }) {
  const catColor = tweet.ai_category ? CAT_COLORS[tweet.ai_category] || CAT_COLORS.Other : null;
  const signal = getSignalLevel(tweet);
  const displayLabel = tweet.ai_cluster || tweet.ai_category;

  return (
    <div
      className="flex items-center gap-3 px-3 py-2 bg-white border border-zinc-200 rounded-md hover:border-zinc-300 transition-colors cursor-pointer border-l-2"
      style={{ borderLeftColor: catColor || "transparent" }}
    >
      {displayLabel && catColor && (
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 max-w-28 text-center truncate"
          style={{ backgroundColor: catColor + "10", color: catColor }}>
          {displayLabel}
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
