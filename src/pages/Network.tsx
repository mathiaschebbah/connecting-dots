import { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import ForceGraph2D from "react-force-graph-2d";

interface GraphNode {
  id: string;
  author_handle: string;
  author_name: string | null;
  content_preview: string;
  category: string | null;
  summary: string | null;
  connections?: number;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  [key: string]: unknown;
}

interface GraphLink {
  source: string;
  target: string;
  similarity: number;
  [key: string]: unknown;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
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

function getColor(cat: string | null) {
  return CAT_COLORS[cat || "Other"] || CAT_COLORS.Other;
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

export function Network() {
  const [data, setData] = useState<GraphData>({ nodes: [], links: [] });
  const [loading, setLoading] = useState(true);
  const [threshold, setThreshold] = useState(0.7);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await invoke<GraphData>("get_network_graph", {
        source: "bookmark",
        similarityThreshold: threshold,
        limit: 300,
      });

      // Connection counts
      const counts = new Map<string, number>();
      d.links.forEach((l) => {
        counts.set(l.source, (counts.get(l.source) || 0) + 1);
        counts.set(l.target, (counts.get(l.target) || 0) + 1);
      });

      // Get unique categories and assign radial positions
      const categories = [...new Set(d.nodes.map((n) => n.category || "Other"))];
      const catPositions = new Map<string, { x: number; y: number }>();
      const radius = 250;
      categories.forEach((cat, i) => {
        const angle = (2 * Math.PI * i) / categories.length - Math.PI / 2;
        catPositions.set(cat, {
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
        });
      });

      // Assign initial positions by category with jitter
      d.nodes.forEach((n) => {
        n.connections = counts.get(n.id) || 0;
        const cat = n.category || "Other";
        const center = catPositions.get(cat) || { x: 0, y: 0 };
        n.x = center.x + (Math.random() - 0.5) * 100;
        n.y = center.y + (Math.random() - 0.5) * 100;
      });

      setData(d);
    } catch (err) {
      console.error("Graph error:", err);
    } finally {
      setLoading(false);
    }
  }, [threshold]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const update = () => {
      if (containerRef.current) {
        setDims({ w: containerRef.current.offsetWidth, h: containerRef.current.offsetHeight });
      }
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Add clustering force after graph mounts
  useEffect(() => {
    if (!fgRef.current || data.nodes.length === 0) return;

    // Custom clustering force: pull nodes toward their category center
    const categories = [...new Set(data.nodes.map((n) => n.category || "Other"))];
    const radius = 250;
    const catPositions = new Map<string, { x: number; y: number }>();
    categories.forEach((cat, i) => {
      const angle = (2 * Math.PI * i) / categories.length - Math.PI / 2;
      catPositions.set(cat, {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      });
    });

    fgRef.current.d3Force("cluster", () => {
      data.nodes.forEach((node) => {
        const cat = node.category || "Other";
        const center = catPositions.get(cat);
        if (center && node.x !== undefined && node.y !== undefined) {
          const k = 0.05;
          node.vx = (node.vx || 0) + (center.x - node.x) * k;
          node.vy = (node.vy || 0) + (center.y - node.y) * k;
        }
      });
    });

    fgRef.current.d3Force("charge")?.strength(-30);
    fgRef.current.d3Force("link")?.distance(40).strength(0.3);

    setTimeout(() => fgRef.current?.zoomToFit(400, 80), 800);
  }, [data]);

  // Compute cluster centroids for labels (from current positions)
  const clusterCentroids = new Map<string, { x: number; y: number; count: number }>();
  data.nodes.forEach((n) => {
    const cat = n.category || "Other";
    const c = clusterCentroids.get(cat) || { x: 0, y: 0, count: 0 };
    c.x += n.x || 0;
    c.y += n.y || 0;
    c.count += 1;
    clusterCentroids.set(cat, c);
  });

  const categories = [...new Set(data.nodes.map((n) => n.category || "Other"))].sort();

  const selectedLinks = selected
    ? data.links
        .filter((l) => {
          const src = typeof l.source === "string" ? l.source : (l.source as any).id;
          const tgt = typeof l.target === "string" ? l.target : (l.target as any).id;
          return src === selected.id || tgt === selected.id;
        })
        .map((l) => {
          const src = typeof l.source === "string" ? l.source : (l.source as any).id;
          const tgt = typeof l.target === "string" ? l.target : (l.target as any).id;
          const otherId = src === selected.id ? tgt : src;
          return { node: data.nodes.find((n) => n.id === otherId), sim: l.similarity };
        })
        .filter((c) => c.node)
        .sort((a, b) => b.sim - a.sim)
    : [];

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-800 bg-neutral-950 z-10">
        <h2 className="text-lg font-semibold text-white">Network</h2>
        <span className="text-xs text-neutral-500">
          {data.nodes.length} nodes / {data.links.length} links
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          {categories.map((c) => (
            <div key={c} className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getColor(c), boxShadow: `0 0 6px ${getColor(c)}80` }} />
              <span className="text-[10px] text-neutral-400">{c}</span>
            </div>
          ))}
        </div>
        <div className="w-px h-4 bg-neutral-800 mx-1" />
        <label className="text-xs text-neutral-400 flex items-center gap-2">
          <input type="range" min="0.4" max="0.9" step="0.05" value={threshold}
            onChange={(e) => setThreshold(parseFloat(e.target.value))}
            className="w-20 accent-violet-500" />
          <span className="font-mono text-neutral-300 w-7">{threshold}</span>
        </label>
      </div>

      <div className="flex-1 flex">
        <div ref={containerRef} className="flex-1 relative bg-[#08080c]">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center text-neutral-500 text-sm">
              Computing graph...
            </div>
          ) : (
            <ForceGraph2D
              ref={fgRef}
              width={selected ? dims.w - 320 : dims.w}
              height={dims.h - 49}
              graphData={data}
              nodeRelSize={4}
              nodeVal={(node: any) => 1.5 + (node.connections || 0) * 0.3}
              linkColor={() => "rgba(255,255,255,0.03)"}
              linkWidth={0.3}
              backgroundColor="#08080c"
              onNodeClick={(node: any) => setSelected(selected?.id === node.id ? null : node)}
              onBackgroundClick={() => setSelected(null)}
              cooldownTicks={300}
              nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
                const cat = node.category || "Other";
                const col = getColor(cat);
                const [r, g, b] = hexToRgb(col);
                const connections = node.connections || 0;
                const rad = 3 + connections * 0.5;
                const isSelected = selected?.id === node.id;

                // Glow
                const glowRad = rad + 6 + connections * 2;
                const gradient = ctx.createRadialGradient(node.x, node.y, rad * 0.5, node.x, node.y, glowRad);
                gradient.addColorStop(0, `rgba(${r},${g},${b},${isSelected ? 0.25 : 0.12})`);
                gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
                ctx.beginPath();
                ctx.arc(node.x, node.y, glowRad, 0, 2 * Math.PI);
                ctx.fillStyle = gradient;
                ctx.fill();

                // Circle
                ctx.beginPath();
                ctx.arc(node.x, node.y, rad, 0, 2 * Math.PI);
                ctx.fillStyle = `rgba(${r},${g},${b},0.9)`;
                ctx.fill();

                if (isSelected) {
                  ctx.strokeStyle = "white";
                  ctx.lineWidth = 1.5;
                  ctx.stroke();
                }

                // Label for high-connection nodes or zoomed
                if (globalScale > 2 || connections > 5 || isSelected) {
                  const label = `@${node.author_handle}`;
                  const fs = isSelected ? 5 : Math.max(3, 9 / globalScale);
                  ctx.font = `500 ${fs}px -apple-system, sans-serif`;
                  ctx.textAlign = "center";
                  ctx.textBaseline = "top";
                  ctx.fillStyle = `rgba(255,255,255,${isSelected ? 0.9 : 0.6})`;
                  ctx.fillText(label, node.x, node.y + rad + 2);
                }
              }}
              nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
                ctx.beginPath();
                ctx.arc(node.x, node.y, 8, 0, 2 * Math.PI);
                ctx.fillStyle = color;
                ctx.fill();
              }}
              onRenderFramePost={(ctx: CanvasRenderingContext2D, globalScale: number) => {
                // Draw cluster labels at centroids
                const centroids = new Map<string, { x: number; y: number; count: number }>();
                data.nodes.forEach((n) => {
                  const cat = n.category || "Other";
                  const c = centroids.get(cat) || { x: 0, y: 0, count: 0 };
                  c.x += n.x || 0;
                  c.y += n.y || 0;
                  c.count += 1;
                  centroids.set(cat, c);
                });

                centroids.forEach((centroid, cat) => {
                  if (centroid.count < 2) return;
                  const cx = centroid.x / centroid.count;
                  const cy = centroid.y / centroid.count;
                  const col = getColor(cat);
                  const [r, g, b] = hexToRgb(col);

                  // Background circle
                  ctx.beginPath();
                  ctx.arc(cx, cy - 15, 30 + centroid.count * 2, 0, 2 * Math.PI);
                  ctx.fillStyle = `rgba(${r},${g},${b},0.04)`;
                  ctx.fill();

                  // Label
                  const fontSize = Math.max(8, 16 / globalScale);
                  ctx.font = `700 ${fontSize}px -apple-system, sans-serif`;
                  ctx.textAlign = "center";
                  ctx.textBaseline = "middle";
                  ctx.fillStyle = `rgba(${r},${g},${b},0.5)`;
                  ctx.fillText(cat, cx, cy - 20 / globalScale);

                  // Count
                  const countFs = Math.max(5, 10 / globalScale);
                  ctx.font = `400 ${countFs}px -apple-system, sans-serif`;
                  ctx.fillStyle = `rgba(${r},${g},${b},0.3)`;
                  ctx.fillText(`${centroid.count} tweets`, cx, cy - 20 / globalScale + fontSize + 2);
                });
              }}
            />
          )}
        </div>

        {selected && (
          <div className="w-80 border-l border-neutral-800 bg-neutral-950 overflow-y-auto shrink-0">
            <div className="p-4">
              <button onClick={() => setSelected(null)}
                className="text-neutral-500 hover:text-white text-xs float-right">Close</button>

              <div className="flex items-center gap-2 mb-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white"
                  style={{ backgroundColor: getColor(selected.category), boxShadow: `0 0 20px ${getColor(selected.category)}40` }}>
                  {selected.author_handle[0]?.toUpperCase()}
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">{selected.author_name || selected.author_handle}</div>
                  <div className="text-xs text-neutral-500">@{selected.author_handle}</div>
                </div>
              </div>

              {selected.category && (
                <span className="inline-block text-[10px] px-2 py-0.5 rounded-full mb-3"
                  style={{ backgroundColor: getColor(selected.category) + "20", color: getColor(selected.category), border: `1px solid ${getColor(selected.category)}30` }}>
                  {selected.category}
                </span>
              )}

              {selected.summary && <p className="text-sm text-neutral-300 mb-2">{selected.summary}</p>}
              <p className="text-xs text-neutral-500 leading-relaxed mb-4">{selected.content_preview}</p>

              <div className="border-t border-neutral-800 pt-3">
                <h4 className="text-xs font-medium text-neutral-400 mb-2">Similar tweets ({selectedLinks.length})</h4>
                <div className="space-y-2">
                  {selectedLinks.slice(0, 20).map((c) => (
                    <button key={c.node!.id} onClick={() => setSelected(c.node!)}
                      className="w-full text-left p-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 transition-colors">
                      <div className="flex items-center gap-1.5 mb-1">
                        <div className="w-3.5 h-3.5 rounded-full text-[7px] font-bold text-white flex items-center justify-center"
                          style={{ backgroundColor: getColor(c.node!.category) }}>
                          {c.node!.author_handle[0]?.toUpperCase()}
                        </div>
                        <span className="text-[11px] text-neutral-300 truncate">@{c.node!.author_handle}</span>
                        <span className="text-[9px] text-violet-400 ml-auto">{(c.sim * 100).toFixed(0)}%</span>
                      </div>
                      <p className="text-[10px] text-neutral-500 line-clamp-2">{c.node!.summary || c.node!.content_preview}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
