import { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/appStore";
import ForceGraph2D from "react-force-graph-2d";

interface GraphNode {
  id: string;
  author_handle: string;
  author_name: string | null;
  content_preview: string;
  category: string | null;
  summary: string | null;
  topics: string[];
  connections?: number;
  subCluster?: string;
  x?: number; y?: number; vx?: number; vy?: number;
  [key: string]: unknown;
}

interface GraphLink { source: string; target: string; similarity: number; [key: string]: unknown; }
interface RawGraphData { nodes: GraphNode[]; links: GraphLink[]; }

const COLORS: Record<string, string> = {
  AI: "#7C3AED", "Dev Tools": "#0891B2", "Web Dev": "#2563EB", "Crypto/Finance": "#059669",
  Design: "#DB2777", Science: "#D97706", Business: "#EA580C", Politics: "#DC2626",
  Humor: "#65A30D", Personal: "#64748B", Other: "#71717A",
};

function col(cat: string | null) { return COLORS[cat || "Other"] || COLORS.Other; }
function rgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

export function Graph() {
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; links: GraphLink[] }>({ nodes: [], links: [] });
  const [loading, setLoading] = useState(true);
  const [threshold, setThreshold] = useState(0.65);
  const [hovered, setHovered] = useState<GraphNode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });
  const subClusterCenters = useRef(new Map<string, { cx: number; cy: number }>());
  const pushFocus = useAppStore((s) => s.pushFocus);
  const focusStack = useAppStore((s) => s.focusStack);
  const hasFocus = focusStack.length > 0;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await invoke<RawGraphData>("get_network_graph", { source: "bookmark", similarityThreshold: threshold, limit: 400 });

      const counts = new Map<string, number>();
      d.links.forEach((l) => { counts.set(l.source, (counts.get(l.source) || 0) + 1); counts.set(l.target, (counts.get(l.target) || 0) + 1); });
      d.nodes.forEach((n) => { n.connections = counts.get(n.id) || 0; });

      d.nodes.forEach((n) => { n.subCluster = `${n.category || "Other"}::${n.topics?.[0] || "general"}`; });
      const scCounts = new Map<string, number>();
      d.nodes.forEach((n) => scCounts.set(n.subCluster!, (scCounts.get(n.subCluster!) || 0) + 1));
      d.nodes.forEach((n) => { if ((scCounts.get(n.subCluster!) || 0) < 3) n.subCluster = `${n.category || "Other"}::misc`; });

      const catSubClusters = new Map<string, string[]>();
      d.nodes.forEach((n) => { const cat = n.category || "Other"; const scs = catSubClusters.get(cat) || []; if (!scs.includes(n.subCluster!)) scs.push(n.subCluster!); catSubClusters.set(cat, scs); });

      const categories = [...catSubClusters.keys()].sort((a, b) => d.nodes.filter((n) => n.category === b).length - d.nodes.filter((n) => n.category === a).length);
      const mainRadius = 700;
      subClusterCenters.current.clear();
      categories.forEach((cat, i) => {
        const angle = (2 * Math.PI * i) / categories.length - Math.PI / 2;
        const cx = Math.cos(angle) * mainRadius, cy = Math.sin(angle) * mainRadius;
        const scs = catSubClusters.get(cat) || [];
        const subRadius = 120 + scs.length * 30;
        scs.forEach((sc, j) => { const subAngle = (2 * Math.PI * j) / scs.length; subClusterCenters.current.set(sc, { cx: cx + Math.cos(subAngle) * subRadius, cy: cy + Math.sin(subAngle) * subRadius }); });
      });

      d.nodes.forEach((n) => { const c = subClusterCenters.current.get(n.subCluster!) || { cx: 0, cy: 0 }; n.x = c.cx + (Math.random() - 0.5) * 120; n.y = c.cy + (Math.random() - 0.5) * 120; });

      const nodeCat = new Map<string, string>();
      d.nodes.forEach((n) => nodeCat.set(n.id, n.category || "Other"));
      setGraphData({ nodes: d.nodes, links: d.links.filter((l) => nodeCat.get(l.source) === nodeCat.get(l.target)) });
    } catch (err) { console.error("Graph error:", err); }
    finally { setLoading(false); }
  }, [threshold]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const update = () => { if (containerRef.current) setDims({ w: containerRef.current.offsetWidth, h: containerRef.current.offsetHeight }); };
    update(); window.addEventListener("resize", update); return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (!fgRef.current || graphData.nodes.length === 0) return;
    fgRef.current.d3Force("cluster", () => {
      graphData.nodes.forEach((node) => { const c = subClusterCenters.current.get(node.subCluster || ""); if (c && node.x !== undefined && node.y !== undefined) { node.vx = (node.vx || 0) + (c.cx - node.x) * 0.03; node.vy = (node.vy || 0) + (c.cy - node.y) * 0.03; } });
    });
    fgRef.current.d3Force("charge")?.strength(-2000).distanceMax(250);
    fgRef.current.d3Force("center", null);
    fgRef.current.d3Force("link")?.distance(60).strength(0.1);
    setTimeout(() => fgRef.current?.zoomToFit(0, 40), 100);
  }, [graphData]);

  const hoveredNeighbors = new Set<string>();
  const hoveredLinkKeys = new Set<string>();
  if (hovered) {
    hoveredNeighbors.add(hovered.id);
    graphData.links.forEach((l) => {
      const src = typeof l.source === "string" ? l.source : (l.source as any).id;
      const tgt = typeof l.target === "string" ? l.target : (l.target as any).id;
      if (src === hovered.id || tgt === hovered.id) { hoveredLinkKeys.add(`${src}|${tgt}`); hoveredNeighbors.add(src); hoveredNeighbors.add(tgt); }
    });
  }

  // Category legend
  const catCounts = new Map<string, number>();
  graphData.nodes.forEach((n) => catCounts.set(n.category || "Other", (catCounts.get(n.category || "Other") || 0) + 1));
  const categories = [...catCounts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="h-full flex flex-col">
      {/* Graph toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-zinc-100 bg-white text-[11px] text-zinc-400">
        <span>{graphData.nodes.length} nodes / {graphData.links.length} links</span>
        <div className="flex-1" />
        {categories.slice(0, 8).map(([cat, count]) => (
          <div key={cat} className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: col(cat) }} />
            <span className="text-zinc-500">{cat}</span>
            <span className="text-zinc-300">{count}</span>
          </div>
        ))}
        <div className="w-px h-3 bg-zinc-200 mx-1" />
        <span className="text-zinc-500">Similarity</span>
        <input type="range" min="0.4" max="0.9" step="0.05" value={threshold}
          onChange={(e) => setThreshold(parseFloat(e.target.value))} className="w-16 accent-violet-600 h-1" />
        <span className="text-zinc-400 w-6">{threshold}</span>
      </div>

      <div ref={containerRef} className="flex-1 relative bg-zinc-50">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-4 h-4 border-2 border-zinc-200 border-t-zinc-900 rounded-full animate-spin" />
          </div>
        ) : (
          <ForceGraph2D
            ref={fgRef}
            width={hasFocus ? dims.w : dims.w}
            height={dims.h - 33}
            graphData={graphData}
            nodeRelSize={3}
            nodeVal={(node: any) => 1 + (node.connections || 0) * 0.2}
            backgroundColor="#FAFAFB"
            onNodeClick={(node: any) => pushFocus({ type: "tweet", id: node.id })}
            onNodeHover={(node: any) => setHovered(node)}
            onBackgroundClick={() => {}}
            cooldownTicks={0}
            warmupTicks={300}
            linkWidth={(link: any) => {
              if (!hovered) return 0.3;
              const src = typeof link.source === "string" ? link.source : link.source.id;
              const tgt = typeof link.target === "string" ? link.target : link.target.id;
              return hoveredLinkKeys.has(`${src}|${tgt}`) ? 1.5 : 0.05;
            }}
            linkColor={(link: any) => {
              if (!hovered) return "rgba(0,0,0,0.04)";
              const src = typeof link.source === "string" ? link.source : link.source.id;
              const tgt = typeof link.target === "string" ? link.target : link.target.id;
              if (hoveredLinkKeys.has(`${src}|${tgt}`)) { const [r, g, b] = rgb(col(hovered.category)); return `rgba(${r},${g},${b},0.5)`; }
              return "rgba(0,0,0,0.01)";
            }}
            onRenderFramePost={(ctx: CanvasRenderingContext2D, globalScale: number) => {
              // Category mega-labels
              const catCentroids = new Map<string, { cx: number; cy: number; count: number }>();
              graphData.nodes.forEach((n) => { const cat = n.category || "Other"; const c = catCentroids.get(cat) || { cx: 0, cy: 0, count: 0 }; c.cx += n.x || 0; c.cy += n.y || 0; c.count += 1; catCentroids.set(cat, c); });
              catCentroids.forEach((c, cat) => {
                if (c.count < 2) return;
                c.cx /= c.count; c.cy /= c.count;
                const [cr, cg, cb] = rgb(col(cat));
                let maxDist = 0;
                graphData.nodes.filter((n) => n.category === cat).forEach((n) => { const dist = Math.sqrt(((n.x || 0) - c.cx) ** 2 + ((n.y || 0) - c.cy) ** 2); if (dist > maxDist) maxDist = dist; });
                const bigR = maxDist + 50;
                const grad = ctx.createRadialGradient(c.cx, c.cy, 0, c.cx, c.cy, bigR);
                grad.addColorStop(0, `rgba(${cr},${cg},${cb},0.04)`);
                grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
                ctx.beginPath(); ctx.arc(c.cx, c.cy, bigR, 0, 2 * Math.PI); ctx.fillStyle = grad; ctx.fill();
                const fs = Math.max(12, 24 / globalScale);
                ctx.font = `600 ${fs}px -apple-system, sans-serif`; ctx.textAlign = "center";
                ctx.fillStyle = `rgba(${cr},${cg},${cb},0.4)`;
                ctx.fillText(cat, c.cx, c.cy - bigR - 6 / globalScale);
              });
            }}
            nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
              const color = col(node.category);
              const [r, g, b] = rgb(color);
              const conns = node.connections || 0;
              const rad = 2.5 + Math.sqrt(conns) * 1;
              const isHov = hovered?.id === node.id;
              const isNbr = hoveredNeighbors.has(node.id);
              const dim = hovered && !isNbr;
              const alpha = dim ? 0.1 : isHov ? 1 : isNbr ? 0.9 : 0.7;

              if ((conns > 3 || isHov) && !dim) {
                const gr = rad + (isHov ? 10 : 6);
                const gradient = ctx.createRadialGradient(node.x, node.y, rad, node.x, node.y, gr);
                gradient.addColorStop(0, `rgba(${r},${g},${b},${isHov ? 0.2 : 0.08})`);
                gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
                ctx.beginPath(); ctx.arc(node.x, node.y, gr, 0, 2 * Math.PI); ctx.fillStyle = gradient; ctx.fill();
              }
              ctx.beginPath(); ctx.arc(node.x, node.y, rad, 0, 2 * Math.PI);
              ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`; ctx.fill();
              if (isHov) { ctx.strokeStyle = `rgba(${r},${g},${b},0.6)`; ctx.lineWidth = 1; ctx.stroke(); }

              const showLabel = isHov || isNbr || globalScale > 3 || conns > 8;
              if (showLabel && !dim) {
                const fs = isHov ? 5 : Math.max(2.5, 7 / globalScale);
                ctx.font = `${isHov ? "600" : "400"} ${fs}px -apple-system, sans-serif`;
                ctx.textAlign = "center"; ctx.textBaseline = "top";
                ctx.fillStyle = `rgba(24,24,27,${isHov ? 0.9 : isNbr ? 0.6 : 0.35})`;
                ctx.fillText(`@${node.author_handle}`, node.x, node.y + rad + 1.5);
              }
            }}
            nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
              ctx.beginPath(); ctx.arc(node.x, node.y, 6, 0, 2 * Math.PI); ctx.fillStyle = color; ctx.fill();
            }}
          />
        )}
      </div>
    </div>
  );
}
