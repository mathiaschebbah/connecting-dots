import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Plus, X, Trash2, GripVertical, Search } from "lucide-react";
import { type Tweet } from "../components/TweetCard";

interface Project {
  id: number;
  name: string;
  description: string | null;
  color: string | null;
  created_at: string;
}

interface KanbanColumn {
  id: number;
  project_id: number;
  name: string;
  position: number;
}

interface KanbanCard {
  id: number;
  column_id: number;
  tweet_id: string;
  note: string | null;
  position: number;
  author_handle: string | null;
  content: string | null;
}

export function Kanban() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [columns, setColumns] = useState<KanbanColumn[]>([]);
  const [cardsByColumn, setCardsByColumn] = useState<Record<number, KanbanCard[]>>({});
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newColumnName, setNewColumnName] = useState("");
  const [showNewColumn, setShowNewColumn] = useState(false);
  const [addCardCol, setAddCardCol] = useState<number | null>(null);
  const [cardSearchQuery, setCardSearchQuery] = useState("");
  const [cardSearchResults, setCardSearchResults] = useState<Tweet[]>([]);

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
      const cardsMap: Record<number, KanbanCard[]> = {};
      for (const col of cols) {
        const cards = await invoke<KanbanCard[]>("list_kanban_cards", { columnId: col.id });
        cardsMap[col.id] = cards;
      }
      setCardsByColumn(cardsMap);
    } catch (e) { console.error(e); }
  };

  useEffect(() => { loadProjects(); }, []);
  useEffect(() => {
    if (selectedProject) loadBoard(selectedProject.id);
  }, [selectedProject]);

  const createProject = async () => {
    if (!newProjectName.trim()) return;
    try {
      const p = await invoke<Project>("create_project", { name: newProjectName.trim() });
      setNewProjectName("");
      setShowNewProject(false);
      setProjects((prev) => [p, ...prev]);
      setSelectedProject(p);
    } catch (e) { console.error(e); }
  };

  const deleteProject = async (id: number) => {
    try {
      await invoke("delete_project", { id });
      const remaining = projects.filter((p) => p.id !== id);
      setProjects(remaining);
      if (selectedProject?.id === id) setSelectedProject(remaining[0] || null);
    } catch (e) { console.error(e); }
  };

  const createColumn = async () => {
    if (!newColumnName.trim() || !selectedProject) return;
    try {
      await invoke("create_kanban_column", { projectId: selectedProject.id, name: newColumnName.trim() });
      setNewColumnName("");
      setShowNewColumn(false);
      loadBoard(selectedProject.id);
    } catch (e) { console.error(e); }
  };

  const deleteColumn = async (id: number) => {
    try {
      await invoke("delete_kanban_column", { id });
      if (selectedProject) loadBoard(selectedProject.id);
    } catch (e) { console.error(e); }
  };

  const searchTweets = async (q: string) => {
    setCardSearchQuery(q);
    if (!q.trim()) { setCardSearchResults([]); return; }
    try {
      const results = await invoke<Tweet[]>("search_tweets", { query: q.trim(), limit: 5 });
      setCardSearchResults(results);
    } catch (e) { console.error(e); }
  };

  const addCard = async (columnId: number, tweetId: string) => {
    try {
      await invoke("create_kanban_card", { columnId, tweetId });
      setCardSearchQuery("");
      setCardSearchResults([]);
      setAddCardCol(null);
      if (selectedProject) loadBoard(selectedProject.id);
    } catch (e) { console.error(e); }
  };

  const deleteCard = async (id: number) => {
    try {
      await invoke("delete_kanban_card", { id });
      if (selectedProject) loadBoard(selectedProject.id);
    } catch (e) { console.error(e); }
  };

  if (projects.length === 0 && !showNewProject) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="max-w-xs text-left">
          <p className="text-[13px] text-zinc-700 mb-1">Organize tweets into research boards</p>
          <p className="text-[12px] text-zinc-400 mb-4">Create a project, add columns, then drag tweets from your bookmarks to structure your research.</p>
          <button
            onClick={() => setShowNewProject(true)}
            className="px-3 py-1.5 bg-zinc-900 text-white rounded-md text-[12px] font-medium hover:bg-zinc-800 transition-colors"
          >
            Create project
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Project tabs */}
      <div className="flex items-center gap-2 px-6 py-3 border-b border-zinc-200 bg-white">
        {projects.map((p) => (
          <button
            key={p.id}
            onClick={() => setSelectedProject(p)}
            className={`group flex items-center gap-1.5 px-3 py-1 rounded-md text-[13px] transition-colors ${
              selectedProject?.id === p.id
                ? "bg-zinc-900 text-white font-medium"
                : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100"
            }`}
          >
            {p.name}
            <button
              onClick={(e) => { e.stopPropagation(); deleteProject(p.id); }}
              className={`opacity-0 group-hover:opacity-100 transition-opacity ${
                selectedProject?.id === p.id ? "text-zinc-400 hover:text-white" : "text-zinc-300 hover:text-zinc-700"
              }`}
            >
              <X size={12} />
            </button>
          </button>
        ))}
        {showNewProject ? (
          <form onSubmit={(e) => { e.preventDefault(); createProject(); }} className="flex items-center gap-1">
            <input
              type="text" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="Project name"
              className="px-2 py-1 bg-zinc-50 border border-zinc-200 rounded-md text-[12px] w-32 focus:outline-none focus:border-violet-600"
              autoFocus
            />
            <button type="button" onClick={() => setShowNewProject(false)} className="text-zinc-400 hover:text-zinc-700">
              <X size={14} />
            </button>
          </form>
        ) : (
          <button onClick={() => setShowNewProject(true)} className="text-zinc-400 hover:text-zinc-700 p-1 rounded-md hover:bg-zinc-100">
            <Plus size={16} />
          </button>
        )}
      </div>

      {/* Board */}
      {selectedProject && (
        <div className="flex-1 overflow-x-auto p-4">
          <div className="flex gap-4 h-full">
            {columns.map((col) => (
              <div key={col.id} className="w-[280px] shrink-0 flex flex-col bg-zinc-50 rounded-lg border border-zinc-200">
                <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200">
                  <span className="text-[13px] font-medium text-zinc-900">{col.name}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-zinc-400">{(cardsByColumn[col.id] || []).length}</span>
                    <button onClick={() => deleteColumn(col.id)} className="text-zinc-300 hover:text-red-500 p-0.5 transition-colors">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {(cardsByColumn[col.id] || []).map((card) => (
                    <div key={card.id} className="bg-white border border-zinc-200 rounded-md p-3 hover:border-zinc-300 transition-colors group">
                      <div className="flex items-start gap-2">
                        <GripVertical size={12} className="text-zinc-300 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          {card.author_handle && (
                            <span className="text-[11px] text-zinc-400">@{card.author_handle}</span>
                          )}
                          <p className="text-[12px] text-zinc-700 line-clamp-3 mt-0.5">{card.content || card.tweet_id}</p>
                          {card.note && (
                            <p className="text-[11px] text-violet-600 mt-1">{card.note}</p>
                          )}
                        </div>
                        <button onClick={() => deleteCard(card.id)} className="opacity-0 group-hover:opacity-100 text-zinc-300 hover:text-red-500 transition-all">
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  ))}

                  {/* Add card with search */}
                  {addCardCol === col.id ? (
                    <div className="space-y-1">
                      <div className="relative">
                        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400" />
                        <input
                          type="text" value={cardSearchQuery} onChange={(e) => searchTweets(e.target.value)}
                          placeholder="Search tweets..."
                          className="w-full pl-7 pr-2 py-1.5 bg-white border border-zinc-200 rounded-md text-[12px] focus:outline-none focus:border-violet-600"
                          autoFocus
                        />
                      </div>
                      {cardSearchResults.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => addCard(col.id, t.id)}
                          className="w-full text-left p-2 bg-white border border-zinc-200 rounded-md hover:border-violet-300 transition-colors"
                        >
                          <span className="text-[10px] text-zinc-400">@{t.author_handle}</span>
                          <p className="text-[11px] text-zinc-700 line-clamp-2">{t.content}</p>
                        </button>
                      ))}
                      <button type="button" onClick={() => { setAddCardCol(null); setCardSearchResults([]); setCardSearchQuery(""); }} className="px-2 py-1 text-zinc-400 text-[11px]">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setAddCardCol(col.id)}
                      className="w-full py-1.5 text-[12px] text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 rounded-md transition-colors flex items-center justify-center gap-1"
                    >
                      <Plus size={12} /> Add card
                    </button>
                  )}
                </div>
              </div>
            ))}

            <div className="w-[280px] shrink-0">
              {showNewColumn ? (
                <form onSubmit={(e) => { e.preventDefault(); createColumn(); }} className="bg-zinc-50 border border-zinc-200 rounded-lg p-3 space-y-2">
                  <input
                    type="text" value={newColumnName} onChange={(e) => setNewColumnName(e.target.value)}
                    placeholder="Column name"
                    className="w-full px-2 py-1.5 bg-white border border-zinc-200 rounded-md text-[12px] focus:outline-none focus:border-violet-600"
                    autoFocus
                  />
                  <div className="flex gap-1">
                    <button type="submit" className="px-3 py-1 bg-zinc-900 text-white rounded-md text-[11px] font-medium">Add</button>
                    <button type="button" onClick={() => setShowNewColumn(false)} className="px-3 py-1 text-zinc-400 text-[11px]">Cancel</button>
                  </div>
                </form>
              ) : (
                <button
                  onClick={() => setShowNewColumn(true)}
                  className="w-full py-3 border border-dashed border-zinc-300 rounded-lg text-[12px] text-zinc-400 hover:text-zinc-700 hover:border-zinc-400 transition-colors flex items-center justify-center gap-1"
                >
                  <Plus size={14} /> Add column
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
