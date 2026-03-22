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
  topics: string[];
  connections?: number;
  subCluster?: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  [key: string]: unknown;
}

interface GraphLink { source: string; target: string; similarity: number; [key: string]: unknown; }
interface RawGraphData { nodes: GraphNode[]; links: GraphLink[]; }

const COLORS: Record<string, string> = {
  AI: "#a78bfa", "Dev Tools": "#22d3ee", "Web Dev": "#60a5fa", "Crypto/Finance": "#4ade80",
  Design: "#f472b6", Science: "#fbbf24", Business: "#fb923c", Politics: "#f87171",
  Humor: "#bef264", Personal: "#cbd5e1", Other: "#737380",
};

function col(cat: string | null) { return COLORS[cat || "Other"] || COLORS.Other; }
function rgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

interface SubClusterInfo {
  key: string;
  label: string;
  category: string;
  nodes: GraphNode[];
  cx: number;
  cy: number;
}

export function Network() {
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; links: GraphLink[] }>({ nodes: [], links: [] });
  const [subClusters, setSubClusters] = useState<SubClusterInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [threshold, setThreshold] = useState(0.65);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [hovered, setHovered] = useState<GraphNode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });
  const subClusterCenters = useRef(new Map<string, { cx: number; cy: number }>());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await invoke<RawGraphData>("get_network_graph", {
        source: "bookmark",
        similarityThreshold: threshold,
        limit: 400,
      });

      // Count connections
      const counts = new Map<string, number>();
      d.links.forEach((l) => {
        counts.set(l.source, (counts.get(l.source) || 0) + 1);
        counts.set(l.target, (counts.get(l.target) || 0) + 1);
      });
      d.nodes.forEach((n) => { n.connections = counts.get(n.id) || 0; });

      // Assign sub-cluster: category + primary topic
      d.nodes.forEach((n) => {
        const cat = n.category || "Other";
        const topic = n.topics?.[0] || "general";
        n.subCluster = `${cat}::${topic}`;
      });

      // Count sub-clusters, merge small ones into category
      const scCounts = new Map<string, number>();
      d.nodes.forEach((n) => scCounts.set(n.subCluster!, (scCounts.get(n.subCluster!) || 0) + 1));
      d.nodes.forEach((n) => {
        if ((scCounts.get(n.subCluster!) || 0) < 3) {
          n.subCluster = `${n.category || "Other"}::misc`;
        }
      });

      // Get unique sub-clusters grouped by category
      const catSubClusters = new Map<string, string[]>();
      d.nodes.forEach((n) => {
        const cat = n.category || "Other";
        const scs = catSubClusters.get(cat) || [];
        if (!scs.includes(n.subCluster!)) scs.push(n.subCluster!);
        catSubClusters.set(cat, scs);
      });

      // Position categories in a circle, sub-clusters around each category center
      const categories = [...catSubClusters.keys()].sort((a, b) => {
        const ca = d.nodes.filter((n) => n.category === a).length;
        const cb = d.nodes.filter((n) => n.category === b).length;
        return cb - ca;
      });

      const mainRadius = 700;
      const centers = new Map<string, { cx: number; cy: number }>();
      subClusterCenters.current.clear();

      categories.forEach((cat, i) => {
        const angle = (2 * Math.PI * i) / categories.length - Math.PI / 2;
        const cx = Math.cos(angle) * mainRadius;
        const cy = Math.sin(angle) * mainRadius;
        centers.set(cat, { cx, cy });

        const scs = catSubClusters.get(cat) || [];
        const subRadius = 120 + scs.length * 30;
        scs.forEach((sc, j) => {
          const subAngle = (2 * Math.PI * j) / scs.length;
          subClusterCenters.current.set(sc, {
            cx: cx + Math.cos(subAngle) * subRadius,
            cy: cy + Math.sin(subAngle) * subRadius,
          });
        });
      });

      // Assign initial positions
      d.nodes.forEach((n) => {
        const center = subClusterCenters.current.get(n.subCluster!) || { cx: 0, cy: 0 };
        n.x = center.cx + (Math.random() - 0.5) * 120;
        n.y = center.cy + (Math.random() - 0.5) * 120;
      });

      // Filter: intra-category links only, connected nodes only
      const nodeCat = new Map<string, string>();
      d.nodes.forEach((n) => nodeCat.set(n.id, n.category || "Other"));
      const filteredLinks = d.links.filter((l) => nodeCat.get(l.source) === nodeCat.get(l.target));
      // Show ALL nodes, not just connected ones
      const filteredNodes = d.nodes;

      // Build sub-cluster info
      const scInfo = new Map<string, SubClusterInfo>();
      filteredNodes.forEach((n) => {
        const key = n.subCluster!;
        const info = scInfo.get(key) || {
          key,
          label: key.split("::")[1] || "misc",
          category: key.split("::")[0],
          nodes: [],
          cx: 0, cy: 0,
        };
        info.nodes.push(n);
        scInfo.set(key, info);
      });

      setGraphData({ nodes: filteredNodes, links: filteredLinks });
      setSubClusters([...scInfo.values()].filter((sc) => sc.nodes.length >= 2));
    } catch (err) {
      console.error("Graph error:", err);
    } finally {
      setLoading(false);
    }
  }, [threshold]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const update = () => {
      if (containerRef.current) setDims({ w: containerRef.current.offsetWidth, h: containerRef.current.offsetHeight });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (!fgRef.current || graphData.nodes.length === 0) return;

    fgRef.current.d3Force("cluster", () => {
      graphData.nodes.forEach((node) => {
        const center = subClusterCenters.current.get(node.subCluster || "");
        if (center && node.x !== undefined && node.y !== undefined) {
          node.vx = (node.vx || 0) + (center.cx - node.x) * 0.03;
          node.vy = (node.vy || 0) + (center.cy - node.y) * 0.03;
        }
      });
    });

    fgRef.current.d3Force("charge")?.strength(-2000).distanceMax(250);
    fgRef.current.d3Force("center", null);
    fgRef.current.d3Force("link")?.distance(60).strength(0.1);

    // Immediate zoom to fit since warmupTicks already computed layout
    setTimeout(() => fgRef.current?.zoomToFit(0, 40), 100);
  }, [graphData]);

  // Hover
  const hoveredNeighbors = new Set<string>();
  const hoveredLinkKeys = new Set<string>();
  if (hovered) {
    hoveredNeighbors.add(hovered.id);
    graphData.links.forEach((l) => {
      const src = typeof l.source === "string" ? l.source : (l.source as any).id;
      const tgt = typeof l.target === "string" ? l.target : (l.target as any).id;
      if (src === hovered.id || tgt === hovered.id) {
        hoveredLinkKeys.add(`${src}|${tgt}`);
        hoveredNeighbors.add(src);
        hoveredNeighbors.add(tgt);
      }
    });
  }

  // Category summary
  const catCounts = new Map<string, number>();
  graphData.nodes.forEach((n) => catCounts.set(n.category || "Other", (catCounts.get(n.category || "Other") || 0) + 1));
  const categories = [...catCounts.entries()].sort((a, b) => b[1] - a[1]);

  const selectedLinks = selected
    ? graphData.links
        .filter((l) => {
          const src = typeof l.source === "string" ? l.source : (l.source as any).id;
          const tgt = typeof l.target === "string" ? l.target : (l.target as any).id;
          return src === selected.id || tgt === selected.id;
        })
        .map((l) => {
          const src = typeof l.source === "string" ? l.source : (l.source as any).id;
          const tgt = typeof l.target === "string" ? l.target : (l.target as any).id;
          return { node: graphData.nodes.find((n) => n.id === (src === selected.id ? tgt : src)), sim: l.similarity };
        })
        .filter((c) => c.node)
        .sort((a, b) => b.sim - a.sim)
    : [];

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-white/[0.06] bg-[#0c0c10]/90 backdrop-blur-sm z-10">
        <h2 className="text-[15px] font-semibold text-white/90">Network</h2>
        <div className="h-1 w-1 rounded-full bg-white/10" />
        <span className="text-[11px] text-white/20 tabular-nums">{graphData.nodes.length} nodes / {graphData.links.length} links</span>
        <div className="flex-1" />
        <div className="flex items-center gap-3">
          {categories.map(([cat, count]) => (
            <div key={cat} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: col(cat), boxShadow: `0 0 6px ${col(cat)}40` }} />
              <span className="text-[10px] text-white/30">{cat}</span>
              <span className="text-[9px] text-white/15 tabular-nums">{count}</span>
            </div>
          ))}
        </div>
        <div className="w-px h-3.5 bg-white/[0.06] mx-2" />
        <div className="flex items-center gap-2">
          <input type="range" min="0.4" max="0.9" step="0.05" value={threshold}
            onChange={(e) => setThreshold(parseFloat(e.target.value))} className="w-20 accent-violet-500 h-1" />
          <span className="text-[10px] font-mono text-white/30 w-6">{threshold}</span>
        </div>
      </div>

      <div className="flex-1 flex">
        <div ref={containerRef} className="flex-1 relative bg-[#08080c]">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-5 h-5 border-2 border-violet-500/20 border-t-violet-500 rounded-full animate-spin" />
            </div>
          ) : (
            <ForceGraph2D
              ref={fgRef}
              width={selected ? dims.w - 340 : dims.w}
              height={dims.h - 49}
              graphData={graphData}
              nodeRelSize={3}
              nodeVal={(node: any) => 1 + (node.connections || 0) * 0.2}
              backgroundColor="#08080c"
              onNodeClick={(node: any) => setSelected(selected?.id === node.id ? null : node)}
              onNodeHover={(node: any) => setHovered(node)}
              onBackgroundClick={() => setSelected(null)}
              cooldownTicks={0}
              warmupTicks={300}
              linkWidth={(link: any) => {
                if (!hovered) return 0.2;
                const src = typeof link.source === "string" ? link.source : link.source.id;
                const tgt = typeof link.target === "string" ? link.target : link.target.id;
                return hoveredLinkKeys.has(`${src}|${tgt}`) ? 1.5 : 0.05;
              }}
              linkColor={(link: any) => {
                if (!hovered) return "rgba(255,255,255,0.03)";
                const src = typeof link.source === "string" ? link.source : link.source.id;
                const tgt = typeof link.target === "string" ? link.target : link.target.id;
                if (hoveredLinkKeys.has(`${src}|${tgt}`)) {
                  const [r, g, b] = rgb(col(hovered.category));
                  return `rgba(${r},${g},${b},0.4)`;
                }
                return "rgba(255,255,255,0.005)";
              }}
              onRenderFramePost={(ctx: CanvasRenderingContext2D, globalScale: number) => {
                // Draw sub-cluster labels and boundaries
                const scLive = new Map<string, { nodes: GraphNode[]; cx: number; cy: number; cat: string; label: string }>();
                graphData.nodes.forEach((n) => {
                  const key = n.subCluster || "";
                  const info = scLive.get(key) || { nodes: [], cx: 0, cy: 0, cat: n.category || "Other", label: key.split("::")[1] || "" };
                  info.nodes.push(n);
                  info.cx += n.x || 0;
                  info.cy += n.y || 0;
                  scLive.set(key, info);
                });

                scLive.forEach((info) => {
                  if (info.nodes.length < 3) return;
                  info.cx /= info.nodes.length;
                  info.cy /= info.nodes.length;

                  let maxDist = 0;
                  info.nodes.forEach((n) => {
                    const dist = Math.sqrt(((n.x || 0) - info.cx) ** 2 + ((n.y || 0) - info.cy) ** 2);
                    if (dist > maxDist) maxDist = dist;
                  });
                  const r = maxDist + 20;
                  const [cr, cg, cb] = rgb(col(info.cat));

                  // Soft boundary
                  ctx.beginPath();
                  ctx.arc(info.cx, info.cy, r, 0, 2 * Math.PI);
                  ctx.setLineDash([3 / globalScale, 5 / globalScale]);
                  ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.06)`;
                  ctx.lineWidth = 0.5;
                  ctx.stroke();
                  ctx.setLineDash([]);

                  // Sub-cluster label
                  if (info.label && info.label !== "misc" && info.label !== "general") {
                    const fs = Math.max(5, 11 / globalScale);
                    ctx.font = `500 ${fs}px -apple-system, sans-serif`;
                    ctx.textAlign = "center";
                    ctx.fillStyle = `rgba(${cr},${cg},${cb},0.25)`;
                    ctx.fillText(info.label, info.cx, info.cy - r - 4 / globalScale);
                  }
                });

                // Category mega-labels (larger, at the centroid of all sub-clusters)
                const catCentroids = new Map<string, { cx: number; cy: number; count: number }>();
                graphData.nodes.forEach((n) => {
                  const cat = n.category || "Other";
                  const c = catCentroids.get(cat) || { cx: 0, cy: 0, count: 0 };
                  c.cx += n.x || 0; c.cy += n.y || 0; c.count += 1;
                  catCentroids.set(cat, c);
                });

                catCentroids.forEach((c, cat) => {
                  if (c.count < 2) return;
                  c.cx /= c.count; c.cy /= c.count;
                  const [cr, cg, cb] = rgb(col(cat));

                  // Big gradient bg
                  let maxDist = 0;
                  graphData.nodes.filter((n) => n.category === cat).forEach((n) => {
                    const dist = Math.sqrt(((n.x || 0) - c.cx) ** 2 + ((n.y || 0) - c.cy) ** 2);
                    if (dist > maxDist) maxDist = dist;
                  });
                  const bigR = maxDist + 50;
                  const grad = ctx.createRadialGradient(c.cx, c.cy, 0, c.cx, c.cy, bigR);
                  grad.addColorStop(0, `rgba(${cr},${cg},${cb},0.025)`);
                  grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
                  ctx.beginPath();
                  ctx.arc(c.cx, c.cy, bigR, 0, 2 * Math.PI);
                  ctx.fillStyle = grad;
                  ctx.fill();

                  const fs = Math.max(12, 24 / globalScale);
                  ctx.font = `700 ${fs}px "SF Pro Display", -apple-system, sans-serif`;
                  ctx.textAlign = "center";
                  ctx.fillStyle = `rgba(${cr},${cg},${cb},0.3)`;
                  ctx.fillText(cat, c.cx, c.cy - bigR - 6 / globalScale);

                  const cfs = Math.max(6, 12 / globalScale);
                  ctx.font = `400 ${cfs}px -apple-system, sans-serif`;
                  ctx.fillStyle = `rgba(${cr},${cg},${cb},0.15)`;
                  ctx.fillText(`${c.count} tweets`, c.cx, c.cy - bigR - 6 / globalScale + fs + 2);
                });
              }}
              nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
                const color = col(node.category);
                const [r, g, b] = rgb(color);
                const conns = node.connections || 0;
                const rad = 2.5 + Math.sqrt(conns) * 1;
                const isSel = selected?.id === node.id;
                const isHov = hovered?.id === node.id;
                const isNbr = hoveredNeighbors.has(node.id);
                const dim = hovered && !isNbr;
                const alpha = dim ? 0.06 : isHov || isSel ? 1 : isNbr ? 0.9 : 0.65;

                if ((conns > 3 || isHov || isSel) && !dim) {
                  const gr = rad + (isHov ? 10 : 6);
                  const gradient = ctx.createRadialGradient(node.x, node.y, rad, node.x, node.y, gr);
                  gradient.addColorStop(0, `rgba(${r},${g},${b},${isHov ? 0.25 : 0.1})`);
                  gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
                  ctx.beginPath(); ctx.arc(node.x, node.y, gr, 0, 2 * Math.PI);
                  ctx.fillStyle = gradient; ctx.fill();
                }

                ctx.beginPath(); ctx.arc(node.x, node.y, rad, 0, 2 * Math.PI);
                ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`; ctx.fill();

                if (isSel || isHov) { ctx.strokeStyle = `rgba(255,255,255,${isHov ? 0.5 : 0.3})`; ctx.lineWidth = 1; ctx.stroke(); }

                const showLabel = isHov || isSel || isNbr || globalScale > 3 || conns > 8;
                if (showLabel && !dim) {
                  const fs = isHov ? 5 : isSel ? 4.5 : Math.max(2.5, 7 / globalScale);
                  ctx.font = `${isHov || isSel ? "600" : "400"} ${fs}px -apple-system, sans-serif`;
                  ctx.textAlign = "center"; ctx.textBaseline = "top";
                  ctx.fillStyle = `rgba(255,255,255,${isHov ? 0.9 : isNbr ? 0.6 : 0.35})`;
                  ctx.fillText(`@${node.author_handle}`, node.x, node.y + rad + 1.5);
                }
              }}
              nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
                ctx.beginPath(); ctx.arc(node.x, node.y, 6, 0, 2 * Math.PI);
                ctx.fillStyle = color; ctx.fill();
              }}
            />
          )}
        </div>

        {selected && (
          <div className="w-[340px] border-l border-white/[0.06] bg-[#0a0a0e] overflow-y-auto shrink-0">
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <span className="text-[10px] text-white/20 uppercase tracking-widest">Tweet detail</span>
                <button onClick={() => setSelected(null)} className="text-white/20 hover:text-white/60 text-[11px]">Close</button>
              </div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-11 h-11 rounded-full flex items-center justify-center text-[14px] font-bold"
                  style={{ backgroundColor: col(selected.category) + "20", color: col(selected.category) }}>
                  {selected.author_handle[0]?.toUpperCase()}
                </div>
                <div>
                  <div className="text-[14px] font-semibold text-white/90">{selected.author_name || selected.author_handle}</div>
                  <div className="text-[12px] text-white/30">@{selected.author_handle}</div>
                </div>
              </div>
              {selected.category && (
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: col(selected.category) }} />
                  <span className="text-[11px] font-medium" style={{ color: col(selected.category) }}>{selected.category}</span>
                </div>
              )}
              {selected.topics?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {selected.topics.map((t) => (
                    <span key={t} className="text-[9px] px-2 py-0.5 rounded-full bg-white/[0.04] text-white/30 border border-white/[0.06]">{t}</span>
                  ))}
                </div>
              )}
              {selected.summary && <p className="text-[13px] text-white/60 leading-relaxed mb-3">{selected.summary}</p>}
              <p className="text-[12px] text-white/25 leading-relaxed mb-5">{selected.content_preview}</p>

              {selectedLinks.length > 0 && (
                <div className="border-t border-white/[0.04] pt-4">
                  <h4 className="text-[10px] text-white/20 uppercase tracking-widest mb-3">Similar ({selectedLinks.length})</h4>
                  <div className="space-y-1">
                    {selectedLinks.slice(0, 15).map((c) => (
                      <button key={c.node!.id} onClick={() => setSelected(c.node!)}
                        className="w-full text-left p-3 rounded-xl hover:bg-white/[0.04] transition-all group">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="w-5 h-5 rounded-full text-[8px] font-bold flex items-center justify-center"
                            style={{ backgroundColor: col(c.node!.category) + "20", color: col(c.node!.category) }}>
                            {c.node!.author_handle[0]?.toUpperCase()}
                          </div>
                          <span className="text-[11px] text-white/40 group-hover:text-white/70 truncate">@{c.node!.author_handle}</span>
                          <span className="text-[9px] font-mono ml-auto" style={{ color: col(c.node!.category) }}>{(c.sim * 100).toFixed(0)}%</span>
                        </div>
                        <p className="text-[10px] text-white/20 group-hover:text-white/30 line-clamp-2">{c.node!.summary || c.node!.content_preview}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
