import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { motion } from "framer-motion";
import {
  ArrowLeft, ExternalLink, Tag, StickyNote, Pencil, Trash2,
  Heart, Repeat2, MessageCircle, Eye, Send, Loader2, Bot,
} from "lucide-react";
import { useAppStore } from "../stores/appStore";
import { TweetCard, type Tweet } from "../components/TweetCard";
import { cn, dotName } from "../lib/utils";

interface TweetFull {
  id: string;
  author_handle: string;
  author_name: string | null;
  author_verified: boolean;
  content: string;
  created_at: string | null;
  conversation_id: string | null;
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
  ai_cluster: string | null;
  ai_summary: string | null;
  ai_topics: string[];
  ai_type: string | null;
  has_embedding: boolean;
  resolved_content: string | null;
  resolved_author: string | null;
  resolved_url: string | null;
}

interface TagData { id: number; name: string; color: string | null }
interface NoteData { id: number; tweet_id: string; content: string; created_at: string; updated_at: string }
interface TweetDetailResult { tweet: TweetFull; similar: Tweet[]; tags: TagData[] }
interface ThreadTweet { id: string; author_handle: string; author_name: string | null; content: string; created_at: string | null; tweet_url: string | null; likes: number; retweets: number; replies_count: number; views: number }
interface AgentEvent { type: string; text?: string; tool?: string; result?: unknown; message?: string }
interface ChatMsg { role: "user" | "assistant"; content: string }

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function getInitialColor(handle: string): string {
  const colors = ["#8B7EC8", "#5BA3B5", "#6B8DD6", "#5AAF82", "#C27090", "#BFA050", "#C28050"];
  let hash = 0;
  for (const c of handle) hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

export function TweetPage({ tweetId, fromDot }: { tweetId: string; fromDot?: string }) {
  const [data, setData] = useState<TweetDetailResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [newTag, setNewTag] = useState("");
  const [notes, setNotes] = useState<NoteData[]>([]);
  const [newNote, setNewNote] = useState("");
  const [editingNote, setEditingNote] = useState<number | null>(null);
  const [editNoteContent, setEditNoteContent] = useState("");
  const [thread, setThread] = useState<ThreadTweet[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatRunning, setChatRunning] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const currentText = useRef("");
  const navigate = useAppStore((s) => s.navigate);
  const back = useAppStore((s) => s.back);

  useEffect(() => { loadDetail(); loadNotes(); }, [tweetId]);

  useEffect(() => {
    const unlisten = listen<AgentEvent>("agent:event", (event) => {
      const e = event.payload;
      if (e.type === "text") {
        currentText.current += e.text || "";
        setChatMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === "assistant") {
            updated[updated.length - 1] = { role: "assistant", content: currentText.current };
          } else {
            updated.push({ role: "assistant", content: currentText.current });
          }
          return updated;
        });
      } else if (e.type === "done") setChatRunning(false);
      else if (e.type === "error") { currentText.current += `\nErreur: ${e.message}`; setChatRunning(false); }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  useEffect(() => { chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" }); }, [chatMessages]);

  async function loadDetail() {
    setLoading(true);
    try {
      const d = await invoke<TweetDetailResult>("get_tweet_detail", { tweetId });
      setData(d);
      if (d.tweet.conversation_id || d.tweet.reply_to_id) {
        setThreadLoading(true);
        try { const t = await invoke<{ tweets: ThreadTweet[] }>("get_thread", { tweetId: d.tweet.conversation_id || tweetId }); setThread(t.tweets); }
        catch { setThread([]); }
        setThreadLoading(false);
      }
    } catch { /* silently fail */ }
    setLoading(false);
  }

  async function loadNotes() { try { setNotes(await invoke<NoteData[]>("get_tweet_notes", { tweetId })); } catch {} }
  async function addTag() { if (!newTag.trim()) return; await invoke("create_and_assign_tag", { tweetId, tagName: newTag.trim(), color: null }); setNewTag(""); loadDetail(); }
  async function removeTag(tagId: number) { await invoke("remove_tag_from_tweet", { tweetId, tagId }); loadDetail(); }
  async function addNote() { if (!newNote.trim()) return; await invoke("create_tweet_note", { tweetId, content: newNote.trim() }); setNewNote(""); loadNotes(); }
  async function saveEditNote(noteId: number) { if (!editNoteContent.trim()) return; await invoke("update_tweet_note", { noteId, content: editNoteContent.trim() }); setEditingNote(null); loadNotes(); }
  async function deleteNote(noteId: number) { await invoke("delete_tweet_note", { noteId }); loadNotes(); }

  async function sendChat() {
    const msg = chatInput.trim();
    if (!msg || chatRunning) return;
    setChatInput(""); setChatRunning(true);
    setChatMessages((prev) => [...prev, { role: "user", content: msg }]);
    currentText.current = "";
    const context = data ? `[Contexte: tweet de @${data.tweet.author_handle}: "${data.tweet.content.slice(0, 200)}"]` : "";
    const history = chatMessages.map((m) => ({ role: m.role, content: JSON.stringify(m.content) }));
    try { await invoke("send_agent_message", { message: `${context}\n\n${msg}`, history }); }
    catch { setChatRunning(false); }
  }

  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-4 h-4 border-2 border-border border-t-foreground rounded-full animate-spin" />
    </div>
  );

  if (!data) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3">
      <p className="text-[13px] text-muted-foreground">Tweet introuvable</p>
      <button onClick={back} className="text-xs text-foreground">Retour</button>
    </div>
  );

  const { tweet, similar, tags } = data;
  const avatarColor = getInitialColor(tweet.author_handle);
  const media = tweet.media_json ? JSON.parse(tweet.media_json) : [];
  const quoted = tweet.quoted_tweet_json ? JSON.parse(tweet.quoted_tweet_json) : null;

  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="flex-1 overflow-auto">
        <div className="max-w-2xl mx-auto px-6 pt-6 pb-20">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
            {/* Back */}
            <button onClick={back} className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors mb-6" aria-label="Retour">
              <ArrowLeft size={13} />
              {fromDot ? dotName(fromDot) : "Retour"}
            </button>

            {/* Thread */}
            {thread.length > 1 && (
              <div className="mb-4">
                {thread.filter((t) => t.id !== tweetId).map((t) => (
                  <div key={t.id} onClick={() => navigate({ type: "tweet", id: t.id, fromDot })}
                    className="flex gap-3 py-3 px-4 border-l-2 border-border hover:bg-card cursor-pointer transition-colors">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0"
                      style={{ backgroundColor: getInitialColor(t.author_handle) + "18", color: getInitialColor(t.author_handle) }}>
                      {t.author_handle[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <span className="text-xs font-medium text-foreground/70">@{t.author_handle}</span>
                      <p className="text-xs text-muted-foreground line-clamp-2">{t.content}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {threadLoading && <div className="flex items-center gap-2 mb-4 text-[11px] text-muted-foreground"><Loader2 size={12} className="animate-spin" /> Fil...</div>}

            {/* Reply context */}
            {tweet.reply_to_handle && (
              <p className="text-xs text-muted-foreground mb-3">
                En reponse a <span className="text-foreground">@{tweet.reply_to_handle}</span>
              </p>
            )}

            {/* Author */}
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-[14px] font-semibold shrink-0"
                style={{ backgroundColor: avatarColor + "18", color: avatarColor }}>
                {tweet.author_handle[0]?.toUpperCase()}
              </div>
              <div>
                <span className="text-[15px] font-semibold text-foreground">{tweet.author_name || tweet.author_handle}</span>
                <p className="text-xs text-muted-foreground">@{tweet.author_handle}</p>
              </div>
            </div>

            {/* AI Summary */}
            {tweet.ai_summary && (
              <div className="mb-4 px-4 py-3 bg-secondary border border-border rounded-lg">
                <p className="text-[13px] font-medium text-foreground">{tweet.ai_summary}</p>
              </div>
            )}

            {/* Content */}
            <div className="text-[15px] text-foreground leading-relaxed whitespace-pre-wrap mb-4">{tweet.content}</div>

            {/* Resolved */}
            {tweet.resolved_content && (
              <div className="mb-4 border border-border rounded-lg p-4 bg-card">
                {tweet.resolved_author && <p className="text-xs font-medium text-foreground/70 mb-2">@{tweet.resolved_author}</p>}
                <p className="text-[13px] text-foreground/70 whitespace-pre-wrap line-clamp-[12]">{tweet.resolved_content}</p>
                {tweet.resolved_url && <a href={tweet.resolved_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-foreground hover:underline mt-2 inline-block">{tweet.resolved_url}</a>}
              </div>
            )}

            {/* Media */}
            {media.length > 0 && (
              <div className={`mb-4 grid gap-2 ${media.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
                {media.map((m: { url?: string; preview_url?: string }, i: number) => (
                  <img key={i} src={m.url || m.preview_url} className="w-full rounded-lg border border-border" alt="" />
                ))}
              </div>
            )}

            {/* Quoted */}
            {quoted && (
              <div className="mb-4 border border-border rounded-lg p-4 bg-card">
                <p className="text-xs font-medium text-foreground/70 mb-1">@{quoted.author_handle}</p>
                <p className="text-[13px] text-foreground/70 line-clamp-4">{quoted.text}</p>
              </div>
            )}

            {/* Date */}
            <p className="text-xs text-muted-foreground mb-4 tabular-nums">{formatDate(tweet.created_at)}</p>

            {/* Metrics */}
            <div className="flex items-center gap-5 py-3 border-y border-border mb-6 text-muted-foreground">
              <span className="flex items-center gap-1.5"><Heart size={14} /><span className="text-xs tabular-nums">{fmt(tweet.likes)}</span></span>
              <span className="flex items-center gap-1.5"><Repeat2 size={14} /><span className="text-xs tabular-nums">{fmt(tweet.retweets)}</span></span>
              <span className="flex items-center gap-1.5"><MessageCircle size={14} /><span className="text-xs tabular-nums">{fmt(tweet.replies_count)}</span></span>
              {tweet.views > 0 && <span className="flex items-center gap-1.5 opacity-50"><Eye size={14} /><span className="text-xs tabular-nums">{fmt(tweet.views)}</span></span>}
              <div className="flex-1" />
              {tweet.tweet_url && <a href={tweet.tweet_url} target="_blank" rel="noopener noreferrer" className="text-xs text-foreground hover:underline font-medium flex items-center gap-1"><ExternalLink size={12} /> X</a>}
            </div>

            {/* Topics */}
            {tweet.ai_topics?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-6">
                {tweet.ai_topics.map((t) => (
                  <span key={t} className="text-[10px] px-2 py-0.5 rounded-md bg-secondary text-muted-foreground border border-border">{t}</span>
                ))}
              </div>
            )}

            {/* Tags */}
            <div className="mb-6">
              <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5"><Tag size={11} /> Tags</h3>
              <div className="flex flex-wrap items-center gap-2">
                {tags.map((tag) => (
                  <span key={tag.id} className="group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium bg-card text-foreground/70 border border-border">
                    {tag.name}
                    <button onClick={() => removeTag(tag.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400" aria-label="Retirer le tag"><Trash2 size={9} /></button>
                  </span>
                ))}
                <input value={newTag} onChange={(e) => setNewTag(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTag()}
                  placeholder="+" className="w-16 px-2 py-1 text-[11px] bg-transparent border border-dashed border-border rounded-md placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring text-foreground/70" />
              </div>
            </div>

            {/* Notes */}
            <div className="mb-6">
              <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5"><StickyNote size={11} /> Notes</h3>
              <div className="space-y-2">
                {notes.map((note) => (
                  <div key={note.id} className="group flex items-start gap-2 p-3 bg-card rounded-lg border border-border">
                    {editingNote === note.id ? (
                      <div className="flex-1">
                        <textarea value={editNoteContent} onChange={(e) => setEditNoteContent(e.target.value)}
                          className="w-full px-2 py-1 text-xs border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring" rows={2} autoFocus />
                        <div className="flex gap-2 mt-1">
                          <button onClick={() => saveEditNote(note.id)} className="text-[11px] text-foreground">Sauver</button>
                          <button onClick={() => setEditingNote(null)} className="text-[11px] text-muted-foreground">Annuler</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="flex-1 text-xs text-foreground/70 whitespace-pre-wrap">{note.content}</p>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => { setEditingNote(note.id); setEditNoteContent(note.content); }} className="text-muted-foreground hover:text-foreground" aria-label="Modifier"><Pencil size={11} /></button>
                          <button onClick={() => deleteNote(note.id)} className="text-muted-foreground hover:text-red-400" aria-label="Supprimer"><Trash2 size={11} /></button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
                <input value={newNote} onChange={(e) => setNewNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addNote()}
                  placeholder="Ajouter une note..." className="w-full px-3 py-2 text-xs border border-dashed border-border rounded-lg placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring bg-transparent text-foreground/70" />
              </div>
            </div>

            {/* Similar */}
            {similar.length > 0 && (
              <div>
                <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-3">Connexions</h3>
                <div className="space-y-2">
                  {similar.slice(0, 5).map((s) => (
                    <div key={s.id} onClick={() => navigate({ type: "tweet", id: s.id, fromDot })}><TweetCard tweet={s} compact /></div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        </div>
      </div>

      {/* Agent sidebar */}
      <motion.div
        animate={{ width: chatOpen ? 360 : 44 }}
        transition={{ type: "spring", stiffness: 400, damping: 35 }}
        className="border-l border-border bg-background flex flex-col overflow-hidden"
      >
        {!chatOpen ? (
          <button onClick={() => setChatOpen(true)}
            className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Ouvrir l'agent">
            <Bot size={18} />
            <span className="text-[9px] font-medium" style={{ writingMode: "vertical-rl" }}>Agent</span>
          </button>
        ) : (
          <>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2"><Bot size={14} className="text-foreground" /><span className="text-xs font-medium text-foreground">Agent</span></div>
              <button onClick={() => setChatOpen(false)} className="text-muted-foreground hover:text-foreground text-[11px]" aria-label="Fermer l'agent">Fermer</button>
            </div>
            <div ref={chatRef} className="flex-1 overflow-auto px-4 py-4 space-y-3">
              {chatMessages.length === 0 && (
                <div className="text-center py-8">
                  <Bot size={20} className="text-border mx-auto mb-2" />
                  <p className="text-[11px] text-muted-foreground">Pose une question sur ce tweet</p>
                </div>
              )}
              {chatMessages.map((msg, i) => (
                <div key={i} className={msg.role === "user" ? "flex justify-end" : ""}>
                  <div className={cn(
                    "max-w-[90%] px-3 py-2 rounded-lg text-xs leading-relaxed whitespace-pre-wrap",
                    msg.role === "user"
                      ? "bg-foreground text-background"
                      : "bg-card text-foreground/70 border border-border"
                  )}>{msg.content}</div>
                </div>
              ))}
              {chatRunning && chatMessages[chatMessages.length - 1]?.role !== "assistant" && (
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground"><Loader2 size={12} className="animate-spin" /></div>
              )}
            </div>
            <div className="p-3 border-t border-border">
              <form onSubmit={(e) => { e.preventDefault(); sendChat(); }} className="flex gap-2">
                <input type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Demande..."
                  disabled={chatRunning} className="flex-1 px-3 py-2 bg-card border border-border rounded-lg text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50" />
                <button type="submit" disabled={chatRunning || !chatInput.trim()} className="px-3 py-2 bg-foreground text-background rounded-lg disabled:opacity-30 transition-colors" aria-label="Envoyer"><Send size={13} /></button>
              </form>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}
