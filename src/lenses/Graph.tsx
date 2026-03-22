import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/appStore";
import ForceGraph2D from "react-force-graph-2d";
import { ZoomIn, ZoomOut, Maximize2, Layers } from "lucide-react";

interface GraphNode {
  id: string;
  author_handle: string;
  author_name: string | null;
  content_preview: string;
  category: string | null;
  cluster: string | null;
  summary: string | null;
  topics: string[];
  created_at: string | null;
  connections?: number;
  x?: number; y?: number; vx?: number; vy?: number;
  [key: string]: unknown;
}

interface GraphLink { source: string; target: string; similarity: number; [key: string]: unknown; }
interface RawGraphData { nodes: GraphNode[]; links: GraphLink[]; }

const DOMAIN_COLORS: Record<string, string> = {
  "ai/ml": "#7C3AED", "dev-tools": "#0891B2", "web": "#2563EB", "crypto": "#059669",
  "design": "#DB2777", "science": "#D97706", "business": "#EA580C", "politics": "#DC2626",
  "culture": "#65A30D", "other": "#71717A",
  // Legacy
  AI: "#7C3AED", "Dev Tools": "#0891B2", "Web Dev": "#2563EB", "Crypto/Finance": "#059669",
  Design: "#DB2777", Science: "#D97706", Business: "#EA580C", Politics: "#DC2626",
  Humor: "#65A30D", Personal: "#64748B", Other: "#71717A",
};

function col(cat: string | null) { return DOMAIN_COLORS[cat || "other"] || DOMAIN_COLORS.other; }
function rgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

export function Graph() {
  const [allNodes, setAllNodes] = useState<GraphNode[]>([]);
  const [allLinks, setAllLinks] = useState<GraphLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [threshold, setThreshold] = useState(0.55);
  const [hovered, setHovered] = useState<GraphNode | null>(null);
  const [showCrossCategory, setShowCrossCategory] = useState(true);
  const storeCluster = useAppStore((s) => s.activeCluster);
  const setStoreCluster = useAppStore((s) => s.setActiveCluster);
  const [selectedCluster, setSelectedCluster] = useState<string | null>(storeCluster);
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });
  const pushFocus = useAppStore((s) => s.pushFocus);

  // Sync from store (when navigated from River)
  useEffect(() => {
    if (storeCluster) {
      setSelectedCluster(storeCluster);
      setStoreCluster(null); // consumed
    }
  }, [storeCluster]);

  // Load all data once with a low threshold, then filter client-side
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await invoke<RawGraphData>("get_network_graph", {
        similarityThreshold: 0.35, // Fetch all edges, filter client-side
        limit: 500,
      });

      // Count connections per node (at current threshold)
      const counts = new Map<string, number>();
      d.links.forEach((l) => {
        if (l.similarity >= threshold) {
          counts.set(l.source, (counts.get(l.source) || 0) + 1);
          counts.set(l.target, (counts.get(l.target) || 0) + 1);
        }
      });
      d.nodes.forEach((n) => { n.connections = counts.get(n.id) || 0; });

      // Layout: cluster by ai_cluster (fine-grained)
      const clusterMap = new Map<string, GraphNode[]>();
      d.nodes.forEach((n) => {
        const key = n.cluster || n.category || "other";
        const arr = clusterMap.get(key) || [];
        arr.push(n);
        clusterMap.set(key, arr);
      });

      // Sort clusters by size
      const clusters = [...clusterMap.entries()].sort((a, b) => b[1].length - a[1].length);
      const mainRadius = 500 + clusters.length * 20;

      clusters.forEach(([_clusterName, nodes], i) => {
        const angle = (2 * Math.PI * i) / clusters.length - Math.PI / 2;
        const cx = Math.cos(angle) * mainRadius;
        const cy = Math.sin(angle) * mainRadius;
        const spread = Math.max(40, Math.sqrt(nodes.length) * 25);

        nodes.forEach((n, j) => {
          const subAngle = (2 * Math.PI * j) / nodes.length;
          const r = spread * (0.3 + Math.random() * 0.7);
          n.x = cx + Math.cos(subAngle) * r;
          n.y = cy + Math.sin(subAngle) * r;
        });
      });

      setAllNodes(d.nodes);
      setAllLinks(d.links);
    } catch (err) { console.error("Graph error:", err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const update = () => {
      if (containerRef.current) setDims({ w: containerRef.current.offsetWidth, h: containerRef.current.offsetHeight });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Filter links by threshold client-side (no reload!)
  const graphData = useMemo(() => {
    const filteredLinks = allLinks.filter((l) => {
      if (l.similarity < threshold) return false;
      if (!showCrossCategory) {
        const srcNode = allNodes.find((n) => n.id === l.source);
        const tgtNode = allNodes.find((n) => n.id === l.target);
        if (srcNode?.category !== tgtNode?.category) return false;
      }
      return true;
    });

    // Recount connections
    const counts = new Map<string, number>();
    filteredLinks.forEach((l) => {
      const src = typeof l.source === "string" ? l.source : (l.source as any).id;
      const tgt = typeof l.target === "string" ? l.target : (l.target as any).id;
      counts.set(src, (counts.get(src) || 0) + 1);
      counts.set(tgt, (counts.get(tgt) || 0) + 1);
    });
    allNodes.forEach((n) => { n.connections = counts.get(n.id) || 0; });

    // Filter by selected cluster if any
    let nodes = allNodes;
    let links = filteredLinks;
    if (selectedCluster) {
      const nodeIds = new Set(allNodes.filter((n) => (n.cluster || n.category || "other") === selectedCluster).map((n) => n.id));
      nodes = allNodes.filter((n) => nodeIds.has(n.id));
      links = filteredLinks.filter((l) => {
        const src = typeof l.source === "string" ? l.source : (l.source as any).id;
        const tgt = typeof l.target === "string" ? l.target : (l.target as any).id;
        return nodeIds.has(src) && nodeIds.has(tgt);
      });
    }

    return { nodes, links };
  }, [allNodes, allLinks, threshold, showCrossCategory, selectedCluster]);

  // Setup forces
  useEffect(() => {
    if (!fgRef.current || graphData.nodes.length === 0) return;
    fgRef.current.d3Force("charge")?.strength(-800).distanceMax(300);
    fgRef.current.d3Force("center", null);
    fgRef.current.d3Force("link")?.distance(50).strength(0.15);
    setTimeout(() => fgRef.current?.zoomToFit(400, 60), 200);
  }, [graphData]);

  // Hover state
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

  // Cluster stats for sidebar
  const clusterStats = useMemo(() => {
    const map = new Map<string, { count: number; category: string }>();
    allNodes.forEach((n) => {
      const key = n.cluster || n.category || "other";
      const existing = map.get(key) || { count: 0, category: n.category || "other" };
      existing.count++;
      map.set(key, existing);
    });
    return [...map.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 30);
  }, [allNodes]);

  // Domain stats
  const domainStats = useMemo(() => {
    const map = new Map<string, number>();
    allNodes.forEach((n) => {
      const key = n.category || "other";
      map.set(key, (map.get(key) || 0) + 1);
    });
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [allNodes]);

  const handleZoomIn = () => fgRef.current?.zoom(fgRef.current.zoom() * 1.5, 300);
  const handleZoomOut = () => fgRef.current?.zoom(fgRef.current.zoom() / 1.5, 300);
  const handleFit = () => fgRef.current?.zoomToFit(400, 60);

  return (
    <div className="h-full flex">
      {/* Cluster sidebar */}
      <div className="w-52 border-r border-zinc-100 bg-white overflow-y-auto shrink-0">
        <div className="p-3">
          <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">Clusters</div>


          {/* Domain filters */}
          <div className="space-y-0.5 mb-3">
            {domainStats.map(([domain, count]) => (
              <div key={domain} className="flex items-center gap-1.5 text-[11px] text-zinc-500 px-1.5 py-0.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: col(domain) }} />
                <span className="truncate">{domain}</span>
                <span className="text-zinc-300 ml-auto">{count}</span>
              </div>
            ))}
          </div>

          <div className="h-px bg-zinc-100 my-2" />

          {/* Fine-grained clusters */}
          <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">Sujets</div>
          <button
            onClick={() => setSelectedCluster(null)}
            className={`w-full text-left text-[11px] px-1.5 py-1 rounded transition-colors ${
              !selectedCluster ? "bg-violet-50 text-violet-700 font-medium" : "text-zinc-500 hover:bg-zinc-50"
            }`}
          >
            Tous les clusters
          </button>
          {clusterStats.map(([cluster, { count, category }]) => (
            <button
              key={cluster}
              onClick={() => setSelectedCluster(selectedCluster === cluster ? null : cluster)}
              className={`w-full text-left flex items-center gap-1.5 text-[11px] px-1.5 py-1 rounded transition-colors ${
                selectedCluster === cluster ? "bg-violet-50 text-violet-700 font-medium" : "text-zinc-600 hover:bg-zinc-50"
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: col(category) }} />
              <span className="truncate">{cluster}</span>
              <span className="text-zinc-300 ml-auto text-[10px]">{count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Main graph area */}
      <div className="flex-1 flex flex-col">
        {/* Toolbar */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-zinc-100 bg-white text-[11px]">
          <span className="text-zinc-400">{graphData.nodes.length} noeuds</span>
          <span className="text-zinc-300">/</span>
          <span className="text-zinc-400">{graphData.links.length} liens</span>

          <div className="flex-1" />

          {/* Cross-category toggle */}
          <button
            onClick={() => setShowCrossCategory(!showCrossCategory)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] transition-colors ${
              showCrossCategory ? "bg-violet-50 text-violet-700" : "bg-zinc-100 text-zinc-400"
            }`}
          >
            <Layers size={12} />
            Cross-domaine
          </button>

          {/* Threshold slider */}
          <span className="text-zinc-500">Densité</span>
          <input
            type="range" min="0.35" max="0.85" step="0.02" value={threshold}
            onChange={(e) => setThreshold(parseFloat(e.target.value))}
            className="w-24 accent-violet-600 h-1"
          />
          <span className="text-zinc-400 w-8 text-right">{threshold.toFixed(2)}</span>

          <div className="w-px h-4 bg-zinc-200" />

          {/* Zoom controls */}
          <button onClick={handleZoomIn} className="p-1 text-zinc-400 hover:text-zinc-700 rounded hover:bg-zinc-100 transition-colors">
            <ZoomIn size={14} />
          </button>
          <button onClick={handleZoomOut} className="p-1 text-zinc-400 hover:text-zinc-700 rounded hover:bg-zinc-100 transition-colors">
            <ZoomOut size={14} />
          </button>
          <button onClick={handleFit} className="p-1 text-zinc-400 hover:text-zinc-700 rounded hover:bg-zinc-100 transition-colors">
            <Maximize2 size={14} />
          </button>
        </div>

        {/* Graph canvas */}
        <div ref={containerRef} className="flex-1 relative bg-zinc-50">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex flex-col items-center gap-2">
                <div className="w-5 h-5 border-2 border-zinc-200 border-t-violet-600 rounded-full animate-spin" />
                <span className="text-[11px] text-zinc-400">Construction du graphe de pensée...</span>
              </div>
            </div>
          ) : (
            <ForceGraph2D
              ref={fgRef}
              width={dims.w - 208}
              height={dims.h - 37}
              graphData={graphData}
              nodeRelSize={3}
              nodeVal={(node: any) => 1 + Math.sqrt(node.connections || 0) * 0.5}
              backgroundColor="#FAFAFB"
              onNodeClick={(node: any) => pushFocus({ type: "tweet", id: node.id })}
              onNodeHover={(node: any) => setHovered(node)}
              onBackgroundClick={() => setSelectedCluster(null)}
              cooldownTicks={0}
              warmupTicks={200}
              linkWidth={(link: any) => {
                if (!hovered) return 0.2;
                const src = typeof link.source === "string" ? link.source : link.source.id;
                const tgt = typeof link.target === "string" ? link.target : link.target.id;
                return hoveredLinkKeys.has(`${src}|${tgt}`) ? 2 : 0.03;
              }}
              linkColor={(link: any) => {
                if (!hovered) return "rgba(0,0,0,0.03)";
                const src = typeof link.source === "string" ? link.source : link.source.id;
                const tgt = typeof link.target === "string" ? link.target : link.target.id;
                if (hoveredLinkKeys.has(`${src}|${tgt}`)) {
                  const [r, g, b] = rgb(col(hovered.category));
                  return `rgba(${r},${g},${b},0.6)`;
                }
                return "rgba(0,0,0,0.005)";
              }}
              onRenderFramePost={(ctx: CanvasRenderingContext2D, globalScale: number) => {
                const now = Date.now();
                const dayAgo = now - 86400_000;
                const threeDaysAgo = now - 3 * 86400_000;

                // Draw cluster regions with trend detection
                const clusterCentroids = new Map<string, { cx: number; cy: number; count: number; cat: string; recent: number; older: number }>();
                graphData.nodes.forEach((n) => {
                  const key = n.cluster || n.category || "other";
                  const c = clusterCentroids.get(key) || { cx: 0, cy: 0, count: 0, cat: n.category || "other", recent: 0, older: 0 };
                  c.cx += n.x || 0; c.cy += n.y || 0; c.count += 1;
                  if (n.created_at) {
                    const ts = new Date(n.created_at).getTime();
                    if (ts > dayAgo) c.recent++;
                    else if (ts > threeDaysAgo) c.older++;
                  }
                  clusterCentroids.set(key, c);
                });

                clusterCentroids.forEach((c, clusterName) => {
                  if (c.count < 2) return;
                  c.cx /= c.count; c.cy /= c.count;
                  const [cr, cg, cb] = rgb(col(c.cat));

                  // Trend: compare last 24h vs previous 48h
                  const olderPerDay = c.older / 2;
                  const trend: "rising" | "stable" | "declining" =
                    c.recent >= 2 && c.recent > olderPerDay * 1.5 ? "rising"
                    : olderPerDay >= 2 && c.recent < olderPerDay * 0.5 ? "declining"
                    : "stable";

                  // Compute radius
                  let maxDist = 0;
                  graphData.nodes.forEach((n) => {
                    const key = n.cluster || n.category || "other";
                    if (key === clusterName) {
                      const dist = Math.sqrt(((n.x || 0) - c.cx) ** 2 + ((n.y || 0) - c.cy) ** 2);
                      if (dist > maxDist) maxDist = dist;
                    }
                  });
                  const r = maxDist + 30;

                  // Soft glow — stronger for rising clusters
                  const glowAlpha = trend === "rising" ? 0.06 : 0.03;
                  const grad = ctx.createRadialGradient(c.cx, c.cy, 0, c.cx, c.cy, r);
                  const isSelected = selectedCluster === clusterName;
                  grad.addColorStop(0, `rgba(${cr},${cg},${cb},${isSelected ? 0.08 : glowAlpha})`);
                  grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
                  ctx.beginPath(); ctx.arc(c.cx, c.cy, r, 0, 2 * Math.PI); ctx.fillStyle = grad; ctx.fill();

                  // Cluster label with trend indicator
                  if (c.count >= 3 || globalScale > 1.5) {
                    const fs = Math.max(8, Math.min(16, 14 / globalScale));
                    const labelY = c.cy - r - 4 / globalScale;

                    // Trend arrow before cluster name
                    const trendSymbol = trend === "rising" ? "▲ " : trend === "declining" ? "▽ " : "";
                    const labelText = `${trendSymbol}${clusterName}`;

                    ctx.font = `500 ${fs}px -apple-system, sans-serif`;
                    ctx.textAlign = "center";
                    const labelAlpha = isSelected ? 0.7 : trend === "rising" ? 0.55 : 0.35;
                    ctx.fillStyle = trend === "rising"
                      ? `rgba(5,150,105,${labelAlpha})`
                      : `rgba(${cr},${cg},${cb},${labelAlpha})`;
                    ctx.fillText(labelText, c.cx, labelY);

                    // Count
                    ctx.font = `400 ${fs * 0.7}px -apple-system, sans-serif`;
                    ctx.fillStyle = `rgba(${cr},${cg},${cb},0.2)`;
                    ctx.fillText(`${c.count}`, c.cx, labelY + fs * 0.6 / globalScale);
                  }
                });
              }}
              nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
                const color = col(node.category);
                const [r, g, b] = rgb(color);
                const conns = node.connections || 0;
                const rad = 2 + Math.sqrt(conns + 1) * 0.8;
                const isHov = hovered?.id === node.id;
                const isNbr = hoveredNeighbors.has(node.id);
                const dim = hovered && !isNbr;
                const alpha = dim ? 0.08 : isHov ? 1 : isNbr ? 0.9 : 0.65;

                // Glow for important or hovered nodes
                if ((conns > 5 || isHov) && !dim) {
                  const gr = rad + (isHov ? 12 : 6);
                  const gradient = ctx.createRadialGradient(node.x, node.y, rad, node.x, node.y, gr);
                  gradient.addColorStop(0, `rgba(${r},${g},${b},${isHov ? 0.25 : 0.08})`);
                  gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
                  ctx.beginPath(); ctx.arc(node.x, node.y, gr, 0, 2 * Math.PI); ctx.fillStyle = gradient; ctx.fill();
                }

                // Main node circle
                ctx.beginPath(); ctx.arc(node.x, node.y, rad, 0, 2 * Math.PI);
                ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`; ctx.fill();
                if (isHov) {
                  ctx.strokeStyle = `rgba(${r},${g},${b},0.8)`; ctx.lineWidth = 1.5; ctx.stroke();
                }

                // Labels
                const showLabel = isHov || isNbr || globalScale > 2.5 || conns > 10;
                if (showLabel && !dim) {
                  const fs = isHov ? 6 : Math.max(3, 8 / globalScale);
                  ctx.font = `${isHov ? "600" : "400"} ${fs}px -apple-system, sans-serif`;
                  ctx.textAlign = "center"; ctx.textBaseline = "top";

                  if (isHov) {
                    // Show cluster + author on hover
                    ctx.fillStyle = `rgba(${r},${g},${b},0.9)`;
                    ctx.fillText(node.cluster || node.category || "", node.x, node.y + rad + 2);
                    ctx.font = `400 ${fs * 0.75}px -apple-system, sans-serif`;
                    ctx.fillStyle = `rgba(24,24,27,0.6)`;
                    ctx.fillText(`@${node.author_handle}`, node.x, node.y + rad + 2 + fs * 1.2);
                  } else {
                    ctx.fillStyle = `rgba(24,24,27,${isNbr ? 0.5 : 0.25})`;
                    ctx.fillText(`@${node.author_handle}`, node.x, node.y + rad + 1.5);
                  }
                }
              }}
              nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
                ctx.beginPath(); ctx.arc(node.x, node.y, 8, 0, 2 * Math.PI); ctx.fillStyle = color; ctx.fill();
              }}
            />
          )}

          {/* Hover tooltip */}
          {hovered && (
            <div className="absolute top-3 left-3 bg-white border border-zinc-200 rounded-lg shadow-sm p-3 max-w-xs pointer-events-none z-10">
              <div className="flex items-center gap-2 mb-1">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: col(hovered.category) }} />
                <span className="text-[12px] font-semibold text-zinc-900">{hovered.cluster || hovered.category}</span>
              </div>
              <p className="text-[11px] text-zinc-500 mb-1">@{hovered.author_handle}</p>
              <p className="text-[11px] text-zinc-700 line-clamp-3">{hovered.summary || hovered.content_preview}</p>
              {hovered.topics.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {hovered.topics.slice(0, 4).map((t) => (
                    <span key={t} className="text-[9px] text-zinc-400 bg-zinc-50 px-1 py-0.5 rounded">{t}</span>
                  ))}
                </div>
              )}
              <p className="text-[9px] text-zinc-300 mt-1">{hoveredNeighbors.size - 1} connexions</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
