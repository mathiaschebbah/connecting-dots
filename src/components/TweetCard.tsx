import { useState } from "react";
import { Heart, Repeat2, MessageCircle, BarChart2, FolderOutput, Loader2 } from "lucide-react";
import { cn } from "../lib/utils";
import { DotPicker } from "./DotPicker";

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
  author_avatar?: string | null;
}

interface MoveAction {
  currentDotSlug?: string | null;
  onMove: (toSlug: string, reason?: string) => Promise<void> | void;
  busy?: boolean;
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
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }).replace(".", "");
}

function getInitialColor(handle: string): string {
  const colors = ["#7856FF", "#2795D9", "#17BF63", "#E0245E", "#F45D22", "#794BC4", "#1DA1F2"];
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
  return content.replace(/https?:\/\/\S+/g, "").trim().length < 20;
}

function Avatar({ handle, avatarUrl }: { handle: string; avatarUrl?: string | null }) {
  const color = getInitialColor(handle);

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={handle}
        className="w-10 h-10 rounded-full shrink-0 bg-secondary object-cover"
        loading="lazy"
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden"); }}
      />
    );
  }

  return (
    <div
      className="w-10 h-10 rounded-full flex items-center justify-center text-[14px] font-bold shrink-0"
      style={{ backgroundColor: color + "25", color }}
    >
      {handle[0]?.toUpperCase()}
    </div>
  );
}

export function TweetCard({
  tweet,
  compact,
  hideTags,
  moveAction,
}: {
  tweet: Tweet;
  compact?: boolean;
  hideTags?: boolean;
  moveAction?: MoveAction;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const hasSummary = !isUselessSummary(tweet.ai_summary);
  const linkOnly = isLinkOnly(tweet.content);

  return (
    <div
      className={cn(
        "group flex gap-3 px-4 py-3 border-b border-border",
        "hover:bg-white/[0.03] transition-colors duration-100 cursor-pointer"
      )}
    >
      {/* Avatar */}
      <Avatar handle={tweet.author_handle} avatarUrl={tweet.author_avatar} />

      {/* Content column */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2">
          {/* Name · @handle · time — single line like X */}
          <div className="flex min-w-0 flex-1 items-center gap-1 leading-5">
            <span className="text-[15px] font-bold text-foreground truncate">
              {tweet.author_name || tweet.author_handle}
            </span>
            <span className="text-[15px] text-muted-foreground truncate">
              @{tweet.author_handle}
            </span>
            <span className="text-muted-foreground shrink-0">·</span>
            <span className="text-[15px] text-muted-foreground shrink-0 whitespace-nowrap">
              {timeAgo(tweet.created_at)}
            </span>
          </div>

          {moveAction && (
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setPickerOpen((open) => !open);
                }}
                className={cn(
                  "rounded-full p-2 text-muted-foreground transition-all hover:bg-white/[0.08] hover:text-foreground",
                  pickerOpen
                    ? "opacity-100"
                    : "opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100"
                )}
                aria-label="Déplacer vers un autre dot"
              >
                {moveAction.busy ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <FolderOutput size={15} />
                )}
              </button>
              <DotPicker
                open={pickerOpen}
                onClose={() => setPickerOpen(false)}
                excludeSlug={moveAction.currentDotSlug}
                onSelect={async (dot, reason) => {
                  await moveAction.onMove(dot.slug, reason || undefined);
                }}
              />
            </div>
          )}
        </div>

        {/* AI Summary — subtle, not competing with content */}
        {hasSummary && (
          <p className="text-[15px] font-semibold text-foreground leading-5 mt-0.5">
            {tweet.ai_summary}
          </p>
        )}

        {/* Tweet content */}
        {!linkOnly && (
          <p className={cn(
            "text-[15px] text-foreground leading-5 mt-0.5",
            hasSummary ? "text-muted-foreground" : "",
            compact ? "line-clamp-2" : "line-clamp-4"
          )}>
            {tweet.content}
          </p>
        )}

        {/* Topics */}
        {tweet.ai_topics && tweet.ai_topics.length > 0 && !compact && !hideTags && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {tweet.ai_topics.slice(0, 3).map((topic) => (
              <span key={topic} className="text-[13px] px-2.5 py-0.5 rounded-full bg-[#1d9bf0]/10 text-[#1d9bf0]">
                {topic}
              </span>
            ))}
          </div>
        )}

        {/* Metrics — spread across full width like X */}
        <div className="flex items-center mt-2 -ml-2">
          <div className="flex-1 group/reply flex items-center gap-1 text-muted-foreground hover:text-[#1d9bf0] transition-colors duration-150 cursor-pointer p-2 rounded-full">
            <MessageCircle size={16} className="transition-transform duration-150 group-hover/reply:scale-110" />
            {tweet.replies_count > 0 && <span className="text-[13px] leading-4">{fmt(tweet.replies_count)}</span>}
          </div>
          <div className="flex-1 group/rt flex items-center gap-1 text-muted-foreground hover:text-[#00ba7c] transition-colors duration-150 cursor-pointer p-2 rounded-full">
            <Repeat2 size={16} className="transition-transform duration-150 group-hover/rt:scale-110" />
            {tweet.retweets > 0 && <span className="text-[13px] leading-4">{fmt(tweet.retweets)}</span>}
          </div>
          <div className="flex-1 group/like flex items-center gap-1 text-muted-foreground hover:text-[#f91880] transition-colors duration-150 cursor-pointer p-2 rounded-full">
            <Heart size={16} className="transition-transform duration-150 group-hover/like:scale-110" />
            {tweet.likes > 0 && <span className="text-[13px] leading-4">{fmt(tweet.likes)}</span>}
          </div>
          {tweet.views > 0 && (
            <div className="flex-1 flex items-center gap-1 text-muted-foreground hover:text-[#1d9bf0] transition-colors duration-150 cursor-pointer p-2 rounded-full">
              <BarChart2 size={16} />
              <span className="text-[13px] leading-4">{fmt(tweet.views)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export type { Tweet };
