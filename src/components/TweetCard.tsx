import { Heart, Repeat2, MessageCircle, Eye, ExternalLink } from "lucide-react";
import { cn } from "../lib/utils";

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
  if (days < 30) return `${days}j`;
  return date.toLocaleDateString("fr-FR", { month: "short", day: "numeric" });
}

function getInitialColor(handle: string): string {
  const colors = ["#8B7EC8", "#5BA3B5", "#6B8DD6", "#5AAF82", "#C27090", "#BFA050", "#C28050"];
  let hash = 0;
  for (const c of handle) hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

function isUselessSummary(summary: string | null | undefined): boolean {
  if (!summary || summary.length < 5) return true;
  const noise = ["sans contenu", "contenu non", "unknown", "lien vers", "article x"];
  return noise.some((n) => summary.toLowerCase().includes(n));
}

function isLinkOnly(content: string): boolean {
  const stripped = content.replace(/https?:\/\/\S+/g, "").trim();
  return stripped.length < 20;
}

function extractArticleUrl(content: string): string | null {
  const match = content.match(/(https?:\/\/x\.com\/i\/article\/\S+)/);
  return match ? match[1] : null;
}

export function TweetCard({ tweet, compact }: { tweet: Tweet; compact?: boolean }) {
  const avatarColor = getInitialColor(tweet.author_handle);
  const hasSummary = !isUselessSummary(tweet.ai_summary);
  const linkOnly = isLinkOnly(tweet.content);
  const articleUrl = extractArticleUrl(tweet.content);

  return (
    <div
      className={cn(
        "group relative flex flex-col gap-3 bg-card border border-border rounded-lg p-4",
        "hover:border-muted-fg/30 transition-all duration-150 cursor-pointer"
      )}
    >
      {/* Author row */}
      <div className="flex items-center gap-3">
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0"
          style={{ backgroundColor: avatarColor + "18", color: avatarColor }}
        >
          {tweet.author_handle[0]?.toUpperCase()}
        </div>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-[13px] font-medium text-card-fg truncate">
            {tweet.author_name || tweet.author_handle}
          </span>
          <span className="text-xs text-muted-fg truncate">
            @{tweet.author_handle}
          </span>
        </div>
        <span className="text-[11px] text-muted-fg shrink-0 tabular-nums">
          {timeAgo(tweet.created_at)}
        </span>
      </div>

      {/* Content */}
      {hasSummary ? (
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-card-fg leading-snug">
            {tweet.ai_summary}
          </p>
          {!linkOnly && (
            <p className={cn("text-xs text-muted-fg leading-relaxed", compact ? "line-clamp-1" : "line-clamp-2")}>
              {tweet.content}
            </p>
          )}
        </div>
      ) : linkOnly ? (
        <div className="flex items-center gap-2">
          {articleUrl ? (
            <span className="text-xs text-muted-fg flex items-center gap-1.5">
              <ExternalLink size={11} />
              Article X
            </span>
          ) : (
            <span className="text-xs text-muted-fg italic">
              Lien en cours de resolution...
            </span>
          )}
        </div>
      ) : (
        <p className={cn("text-[13px] text-fg/70 leading-relaxed", compact ? "line-clamp-2" : "line-clamp-4")}>
          {tweet.content}
        </p>
      )}

      {/* Topics */}
      {tweet.ai_topics && tweet.ai_topics.length > 0 && !compact && (
        <div className="flex flex-wrap gap-1.5">
          {tweet.ai_topics.slice(0, 3).map((topic) => (
            <span
              key={topic}
              className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-secondary text-muted-fg border border-border"
            >
              {topic}
            </span>
          ))}
        </div>
      )}

      {/* Metrics */}
      <div className="flex items-center gap-4 text-muted-fg">
        {tweet.likes > 0 && (
          <span className="flex items-center gap-1">
            <Heart size={12} />
            <span className="text-[11px] tabular-nums">{fmt(tweet.likes)}</span>
          </span>
        )}
        {tweet.retweets > 0 && (
          <span className="flex items-center gap-1">
            <Repeat2 size={12} />
            <span className="text-[11px] tabular-nums">{fmt(tweet.retweets)}</span>
          </span>
        )}
        {tweet.replies_count > 0 && (
          <span className="flex items-center gap-1">
            <MessageCircle size={12} />
            <span className="text-[11px] tabular-nums">{fmt(tweet.replies_count)}</span>
          </span>
        )}
        {tweet.views > 0 && (
          <span className="flex items-center gap-1 opacity-60">
            <Eye size={12} />
            <span className="text-[11px] tabular-nums">{fmt(tweet.views)}</span>
          </span>
        )}

        <div className="flex-1" />

        {tweet.tweet_url && (
          <a
            href={tweet.tweet_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-muted-fg hover:text-fg transition-colors opacity-0 group-hover:opacity-100"
          >
            <ExternalLink size={12} />
          </a>
        )}
      </div>
    </div>
  );
}

// Legacy stub
export function TweetRow({ tweet }: { tweet: Tweet }) {
  return <TweetCard tweet={tweet} compact />;
}

export type { Tweet };
