import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CAT_COLORS } from "./TweetCard";

interface TweetFull {
  id: string;
  author_id: string | null;
  author_handle: string;
  author_name: string | null;
  author_verified: boolean;
  content: string;
  created_at: string | null;
  conversation_id: string | null;
  language: string | null;
  tweet_url: string | null;
  reply_to_id: string | null;
  reply_to_handle: string | null;
  is_retweet: boolean;
  retweeted_by: string | null;
  media_json: string | null;
  quoted_tweet_json: string | null;
  likes: number;
  retweets: number;
  replies_count: number;
  quotes: number;
  bookmarks_count: number;
  views: number;
  source: string;
  ai_category: string | null;
  ai_summary: string | null;
  ai_topics: string[];
  ai_type: string | null;
  has_embedding: boolean;
}

interface SimilarTweet {
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

interface TagData {
  id: number;
  name: string;
  color: string | null;
}

interface TweetDetailResult {
  tweet: TweetFull;
  similar: SimilarTweet[];
  tags: TagData[];
}

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function getColor(cat: string | null): string {
  return CAT_COLORS[cat || "Other"] || CAT_COLORS.Other;
}

function getInitialColor(handle: string): string {
  const colors = ["#a78bfa", "#22d3ee", "#60a5fa", "#4ade80", "#f472b6", "#fbbf24", "#fb923c"];
  let hash = 0;
  for (const c of handle) hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

interface Props {
  tweetId: string;
  onClose: () => void;
  onNavigate?: (tweetId: string) => void;
}

export function TweetDetail({ tweetId, onClose, onNavigate }: Props) {
  const [data, setData] = useState<TweetDetailResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [newTag, setNewTag] = useState("");

  const loadDetail = () => {
    setLoading(true);
    invoke<TweetDetailResult>("get_tweet_detail", { tweetId })
      .then(setData)
      .catch((e) => console.error("Failed to load tweet:", e))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadDetail(); }, [tweetId]);

  const addTag = async () => {
    if (!newTag.trim()) return;
    try {
      await invoke("create_and_assign_tag", { tweetId, tagName: newTag.trim(), color: null });
      setNewTag("");
      loadDetail();
    } catch (e) {
      console.error("Failed to add tag:", e);
    }
  };

  const removeTag = async (tagId: number) => {
    try {
      await invoke("remove_tag_from_tweet", { tweetId, tagId });
      loadDetail();
    } catch (e) {
      console.error("Failed to remove tag:", e);
    }
  };

  if (loading) {
    return (
      <div className="w-[420px] border-l border-white/[0.06] bg-[#0a0a0e] flex items-center justify-center shrink-0">
        <div className="w-5 h-5 border-2 border-violet-500/20 border-t-violet-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) return null;
  const { tweet, similar } = data;
  const avatarColor = getInitialColor(tweet.author_handle);

  return (
    <div className="w-[420px] border-l border-white/[0.06] bg-[#0a0a0e] overflow-y-auto shrink-0">
      <div className="p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <span className="text-[10px] text-white/20 uppercase tracking-widest">Tweet</span>
          <button onClick={onClose} className="text-white/20 hover:text-white/60 text-[11px] transition-colors">
            Close
          </button>
        </div>

        {/* Author */}
        <div className="flex items-center gap-3 mb-4">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center text-[16px] font-bold shrink-0"
            style={{ backgroundColor: avatarColor + "25", color: avatarColor }}
          >
            {tweet.author_handle[0]?.toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-[14px] font-semibold text-white/90">
                {tweet.author_name || tweet.author_handle}
              </span>
              {tweet.author_verified && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="#60a5fa" className="shrink-0">
                  <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
            </div>
            <div className="text-[12px] text-white/30">@{tweet.author_handle}</div>
          </div>
        </div>

        {/* Content */}
        <p className="text-[14px] text-white/80 leading-[1.65] mb-4 whitespace-pre-wrap">
          {tweet.content}
        </p>

        {/* Date */}
        <div className="text-[11px] text-white/20 mb-4">
          {formatDate(tweet.created_at)}
        </div>

        {/* Engagement */}
        <div className="flex items-center gap-5 py-3 border-y border-white/[0.04] mb-4">
          <div className="text-center">
            <div className="text-[14px] font-semibold text-white/80 tabular-nums">{fmt(tweet.likes)}</div>
            <div className="text-[9px] text-white/20 uppercase tracking-wider">Likes</div>
          </div>
          <div className="text-center">
            <div className="text-[14px] font-semibold text-white/80 tabular-nums">{fmt(tweet.retweets)}</div>
            <div className="text-[9px] text-white/20 uppercase tracking-wider">Retweets</div>
          </div>
          <div className="text-center">
            <div className="text-[14px] font-semibold text-white/80 tabular-nums">{fmt(tweet.replies_count)}</div>
            <div className="text-[9px] text-white/20 uppercase tracking-wider">Replies</div>
          </div>
          <div className="text-center">
            <div className="text-[14px] font-semibold text-white/80 tabular-nums">{fmt(tweet.quotes)}</div>
            <div className="text-[9px] text-white/20 uppercase tracking-wider">Quotes</div>
          </div>
          {tweet.views > 0 && (
            <div className="text-center">
              <div className="text-[14px] font-semibold text-white/80 tabular-nums">{fmt(tweet.views)}</div>
              <div className="text-[9px] text-white/20 uppercase tracking-wider">Views</div>
            </div>
          )}
        </div>

        {/* AI Metadata */}
        {tweet.ai_category && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getColor(tweet.ai_category) }} />
              <span className="text-[11px] font-medium" style={{ color: getColor(tweet.ai_category) }}>
                {tweet.ai_category}
              </span>
              {tweet.ai_type && (
                <span className="text-[10px] text-white/15 px-2 py-0.5 rounded-full bg-white/[0.04]">
                  {tweet.ai_type}
                </span>
              )}
            </div>

            {tweet.ai_summary && (
              <p className="text-[12px] text-white/40 italic mb-2">{tweet.ai_summary}</p>
            )}

            {tweet.ai_topics.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {tweet.ai_topics.map((topic) => (
                  <span
                    key={topic}
                    className="text-[9px] px-2 py-0.5 rounded-full border border-white/[0.06] bg-white/[0.03] text-white/30"
                  >
                    {topic}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tags */}
        <div className="mb-4">
          <div className="flex flex-wrap gap-1.5 mb-2">
            {data.tags.map((tag) => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-full bg-violet-500/10 text-violet-300 border border-violet-500/20"
              >
                {tag.name}
                <button
                  onClick={() => removeTag(tag.id)}
                  className="text-violet-300/40 hover:text-violet-300 ml-0.5 transition-colors"
                >
                  x
                </button>
              </span>
            ))}
          </div>
          <form
            onSubmit={(e) => { e.preventDefault(); addTag(); }}
            className="flex gap-1.5"
          >
            <input
              type="text"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              placeholder="Add tag..."
              className="flex-1 px-3 py-1.5 bg-white/[0.03] border border-white/[0.06] rounded-lg text-[11px] text-white placeholder-white/15 focus:outline-none focus:border-violet-500/30 transition-all"
            />
            {newTag.trim() && (
              <button
                type="submit"
                className="px-3 py-1.5 bg-violet-500/20 text-violet-300 rounded-lg text-[11px] hover:bg-violet-500/30 transition-colors"
              >
                Add
              </button>
            )}
          </form>
        </div>

        {/* Reply info */}
        {tweet.reply_to_handle && (
          <div className="text-[11px] text-white/20 mb-4">
            Replying to <span className="text-violet-400">@{tweet.reply_to_handle}</span>
          </div>
        )}

        {/* Link to Twitter */}
        {tweet.tweet_url && (
          <div className="mb-4">
            <a
              href={tweet.tweet_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-violet-400/60 hover:text-violet-400 transition-colors"
            >
              View on X
            </a>
          </div>
        )}

        {/* Similar tweets */}
        {similar.length > 0 && (
          <div className="border-t border-white/[0.04] pt-4">
            <h4 className="text-[10px] text-white/20 uppercase tracking-widest mb-3">
              Similar tweets ({similar.length})
            </h4>
            <div className="space-y-1.5">
              {similar.map((t) => (
                <button
                  key={t.id}
                  onClick={() => onNavigate?.(t.id)}
                  className="w-full text-left p-3 rounded-xl hover:bg-white/[0.04] transition-all group"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div
                      className="w-5 h-5 rounded-full text-[8px] font-bold flex items-center justify-center"
                      style={{
                        backgroundColor: getInitialColor(t.author_handle) + "25",
                        color: getInitialColor(t.author_handle),
                      }}
                    >
                      {t.author_handle[0]?.toUpperCase()}
                    </div>
                    <span className="text-[11px] text-white/40 group-hover:text-white/70 truncate transition-colors">
                      @{t.author_handle}
                    </span>
                  </div>
                  <p className="text-[10px] text-white/20 group-hover:text-white/30 line-clamp-2 transition-colors">
                    {t.content}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
