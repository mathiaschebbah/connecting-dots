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

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return date.toLocaleDateString();
}

export function TweetCard({ tweet }: { tweet: Tweet }) {
  return (
    <div className="p-4 bg-neutral-900 rounded-lg border border-neutral-800 hover:border-neutral-700 transition-colors">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-8 h-8 rounded-full bg-neutral-800 flex items-center justify-center text-xs font-bold text-neutral-400">
          {tweet.author_handle[0]?.toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-white truncate">
              {tweet.author_name || tweet.author_handle}
            </span>
            <span className="text-xs text-neutral-500 truncate">
              @{tweet.author_handle}
            </span>
          </div>
        </div>
        <span className="text-xs text-neutral-600 shrink-0">
          {timeAgo(tweet.created_at)}
        </span>
      </div>

      <p className="text-sm text-neutral-300 leading-relaxed mb-3 line-clamp-4">
        {tweet.content}
      </p>

      <div className="flex items-center gap-4 text-xs text-neutral-500">
        <span>{formatNumber(tweet.likes)} likes</span>
        <span>{formatNumber(tweet.retweets)} RT</span>
        <span>{formatNumber(tweet.replies_count)} replies</span>
        {tweet.views > 0 && <span>{formatNumber(tweet.views)} views</span>}
        <div className="flex-1" />
        <span className="px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 text-[10px]">
          {tweet.source}
        </span>
      </div>
    </div>
  );
}

export type { Tweet };
