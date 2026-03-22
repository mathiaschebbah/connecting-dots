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
}

const CAT_COLORS: Record<string, string> = {
  AI: "#a78bfa",
  "Dev Tools": "#22d3ee",
  "Web Dev": "#60a5fa",
  "Crypto/Finance": "#4ade80",
  Design: "#f472b6",
  Science: "#fbbf24",
  Business: "#fb923c",
  Politics: "#f87171",
  Humor: "#bef264",
  Personal: "#cbd5e1",
  Other: "#9ca3af",
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
  const colors = ["#a78bfa", "#22d3ee", "#60a5fa", "#4ade80", "#f472b6", "#fbbf24", "#fb923c"];
  let hash = 0;
  for (const c of handle) hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

export function TweetCard({ tweet, compact }: { tweet: Tweet; compact?: boolean }) {
  const avatarColor = getInitialColor(tweet.author_handle);

  return (
    <div className="group p-4 rounded-xl bg-white/[0.03] border border-white/[0.05] hover:border-white/[0.1] hover:bg-white/[0.05] transition-all duration-200 cursor-pointer">
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-semibold text-white shrink-0"
          style={{ backgroundColor: avatarColor + "30", color: avatarColor }}
        >
          {tweet.author_handle[0]?.toUpperCase()}
        </div>

        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[13px] font-medium text-white/90 truncate">
              {tweet.author_name || tweet.author_handle}
            </span>
            <span className="text-[12px] text-white/30 truncate">
              @{tweet.author_handle}
            </span>
            <span className="text-[11px] text-white/20 ml-auto shrink-0">
              {timeAgo(tweet.created_at)}
            </span>
          </div>

          {/* Content */}
          <p className={`text-[13px] text-white/70 leading-[1.55] ${compact ? "line-clamp-2" : "line-clamp-4"}`}>
            {tweet.content}
          </p>

          {/* Engagement */}
          <div className="flex items-center gap-4 mt-2.5 text-[11px] text-white/25">
            <span className="flex items-center gap-1">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>
              {fmt(tweet.likes)}
            </span>
            <span className="flex items-center gap-1">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>
              {fmt(tweet.retweets)}
            </span>
            <span className="flex items-center gap-1">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
              {fmt(tweet.replies_count)}
            </span>
            {tweet.views > 0 && (
              <span className="flex items-center gap-1">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                {fmt(tweet.views)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export type { Tweet };
export { CAT_COLORS };
