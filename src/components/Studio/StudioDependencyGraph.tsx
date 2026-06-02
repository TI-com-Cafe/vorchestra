import React, { useEffect, useState } from 'react';
import ReactFlow, { 
  Background, 
  Controls, 
  Node, 
  Edge, 
  MarkerType,
  useNodesState,
  useEdgesState,
  ConnectionLineType
} from 'reactflow';
import 'reactflow/dist/style.css';
import { VenvInfo } from '../../types';
import { packageService } from '../../services/packageManager';
import { Loader2, Layers, RefreshCcw, Search } from 'lucide-react';

interface StudioDependencyGraphProps {
  venv: VenvInfo;
}

const MAX_GRAPH_NODES = 600;
const GRAPH_NODE_WIDTH = 150;
const GRAPH_X_GAP = 190;
const GRAPH_Y_GAP = 150;
const GRAPH_ROOT_GAP = 110;

const graphPackageLabel = (node: any): string =>
  `${node.package_name || node.name || ""} ${node.installed_version || node.version || ""}`.trim();

const flattenGraphData = (nodes: any[]): any[] => {
  const out: any[] = [];
  const visit = (node: any) => {
    const item = node.package || node;
    out.push(item);
    (item.dependencies || []).forEach(visit);
  };
  nodes.forEach(visit);
  return out;
};

export const summarizeDependencyGraph = (fullData: any[], visibleData: any[]) => {
  const fullNodes = flattenGraphData(fullData);
  const visibleNodes = flattenGraphData(visibleData);
  const hubs = [...fullNodes]
    .map((node) => ({
      name: node.package_name || node.name || "unknown",
      dependencyCount: (node.dependencies || []).length
    }))
    .filter((node) => node.dependencyCount > 0)
    .sort((a, b) => b.dependencyCount - a.dependencyCount || a.name.localeCompare(b.name))
    .slice(0, 3);

  return {
    roots: fullData.length,
    totalNodes: fullNodes.length,
    visibleNodes: visibleNodes.length,
    hiddenByFilter: Math.max(0, fullNodes.length - visibleNodes.length),
    hubs
  };
};

export const filterGraphDataForQuery = (nodes: any[], query: string): any[] => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return nodes;
  return nodes
    .map((node) => {
      const item = node.package || node;
      const dependencies = item.dependencies || [];
      const dependencyMatches = filterGraphDataForQuery(dependencies, normalized);
      const selfMatches = graphPackageLabel(item).toLowerCase().includes(normalized);
      if (selfMatches) return node;
      if (dependencyMatches.length === 0) return null;
      if (node.package) {
        return { ...node, package: { ...item, dependencies: dependencyMatches } };
      }
      return { ...item, dependencies: dependencyMatches };
    })
    .filter(Boolean);
};

type GraphLayoutNode = {
  id: string;
  name: string;
  version: string;
  level: number;
  x: number;
  y: number;
  parentId: string | null;
};

export const layoutDependencyGraph = (
  data: any[],
  depth: number,
  maxNodes = MAX_GRAPH_NODES
): { nodes: GraphLayoutNode[]; edges: { source: string; target: string; level: number }[]; truncated: boolean } => {
  const nodes: GraphLayoutNode[] = [];
  const edges: { source: string; target: string; level: number }[] = [];
  let leafCursor = 0;
  let truncated = false;

  const itemName = (item: any) => item.package_name || item.name || "unknown";
  const itemVersion = (item: any) => String(item.installed_version || item.version || "unknown");

  const layoutItem = (item: any, parentId: string | null, level: number, path: string): number => {
    if (level > depth) return leafCursor * GRAPH_X_GAP;
    if (nodes.length >= maxNodes) {
      truncated = true;
      return leafCursor * GRAPH_X_GAP;
    }

    const name = itemName(item);
    const version = itemVersion(item);
    const id = `${path}/${name.toLowerCase()}@${version.toLowerCase()}`;
    const dependencies = level < depth ? (item.dependencies || []) : [];
    const nodeIndex = nodes.length;

    nodes.push({
      id,
      name,
      version,
      level,
      x: 0,
      y: level * GRAPH_Y_GAP,
      parentId
    });

    if (parentId) {
      edges.push({ source: parentId, target: id, level });
    }

    const childCenters: number[] = [];
    dependencies.forEach((dependency: any, index: number) => {
      if (nodes.length >= maxNodes) {
        truncated = true;
        return;
      }
      childCenters.push(layoutItem(dependency, id, level + 1, `${id}#${index}`));
    });

    const x = childCenters.length > 0
      ? childCenters.reduce((sum, value) => sum + value, 0) / childCenters.length
      : leafCursor++ * GRAPH_X_GAP;
    nodes[nodeIndex].x = x;
    return x;
  };

  const nodeToItem = (node: any) => node.package || node;
  data.forEach((root, index) => {
    if (index > 0) {
      leafCursor += GRAPH_ROOT_GAP / GRAPH_X_GAP;
    }
    layoutItem(nodeToItem(root), null, 0, `root-${index}`);
  });

  return { nodes, edges, truncated };
};

export const StudioDependencyGraph: React.FC<StudioDependencyGraphProps> = ({ venv }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [loading, setLoading] = useState(true);
  const [maxDepth, setMaxDepth] = useState(1); // Default to shallow for performance
  const [fullData, setFullData] = useState<any[]>([]);
  const [graphWarning, setGraphWarning] = useState<string | null>(null);
  const [graphQuery, setGraphQuery] = useState("");
  const [graphSummary, setGraphSummary] = useState(() => summarizeDependencyGraph([], []));

  const buildGraph = (data: any[], depth: number, query = graphQuery) => {
    const filteredData = filterGraphDataForQuery(data, query);
    setGraphSummary(summarizeDependencyGraph(data, filteredData));
    const layout = layoutDependencyGraph(filteredData, depth);

    const newNodes: Node[] = layout.nodes.map((node) => ({
        id: node.id,
        data: { label: (
          <div className="flex flex-col items-center">
            <span className="font-black text-[9px] uppercase truncate w-full text-center" title={node.name}>{node.name}</span>
            <span className="text-[7px] font-mono opacity-60">{node.version}</span>
          </div>
        )},
        position: { x: node.x, y: node.y },
        style: {
          background: node.level === 0 ? '#2563eb' : (node.level === 1 ? '#3b82f6' : '#fff'),
          color: node.level === 0 || node.level === 1 ? '#fff' : '#1e293b',
          border: '1.5px solid #2563eb',
          borderRadius: '10px',
          padding: '6px',
          width: GRAPH_NODE_WIDTH,
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
        },
      }));

    const newEdges: Edge[] = layout.edges.map((edge) => ({
      id: `e-${edge.source}-${edge.target}`,
      source: edge.source,
      target: edge.target,
      type: ConnectionLineType.SmoothStep,
      animated: edge.level < 2,
      style: { stroke: '#3b82f6', strokeWidth: 1.5 },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6' },
    }));
    
    setNodes(newNodes);
    setEdges(newEdges);
    if (query.trim() && filteredData.length === 0) {
      setGraphWarning("No graph nodes match this search. Clear the filter or use Tree search for deeper inspection.");
    } else {
      setGraphWarning(layout.truncated
        ? `Graph capped at ${MAX_GRAPH_NODES} nodes to keep the UI responsive. Lower the depth or use Tree search for precise inspection.`
        : null
      );
    }
  };

  const fetchData = async (force = false) => {
    setLoading(true);
    try {
      const tree = await packageService.getDependencyTree(venv, { force });
      const data = Array.isArray(tree) ? tree : [tree];
      setFullData(data);
      buildGraph(data, maxDepth, graphQuery);
    } catch (err) {
      console.error("Graph Error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData(false);
  }, [venv.path, venv.manager_type]);

  useEffect(() => {
    if (fullData.length > 0) {
      buildGraph(fullData, maxDepth, graphQuery);
    }
  }, [maxDepth, graphQuery]);

  if (loading) {
    return (
      <div className="vo-surface h-[500px] flex flex-col items-center justify-center gap-4 text-slate-400 rounded-[2rem] border shadow-sm">
        <Loader2 size={32} className="animate-spin text-blue-600"/>
        <p className="text-xs font-black uppercase tracking-widest">Processing massive dataset...</p>
        <p className="max-w-sm text-center text-[10px] font-bold leading-relaxed text-slate-500 dark:text-slate-400">
          Graph rendering is capped for responsiveness. Use search or lower depth if the environment is large.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-500">
      <div className="vo-surface flex items-center justify-between px-4 py-3 rounded-2xl border">
        <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600 text-white rounded-lg"><Layers size={14}/></div>
            <p className="text-[10px] font-black uppercase tracking-widest">Scan Depth Control</p>
            <label className="vo-control flex items-center gap-2 rounded-xl border px-3 py-1.5">
              <Search size={12} className="text-slate-400" />
              <input
                value={graphQuery}
                onChange={(event) => setGraphQuery(event.target.value)}
                placeholder="Filter graph..."
                className="w-40 bg-transparent outline-none text-[10px] font-bold text-slate-700 dark:text-slate-200 placeholder:text-slate-400"
              />
            </label>
            <button
              onClick={() => fetchData(true)}
              className="flex items-center gap-1 text-[9px] font-black uppercase tracking-wide text-blue-600 hover:underline"
            >
              <RefreshCcw size={12} />
              Refresh
            </button>
        </div>
        <div className="vo-subpanel flex p-0.5 rounded-lg border">
            {[0, 1, 2, 3].map(d => (
                <button 
                    key={d} 
                    onClick={() => setMaxDepth(d)} 
                    className={`px-4 py-1 rounded-md text-[9px] font-black transition-all ${maxDepth === d ? "bg-white dark:bg-slate-700 text-blue-600 shadow-sm" : "text-slate-400 hover:text-slate-600"}`}
                >
                    {d === 0 ? "Top only" : `Level ${d}`}
                </button>
            ))}
            <button onClick={() => setMaxDepth(99)} className={`px-4 py-1 rounded-md text-[9px] font-black transition-all ${maxDepth === 99 ? "bg-red-600 text-white" : "text-slate-400"}`}>Full capped</button>
        </div>
      </div>

      {graphWarning && (
        <div className="rounded-2xl border border-amber-200 dark:border-amber-900/30 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
          {graphWarning}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <GraphMetric label="Roots" value={String(graphSummary.roots)} detail="Top-level packages" />
        <GraphMetric label="Visible nodes" value={String(graphSummary.visibleNodes)} detail={`${graphSummary.totalNodes} total`} />
        <GraphMetric label="Filtered out" value={String(graphSummary.hiddenByFilter)} detail={graphQuery.trim() ? "Hidden by search" : "No filter active"} />
        <GraphMetric
          label="Largest hub"
          value={graphSummary.hubs[0]?.name ?? "None"}
          detail={graphSummary.hubs[0] ? `${graphSummary.hubs[0].dependencyCount} direct deps` : "No dependency hubs"}
        />
      </div>

      {graphSummary.hubs.length > 0 && (
        <div className="vo-surface rounded-2xl border px-4 py-3">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Dependency hubs</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {graphSummary.hubs.map(hub => (
              <button
                key={hub.name}
                onClick={() => setGraphQuery(hub.name)}
                className="rounded-full bg-blue-50 dark:bg-blue-950/30 px-3 py-1 text-[10px] font-bold text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40"
                title={`Focus graph on ${hub.name}`}
              >
                {hub.name} · {hub.dependencyCount}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="vo-panel h-[600px] w-full rounded-[3rem] border overflow-hidden relative shadow-inner">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          fitView
          nodeOrigin={[0.5, 0]}
          fitViewOptions={{ padding: 0.25 }}
          maxZoom={1.5}
          minZoom={0.1}
          className="bg-transparent"
        >
          <Background color="#94a3b8" gap={20} size={1} />
          <Controls showInteractive={false} className="fill-blue-600" />
        </ReactFlow>

        <div className="absolute bottom-6 left-8 z-10 flex items-center gap-4">
            <div className="vo-surface px-4 py-2 rounded-full border shadow-sm flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse"></span>
                <span className="text-[9px] font-black uppercase text-slate-500">{nodes.length} nodes active</span>
            </div>
        </div>
      </div>
    </div>
  );
};

const GraphMetric: React.FC<{ label: string; value: string; detail: string }> = ({ label, value, detail }) => (
  <div className="vo-surface rounded-2xl border px-4 py-3">
    <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">{label}</p>
    <p className="mt-1 truncate text-sm font-black text-slate-900 dark:text-white">{value}</p>
    <p className="mt-0.5 text-[9px] font-bold text-slate-400">{detail}</p>
  </div>
);
