import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Plus, X, Trash2, GripVertical, Search, Sparkles, Loader2, FolderOpen } from "lucide-react";
import { useAppStore } from "../stores/appStore";
import { CAT_COLORS, type Tweet } from "../components/TweetCard";

interface Project { id: number; name: string; description: string | null; color: string | null; created_at: string; }
interface KanbanColumn { id: number; project_id: number; name: string; position: number; }
interface KanbanCard { id: number; column_id: number; tweet_id: string; note: string | null; position: number; author_handle: string | null; content: string | null; }
interface CategoryCount { name: string; count: number; }
interface DashboardStats { categories: CategoryCount[]; [key: string]: unknown; }
interface Group { id: number; project_id: number; name: string; description: string | null; color: string | null; tweet_count: number; }

export function Boards() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [columns, setColumns] = useState<KanbanColumn[]>([]);
  const [cardsByColumn, setCardsByColumn] = useState<Record<number, KanbanCard[]>>({});
  const [showNewProject, setShowNewProject] = useState(false);
  const [showCreateFromCategory, setShowCreateFromCategory] = useState(false);
  const [categories, setCategories] = useState<CategoryCount[]>([]);
  const [newProjectName, setNewProjectName] = useState("");
  const [newColumnName, setNewColumnName] = useState("");
  const [showNewColumn, setShowNewColumn] = useState(false);
  const [addCardCol, setAddCardCol] = useState<number | null>(null);
  const [cardSearchQuery, setCardSearchQuery] = useState("");
  const [cardSearchResults, setCardSearchResults] = useState<Tweet[]>([]);
  const [suggesting, setSuggesting] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<Tweet[]>([]);
  const [dragCard, setDragCard] = useState<{ cardId: number; fromColId: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ colId: number; position: number } | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const pushFocus = useAppStore((s) => s.pushFocus);

  const handleDragStart = (cardId: number, fromColId: number) => {
    setDragCard({ cardId, fromColId });
  };

  const handleDragOver = (e: React.DragEvent, colId: number, position: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget({ colId, position });
  };

  const handleDrop = async (e: React.DragEvent, colId: number, position: number) => {
    e.preventDefault();
    if (!dragCard) return;
    try {
      await invoke("move_kanban_card", {
        cardId: dragCard.cardId,
        targetColumnId: colId,
        targetPosition: position,
      });
      if (selectedProject) loadBoard(selectedProject.id);
    } catch (err) { console.error("Failed to move card:", err); }
    setDragCard(null);
    setDropTarget(null);
  };

  const handleDragEnd = () => { setDragCard(null); setDropTarget(null); };

  const loadProjects = async () => {
    try {
      const p = await invoke<Project[]>("list_projects");
      setProjects(p);
      if (p.length > 0 && !selectedProject) setSelectedProject(p[0]);
    } catch (e) { console.error(e); }
  };

  const loadBoard = async (projectId: number) => {
    try {
      const cols = await invoke<KanbanColumn[]>("list_kanban_columns", { projectId });
      setColumns(cols);
      const m: Record<number, KanbanCard[]> = {};
      for (const c of cols) { m[c.id] = await invoke<KanbanCard[]>("list_kanban_cards", { columnId: c.id }); }
      setCardsByColumn(m);
      const g = await invoke<Group[]>("list_groups", { projectId });
      setGroups(g);
    } catch (e) { console.error(e); }
  };

  const createGroup = async () => {
    if (!newGroupName.trim() || !selectedProject) return;
    try {
      await invoke("create_group", { projectId: selectedProject.id, name: newGroupName.trim(), color: null });
      setNewGroupName(""); setShowNewGroup(false);
      loadBoard(selectedProject.id);
    } catch (e) { console.error(e); }
  };

  const deleteGroup = async (groupId: number) => {
    try {
      await invoke("delete_group", { groupId });
      if (selectedProject) loadBoard(selectedProject.id);
    } catch (e) { console.error(e); }
  };

  const loadCategories = async () => {
    try {
      const s = await invoke<DashboardStats>("get_dashboard_stats");
      setCategories(s.categories);
    } catch (e) { console.error(e); }
  };

  useEffect(() => { loadProjects(); loadCategories(); }, []);
  useEffect(() => { if (selectedProject) loadBoard(selectedProject.id); }, [selectedProject]);

  const createProject = async (name?: string) => {
    const n = (name || newProjectName).trim();
    if (!n) return;
    try {
      const p = await invoke<Project>("create_project", { name: n });
      setNewProjectName("");
      setShowNewProject(false);
      setProjects((prev) => [p, ...prev]);
      setSelectedProject(p);
      return p;
    } catch (e) { console.error(e); }
  };

  const createFromCategory = async (catName: string) => {
    const p = await createProject(catName);
    if (!p) return;
    // Auto-create columns: "To Read", "Reading", "Done"
    await invoke("create_kanban_column", { projectId: p.id, name: "To Read" });
    await invoke("create_kanban_column", { projectId: p.id, name: "Reading" });
    await invoke("create_kanban_column", { projectId: p.id, name: "Done" });

    // Auto-add top tweets from that category to "To Read"
    const tweets = await invoke<Tweet[]>("list_tweets_by_category", { category: catName, limit: 10 });
    const cols = await invoke<KanbanColumn[]>("list_kanban_columns", { projectId: p.id });
    const toReadCol = cols[0];
    if (toReadCol) {
      for (const t of tweets) {
        await invoke("create_kanban_card", { columnId: toReadCol.id, tweetId: t.id });
      }
    }

    setShowCreateFromCategory(false);
    loadBoard(p.id);
  };

  const deleteProject = async (id: number) => {
    await invoke("delete_project", { id });
    const r = projects.filter((p) => p.id !== id);
    setProjects(r);
    if (selectedProject?.id === id) setSelectedProject(r[0] || null);
  };

  const createColumn = async () => {
    if (!newColumnName.trim() || !selectedProject) return;
    await invoke("create_kanban_column", { projectId: selectedProject.id, name: newColumnName.trim() });
    setNewColumnName(""); setShowNewColumn(false);
    loadBoard(selectedProject.id);
  };

  const deleteColumn = async (id: number) => {
    await invoke("delete_kanban_column", { id });
    if (selectedProject) loadBoard(selectedProject.id);
  };

  const searchTweets = async (q: string) => {
    setCardSearchQuery(q);
    if (!q.trim()) { setCardSearchResults([]); return; }
    try {
      const r = await invoke<Tweet[]>("search_tweets", { query: q.trim(), limit: 5 });
      setCardSearchResults(r);
    } catch (e) { console.error(e); }
  };

  const suggestTweets = async (colId: number) => {
    setSuggesting(colId);
    // Suggest tweets semantically related to existing cards in the column
    const cards = cardsByColumn[colId] || [];
    if (cards.length === 0) {
      // No cards yet — suggest from the project name
      try {
        const r = await invoke<Tweet[]>("search_semantic", { query: selectedProject?.name || "", limit: 5 });
        setSuggestions(r);
      } catch { setSuggestions([]); }
    } else {
      // Use first card's content as seed
      try {
        const r = await invoke<Tweet[]>("search_semantic", { query: cards[0].content || "", limit: 5 });
        // Filter out tweets already on the board
        const existingIds = new Set(Object.values(cardsByColumn).flat().map((c) => c.tweet_id));
        setSuggestions(r.filter((t) => !existingIds.has(t.id)));
      } catch { setSuggestions([]); }
    }
  };

  const addCard = async (colId: number, tweetId: string) => {
    await invoke("create_kanban_card", { columnId: colId, tweetId });
    setCardSearchQuery(""); setCardSearchResults([]); setAddCardCol(null);
    setSuggesting(null); setSuggestions([]);
    if (selectedProject) loadBoard(selectedProject.id);
  };

  const deleteCard = async (id: number) => {
    await invoke("delete_kanban_card", { id });
    if (selectedProject) loadBoard(selectedProject.id);
  };

  // Empty state — offer to create from category
  if (projects.length === 0 && !showNewProject) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="max-w-md text-left">
          <p className="text-[13px] text-zinc-700 mb-1">Organize your research</p>
          <p className="text-[12px] text-zinc-400 mb-4">
            Create a board from scratch, or auto-generate one from a topic category.
            The AI will pre-populate it with relevant tweets.
          </p>
          <div className="flex gap-2 mb-4">
            <button onClick={() => setShowNewProject(true)}
              className="px-3 py-1.5 bg-zinc-900 text-white rounded-md text-[12px] font-medium hover:bg-zinc-800">
              Blank board
            </button>
            <button onClick={() => setShowCreateFromCategory(true)}
              className="px-3 py-1.5 border border-violet-200 text-violet-700 bg-violet-50 rounded-md text-[12px] font-medium hover:bg-violet-100 flex items-center gap-1.5">
              <Sparkles size={12} /> From a topic
            </button>
          </div>

          {showCreateFromCategory && (
            <div className="flex flex-wrap gap-1.5">
              {categories.map((cat) => {
                const color = CAT_COLORS[cat.name] || "#71717A";
                return (
                  <button key={cat.name} onClick={() => createFromCategory(cat.name)}
                    className="text-[11px] font-medium px-2 py-1 rounded-md border border-zinc-200 bg-white hover:border-current transition-colors inline-flex items-center gap-1"
                    style={{ color }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                    {cat.name} <span className="text-zinc-300">{cat.count}</span>
                  </button>
                );
              })}
            </div>
          )}

          {showNewProject && (
            <form onSubmit={(e) => { e.preventDefault(); createProject(); }} className="flex items-center gap-1 mt-2">
              <input type="text" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="Board name" className="px-2 py-1.5 bg-zinc-50 border border-zinc-200 rounded-md text-[12px] w-40 focus:outline-none focus:border-violet-600" autoFocus />
              <button type="submit" className="px-3 py-1.5 bg-zinc-900 text-white rounded-md text-[11px] font-medium">Create</button>
              <button type="button" onClick={() => setShowNewProject(false)} className="text-zinc-400"><X size={14} /></button>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Project tabs */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-100 bg-white">
        {projects.map((p) => (
          <button key={p.id} onClick={() => setSelectedProject(p)}
            className={`group flex items-center gap-1.5 px-3 py-1 rounded-md text-[12px] transition-colors ${selectedProject?.id === p.id ? "bg-zinc-900 text-white font-medium" : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100"}`}>
            {p.name}
            <button onClick={(e) => { e.stopPropagation(); deleteProject(p.id); }}
              className={`opacity-0 group-hover:opacity-100 ${selectedProject?.id === p.id ? "text-zinc-400 hover:text-white" : "text-zinc-300 hover:text-zinc-700"}`}>
              <X size={10} />
            </button>
          </button>
        ))}
        {showNewProject ? (
          <form onSubmit={(e) => { e.preventDefault(); createProject(); }} className="flex items-center gap-1">
            <input type="text" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} placeholder="Name"
              className="px-2 py-1 bg-zinc-50 border border-zinc-200 rounded-md text-[11px] w-28 focus:outline-none focus:border-violet-600" autoFocus />
            <button type="button" onClick={() => setShowNewProject(false)} className="text-zinc-400"><X size={12} /></button>
          </form>
        ) : (
          <div className="flex items-center gap-1">
            <button onClick={() => setShowNewProject(true)} className="text-zinc-400 hover:text-zinc-700 p-1 rounded-md hover:bg-zinc-100"><Plus size={14} /></button>
            <button onClick={() => setShowCreateFromCategory(!showCreateFromCategory)}
              className="text-violet-500 hover:text-violet-700 p-1 rounded-md hover:bg-violet-50" title="Create from topic">
              <Sparkles size={14} />
            </button>
          </div>
        )}
        {showCreateFromCategory && (
          <div className="flex items-center gap-1 ml-2">
            {categories.slice(0, 6).map((cat) => {
              const color = CAT_COLORS[cat.name] || "#71717A";
              return (
                <button key={cat.name} onClick={() => createFromCategory(cat.name)}
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-zinc-200 bg-white hover:border-current transition-colors"
                  style={{ color }}>
                  {cat.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Board */}
      {selectedProject && (
        <div className="flex-1 overflow-x-auto p-4">
          <div className="flex gap-3 h-full">
            {columns.map((col) => (
              <div key={col.id} className="w-[260px] shrink-0 flex flex-col bg-zinc-50 rounded-lg border border-zinc-200">
                <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200">
                  <span className="text-[12px] font-medium text-zinc-900">{col.name}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-zinc-400">{(cardsByColumn[col.id] || []).length}</span>
                    <button onClick={() => deleteColumn(col.id)} className="text-zinc-300 hover:text-red-500 p-0.5"><Trash2 size={11} /></button>
                  </div>
                </div>
                <div
                  className="flex-1 overflow-y-auto p-2 space-y-1.5"
                  onDragOver={(e) => handleDragOver(e, col.id, (cardsByColumn[col.id] || []).length)}
                  onDrop={(e) => handleDrop(e, col.id, (cardsByColumn[col.id] || []).length)}
                >
                  {(cardsByColumn[col.id] || []).map((card, idx) => (
                    <div key={card.id}>
                      {/* Drop indicator above card */}
                      {dragCard && dropTarget?.colId === col.id && dropTarget.position === idx && (
                        <div className="h-0.5 bg-violet-500 rounded-full mb-1.5 mx-1" />
                      )}
                      <div
                        draggable
                        onDragStart={() => handleDragStart(card.id, col.id)}
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) => { e.stopPropagation(); handleDragOver(e, col.id, idx); }}
                        onDrop={(e) => { e.stopPropagation(); handleDrop(e, col.id, idx); }}
                        onClick={() => pushFocus({ type: "tweet", id: card.tweet_id })}
                        className={`bg-white border border-zinc-200 rounded-md p-2.5 hover:border-zinc-300 transition-colors cursor-grab active:cursor-grabbing group ${
                          dragCard?.cardId === card.id ? "opacity-40" : ""
                        }`}
                      >
                        <div className="flex items-start gap-1.5">
                          <GripVertical size={10} className="text-zinc-300 mt-0.5 shrink-0" />
                          <div className="flex-1 min-w-0">
                            {card.author_handle && <span className="text-[10px] text-zinc-400">@{card.author_handle}</span>}
                            <p className="text-[11px] text-zinc-700 line-clamp-3 mt-0.5">{card.content || card.tweet_id}</p>
                          </div>
                          <button onClick={(e) => { e.stopPropagation(); deleteCard(card.id); }}
                            className="opacity-0 group-hover:opacity-100 text-zinc-300 hover:text-red-500"><X size={10} /></button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {/* Drop indicator at bottom */}
                  {dragCard && dropTarget?.colId === col.id && dropTarget.position === (cardsByColumn[col.id] || []).length && (
                    <div className="h-0.5 bg-violet-500 rounded-full mx-1" />
                  )}

                  {/* Add card: search or AI suggest */}
                  {addCardCol === col.id ? (
                    <div className="space-y-1">
                      <div className="relative">
                        <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400" />
                        <input type="text" value={cardSearchQuery} onChange={(e) => searchTweets(e.target.value)}
                          placeholder="Search tweets..." className="w-full pl-6 pr-2 py-1.5 bg-white border border-zinc-200 rounded-md text-[11px] focus:outline-none focus:border-violet-600" autoFocus />
                      </div>
                      {cardSearchResults.map((t) => (
                        <button key={t.id} onClick={() => addCard(col.id, t.id)}
                          className="w-full text-left p-2 bg-white border border-zinc-200 rounded-md hover:border-violet-300 transition-colors">
                          <span className="text-[9px] text-zinc-400">@{t.author_handle}</span>
                          <p className="text-[10px] text-zinc-700 line-clamp-2">{t.content}</p>
                        </button>
                      ))}
                      <button onClick={() => { setAddCardCol(null); setCardSearchResults([]); setCardSearchQuery(""); }}
                        className="text-[10px] text-zinc-400">Cancel</button>
                    </div>
                  ) : suggesting === col.id ? (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 text-[10px] text-violet-600 font-medium px-1 mb-1">
                        <Sparkles size={10} /> AI suggestions
                      </div>
                      {suggestions.length === 0 && (
                        <div className="flex items-center justify-center py-3">
                          <Loader2 size={12} className="text-violet-500 animate-spin" />
                        </div>
                      )}
                      {suggestions.map((t) => (
                        <button key={t.id} onClick={() => addCard(col.id, t.id)}
                          className="w-full text-left p-2 bg-violet-50 border border-violet-200 rounded-md hover:bg-violet-100 transition-colors">
                          <span className="text-[9px] text-violet-500">@{t.author_handle}</span>
                          <p className="text-[10px] text-violet-800 line-clamp-2">{t.content}</p>
                        </button>
                      ))}
                      <button onClick={() => { setSuggesting(null); setSuggestions([]); }}
                        className="text-[10px] text-zinc-400">Cancel</button>
                    </div>
                  ) : (
                    <div className="flex gap-1">
                      <button onClick={() => setAddCardCol(col.id)}
                        className="flex-1 py-1.5 text-[11px] text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 rounded-md transition-colors flex items-center justify-center gap-1">
                        <Search size={10} /> Search
                      </button>
                      <button onClick={() => suggestTweets(col.id)}
                        className="flex-1 py-1.5 text-[11px] text-violet-500 hover:text-violet-700 hover:bg-violet-50 rounded-md transition-colors flex items-center justify-center gap-1">
                        <Sparkles size={10} /> Suggest
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            <div className="w-[260px] shrink-0">
              {showNewColumn ? (
                <form onSubmit={(e) => { e.preventDefault(); createColumn(); }} className="bg-zinc-50 border border-zinc-200 rounded-lg p-3 space-y-2">
                  <input type="text" value={newColumnName} onChange={(e) => setNewColumnName(e.target.value)} placeholder="Column name"
                    className="w-full px-2 py-1.5 bg-white border border-zinc-200 rounded-md text-[11px] focus:outline-none focus:border-violet-600" autoFocus />
                  <div className="flex gap-1">
                    <button type="submit" className="px-3 py-1 bg-zinc-900 text-white rounded-md text-[10px] font-medium">Add</button>
                    <button type="button" onClick={() => setShowNewColumn(false)} className="px-3 py-1 text-zinc-400 text-[10px]">Cancel</button>
                  </div>
                </form>
              ) : (
                <button onClick={() => setShowNewColumn(true)}
                  className="w-full py-3 border border-dashed border-zinc-300 rounded-lg text-[11px] text-zinc-400 hover:text-zinc-700 hover:border-zinc-400 transition-colors flex items-center justify-center gap-1">
                  <Plus size={12} /> Add column
                </button>
              )}
            </div>
          </div>

          {/* Groups section */}
          <div className="px-4 pb-4 border-t border-zinc-100 pt-3">
            <div className="flex items-center gap-2 mb-2">
              <FolderOpen size={12} className="text-zinc-400" />
              <span className="text-[12px] font-medium text-zinc-500">Groups</span>
              {showNewGroup ? (
                <form onSubmit={(e) => { e.preventDefault(); createGroup(); }} className="flex items-center gap-1 ml-2">
                  <input type="text" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)}
                    placeholder="Group name" className="px-2 py-1 bg-zinc-50 border border-zinc-200 rounded-md text-[11px] w-28 focus:outline-none focus:border-violet-600" autoFocus />
                  <button type="button" onClick={() => setShowNewGroup(false)} className="text-zinc-400"><X size={12} /></button>
                </form>
              ) : (
                <button onClick={() => setShowNewGroup(true)} className="text-zinc-400 hover:text-zinc-700 p-0.5"><Plus size={12} /></button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {groups.map((g) => (
                <div key={g.id} className="group inline-flex items-center gap-1.5 px-2.5 py-1 bg-zinc-50 border border-zinc-200 rounded-md text-[11px] hover:border-zinc-300 transition-colors">
                  <span className="w-2 h-2 rounded-full bg-zinc-400 shrink-0" style={g.color ? { backgroundColor: g.color } : undefined} />
                  <span className="text-zinc-700 font-medium">{g.name}</span>
                  <span className="text-zinc-300">{g.tweet_count}</span>
                  <button onClick={() => deleteGroup(g.id)}
                    className="opacity-0 group-hover:opacity-100 text-zinc-300 hover:text-red-500 transition-opacity"><X size={10} /></button>
                </div>
              ))}
              {groups.length === 0 && !showNewGroup && (
                <span className="text-[11px] text-zinc-300">No groups yet</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
