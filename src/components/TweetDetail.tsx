import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, ExternalLink, Tag, Plus, Play, StickyNote, Pencil, Trash2 } from "lucide-react";
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

interface NoteData {
  id: number;
  tweet_id: string;
  content: string;
  created_at: string;
  updated_at: string;
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

function getInitialColor(handle: string): string {
  const colors = ["#7C3AED", "#0891B2", "#2563EB", "#059669", "#DB2777", "#D97706", "#EA580C"];
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
  const [notes, setNotes] = useState<NoteData[]>([]);
  const [newNote, setNewNote] = useState("");
  const [editingNote, setEditingNote] = useState<number | null>(null);
  const [editNoteContent, setEditNoteContent] = useState("");

  const loadDetail = () => {
    setLoading(true);
    invoke<TweetDetailResult>("get_tweet_detail", { tweetId })
      .then(setData)
      .catch((e) => console.error("Failed to load tweet:", e))
      .finally(() => setLoading(false));
  };

  const loadNotes = () => {
    invoke<NoteData[]>("get_tweet_notes", { tweetId })
      .then(setNotes)
      .catch((e) => console.error("Failed to load notes:", e));
  };

  useEffect(() => { loadDetail(); loadNotes(); }, [tweetId]);

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

  const addNote = async () => {
    if (!newNote.trim()) return;
    try {
      await invoke("create_tweet_note", { tweetId, content: newNote.trim() });
      setNewNote("");
      loadNotes();
    } catch (e) { console.error("Failed to add note:", e); }
  };

  const saveEditNote = async (noteId: number) => {
    if (!editNoteContent.trim()) return;
    try {
      await invoke("update_tweet_note", { noteId, content: editNoteContent.trim() });
      setEditingNote(null);
      loadNotes();
    } catch (e) { console.error("Failed to update note:", e); }
  };

  const deleteNote = async (noteId: number) => {
    try {
      await invoke("delete_tweet_note", { noteId });
      loadNotes();
    } catch (e) { console.error("Failed to delete note:", e); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-4 h-4 border-2 border-zinc-200 border-t-zinc-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) return null;

  return (
    <DetailContent
      data={data} onClose={onClose} onNavigate={onNavigate}
      newTag={newTag} setNewTag={setNewTag} addTag={addTag} removeTag={removeTag}
      notes={notes} newNote={newNote} setNewNote={setNewNote} addNote={addNote}
      editingNote={editingNote} editNoteContent={editNoteContent}
      setEditingNote={setEditingNote} setEditNoteContent={setEditNoteContent}
      saveEditNote={saveEditNote} deleteNote={deleteNote}
    />
  );
}

interface MediaItem {
  type?: string;
  media_url_https?: string;
  url?: string;
  preview_image_url?: string;
  sizes?: Record<string, { w: number; h: number }>;
}

interface QuotedTweet {
  id: string;
  text: string;
  author_handle: string;
  author_name?: string | null;
  tweet_url?: string | null;
  media?: MediaItem[];
}

function TweetMedia({ mediaJson }: { mediaJson: string }) {
  let items: MediaItem[];
  try { items = JSON.parse(mediaJson); } catch { return null; }
  if (!items || items.length === 0) return null;

  return (
    <div className={`grid gap-1.5 mb-3 rounded-lg overflow-hidden ${items.length === 1 ? "grid-cols-1" : items.length <= 4 ? "grid-cols-2" : "grid-cols-3"}`}>
      {items.map((m, i) => {
        const src = m.media_url_https || m.url || m.preview_image_url;
        if (!src) return null;
        const isVideo = m.type === "video" || m.type === "animated_gif";
        return (
          <div key={i} className="relative bg-zinc-100 rounded-md overflow-hidden">
            <img
              src={src}
              alt=""
              className="w-full h-auto object-cover rounded-md"
              style={{ maxHeight: items.length === 1 ? 360 : 200 }}
              loading="lazy"
            />
            {isVideo && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                <Play size={28} className="text-white drop-shadow-md" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function QuotedTweetCard({ json }: { json: string }) {
  let qt: QuotedTweet;
  try { qt = JSON.parse(json); } catch { return null; }
  if (!qt.text) return null;

  const avatarColor = getInitialColor(qt.author_handle);
  return (
    <div className="mb-3 p-3 border border-zinc-200 rounded-lg bg-zinc-50/50">
      <div className="flex items-center gap-2 mb-1.5">
        <div
          className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-semibold shrink-0"
          style={{ backgroundColor: avatarColor + "15", color: avatarColor }}
        >
          {qt.author_handle[0]?.toUpperCase()}
        </div>
        <span className="text-[12px] font-medium text-zinc-700">{qt.author_name || qt.author_handle}</span>
        <span className="text-[11px] text-zinc-400">@{qt.author_handle}</span>
      </div>
      <p className="text-[12px] text-zinc-600 leading-relaxed line-clamp-4 whitespace-pre-wrap">{qt.text}</p>
      {qt.media && qt.media.length > 0 && (
        <div className="mt-2">
          <TweetMedia mediaJson={JSON.stringify(qt.media)} />
        </div>
      )}
    </div>
  );
}

function DetailContent({ data, onClose, onNavigate, newTag, setNewTag, addTag, removeTag, notes, newNote, setNewNote, addNote, editingNote, editNoteContent, setEditingNote, setEditNoteContent, saveEditNote, deleteNote }: {
  data: TweetDetailResult;
  onClose: () => void;
  onNavigate?: (id: string) => void;
  newTag: string;
  setNewTag: (v: string) => void;
  addTag: () => void;
  removeTag: (id: number) => void;
  notes: NoteData[];
  newNote: string;
  setNewNote: (v: string) => void;
  addNote: () => void;
  editingNote: number | null;
  editNoteContent: string;
  setEditingNote: (id: number | null) => void;
  setEditNoteContent: (v: string) => void;
  saveEditNote: (id: number) => void;
  deleteNote: (id: number) => void;
}) {
  const { tweet, similar } = data;
  const avatarColor = getInitialColor(tweet.author_handle);
  const catColor = tweet.ai_category ? CAT_COLORS[tweet.ai_category] || "#71717A" : null;

  return (
    <div className="p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-semibold shrink-0"
            style={{ backgroundColor: avatarColor + "15", color: avatarColor }}
          >
            {tweet.author_handle[0]?.toUpperCase()}
          </div>
          <div>
            <span className="text-[13px] font-semibold text-zinc-900">
              {tweet.author_name || tweet.author_handle}
            </span>
            <div className="text-[11px] text-zinc-400">@{tweet.author_handle}</div>
          </div>
        </div>
        <button onClick={onClose} className="text-zinc-400 hover:text-zinc-900 p-1 rounded-md hover:bg-zinc-100 transition-colors">
          <X size={16} />
        </button>
      </div>

      {/* Reply info */}
      {tweet.reply_to_handle && (
        <div className="text-[11px] text-zinc-500 mb-2">
          Replying to <span className="text-violet-600 font-medium">@{tweet.reply_to_handle}</span>
        </div>
      )}

      {/* Content — the most important thing */}
      <p className="text-[14px] text-zinc-800 leading-[1.65] mb-3 whitespace-pre-wrap">
        {tweet.content}
      </p>

      {/* Media */}
      {tweet.media_json && <TweetMedia mediaJson={tweet.media_json} />}

      {/* Quoted tweet */}
      {tweet.quoted_tweet_json && <QuotedTweetCard json={tweet.quoted_tweet_json} />}

      {/* Date + engagement inline */}
      <div className="flex items-center gap-3 text-[11px] text-zinc-400 mb-4">
        <span>{formatDate(tweet.created_at)}</span>
        <span className="text-zinc-200">·</span>
        <span>{fmt(tweet.likes)} likes</span>
        <span>{fmt(tweet.retweets)} RT</span>
        <span>{fmt(tweet.replies_count)} replies</span>
        {tweet.views > 0 && <span>{fmt(tweet.views)} views</span>}
      </div>

      {/* AI Insight — second most important, prominent */}
      {tweet.ai_category && (
        <div
          className="mb-4 p-3 rounded-lg border-l-2"
          style={{ borderLeftColor: catColor!, backgroundColor: catColor + "06" }}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[12px] font-semibold" style={{ color: catColor! }}>
              {tweet.ai_category}
            </span>
            {tweet.ai_type && (
              <span className="text-[10px] text-zinc-400 px-1.5 py-0.5 rounded bg-white border border-zinc-200">
                {tweet.ai_type}
              </span>
            )}
          </div>

          {tweet.ai_summary && (
            <p className="text-[12px] text-zinc-600 leading-relaxed mb-2">{tweet.ai_summary}</p>
          )}

          {tweet.ai_topics.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tweet.ai_topics.map((topic) => (
                <span key={topic} className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-zinc-200 text-zinc-500">
                  {topic}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tags */}
      <div className="mb-4">
        <div className="flex items-center gap-1.5 mb-2">
          <Tag size={12} className="text-zinc-400" />
          <span className="text-[12px] font-medium text-zinc-500">Tags</span>
        </div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {data.tags.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md bg-violet-100 text-violet-700 border border-violet-200"
            >
              {tag.name}
              <button onClick={() => removeTag(tag.id)} className="text-violet-400 hover:text-violet-700 transition-colors">
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); addTag(); }} className="flex gap-1.5">
          <input
            type="text" value={newTag} onChange={(e) => setNewTag(e.target.value)}
            placeholder="Add tag..."
            className="flex-1 px-3 py-1.5 bg-zinc-50 border border-zinc-200 rounded-md text-[12px] text-zinc-900 placeholder-zinc-400 focus:outline-none focus:bg-white focus:border-violet-600 focus:ring-1 focus:ring-violet-600/20 transition-all"
          />
          {newTag.trim() && (
            <button type="submit" className="px-3 py-1.5 bg-zinc-900 text-white rounded-md text-[12px] font-medium hover:bg-zinc-800 transition-colors">
              <Plus size={14} />
            </button>
          )}
        </form>
      </div>

      {/* Notes */}
      <div className="mb-4">
        <div className="flex items-center gap-1.5 mb-2">
          <StickyNote size={12} className="text-zinc-400" />
          <span className="text-[12px] font-medium text-zinc-500">Notes</span>
          {notes.length > 0 && <span className="text-[10px] text-zinc-300">{notes.length}</span>}
        </div>
        {notes.map((note) => (
          <div key={note.id} className="mb-1.5 group">
            {editingNote === note.id ? (
              <div className="space-y-1">
                <textarea
                  value={editNoteContent}
                  onChange={(e) => setEditNoteContent(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-md text-[12px] text-zinc-900 focus:outline-none focus:border-violet-600 focus:ring-1 focus:ring-violet-600/20 resize-none"
                  rows={3} autoFocus
                />
                <div className="flex gap-1">
                  <button onClick={() => saveEditNote(note.id)} className="px-2 py-1 bg-zinc-900 text-white rounded text-[10px] font-medium">Save</button>
                  <button onClick={() => setEditingNote(null)} className="px-2 py-1 text-zinc-400 text-[10px]">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 p-2 rounded-md hover:bg-zinc-50 transition-colors">
                <p className="flex-1 text-[12px] text-zinc-600 whitespace-pre-wrap">{note.content}</p>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button onClick={() => { setEditingNote(note.id); setEditNoteContent(note.content); }}
                    className="text-zinc-300 hover:text-zinc-700 p-0.5"><Pencil size={10} /></button>
                  <button onClick={() => deleteNote(note.id)}
                    className="text-zinc-300 hover:text-red-500 p-0.5"><Trash2 size={10} /></button>
                </div>
              </div>
            )}
          </div>
        ))}
        <form onSubmit={(e) => { e.preventDefault(); addNote(); }} className="flex gap-1.5">
          <input
            type="text" value={newNote} onChange={(e) => setNewNote(e.target.value)}
            placeholder="Add a note..."
            className="flex-1 px-3 py-1.5 bg-zinc-50 border border-zinc-200 rounded-md text-[12px] text-zinc-900 placeholder-zinc-400 focus:outline-none focus:bg-white focus:border-violet-600 focus:ring-1 focus:ring-violet-600/20 transition-all"
          />
          {newNote.trim() && (
            <button type="submit" className="px-3 py-1.5 bg-zinc-900 text-white rounded-md text-[12px] font-medium hover:bg-zinc-800 transition-colors">
              <Plus size={14} />
            </button>
          )}
        </form>
      </div>

      {/* Link to Twitter */}
      {tweet.tweet_url && (
        <div className="mb-4">
          <a
            href={tweet.tweet_url} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-violet-600 font-medium hover:bg-violet-50 px-2 py-1 rounded-md transition-colors"
          >
            <ExternalLink size={12} />
            View on X
          </a>
        </div>
      )}

      {/* Similar tweets — the connections */}
      {similar.length > 0 && (
        <div className="border-t border-zinc-200 pt-4">
          <h4 className="text-[12px] font-medium text-zinc-500 mb-3">
            Connected ({similar.length})
          </h4>
          <div className="space-y-1">
            {similar.map((t) => (
              <button
                key={t.id}
                onClick={() => onNavigate?.(t.id)}
                className="w-full text-left p-2.5 rounded-md hover:bg-zinc-50 transition-colors"
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <div
                    className="w-4 h-4 rounded-full text-[7px] font-bold flex items-center justify-center"
                    style={{
                      backgroundColor: getInitialColor(t.author_handle) + "15",
                      color: getInitialColor(t.author_handle),
                    }}
                  >
                    {t.author_handle[0]?.toUpperCase()}
                  </div>
                  <span className="text-[11px] text-zinc-500 truncate">@{t.author_handle}</span>
                </div>
                <p className="text-[11px] text-zinc-400 line-clamp-2">{t.content}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
