import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronRight, ChevronDown, Package, Layers, Info, Loader2, RefreshCcw, Search } from "lucide-react";
import { VenvInfo } from "../../types";
import { packageService, needsElevation, stripElevationPrefix } from "../../services/packageManager";

interface StudioDependencyTreeProps {
  venv: VenvInfo;
}

const packageLabel = (node: any): string => `${node.package_name || node.name || ""} ${node.installed_version || node.version || ""}`.trim();

const filterTree = (nodes: any[], query: string): any[] => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return nodes;
  return nodes
    .map((node) => {
      const deps = node.dependencies || [];
      const childMatches = filterTree(deps, normalized);
      const selfMatches = packageLabel(node).toLowerCase().includes(normalized);
      if (selfMatches) return node;
      if (childMatches.length > 0) return { ...node, dependencies: childMatches };
      return null;
    })
    .filter(Boolean);
};

const TreeItem: React.FC<{ node: any, depth: number, forceOpen?: boolean, collapseToken?: number }> = React.memo(({ node, depth, forceOpen = false, collapseToken = 0 }) => {
  const [isOpen, setIsOpen] = useState(false); // Lazy expansion
  const [visibleChildren, setVisibleChildren] = useState(80); // Incremental rendering for huge dependency sets
  const hasChildren = node.dependencies && node.dependencies.length > 0;
  
  const name = node.package_name || node.name;
  const version = node.installed_version || node.version;
  const deps = node.dependencies || [];

  useEffect(() => {
    if (forceOpen) setIsOpen(true);
    if (isOpen || forceOpen) setVisibleChildren(80);
  }, [forceOpen, isOpen, name]);

  useEffect(() => {
    if (!forceOpen) setIsOpen(false);
    setVisibleChildren(80);
  }, [collapseToken, forceOpen]);

  const nodeId = `${name}@${version}`;

  return (
    <div className="ml-4">
      <div 
        className={`flex items-center gap-2 py-1.5 px-2 rounded-xl transition-all ${hasChildren ? "cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20" : ""}`}
        onClick={() => hasChildren && setIsOpen(!isOpen)}
      >
        {hasChildren ? (
          isOpen ? <ChevronDown size={14} className="text-blue-500"/> : <ChevronRight size={14} className="text-slate-400"/>
        ) : <div className="w-[14px]"/>}
        
        <Package size={14} className={depth === 0 ? "text-blue-600" : "text-slate-400"}/>
        <span className={`text-xs font-bold ${depth === 0 ? "text-slate-900 dark:text-white" : "text-slate-600 dark:text-slate-400"}`}>
          {name}
        </span>
        <span className="text-[10px] font-mono text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded-md">
          {version}
        </span>
      </div>
      
      {/* PERFORMANCE CRITICAL: Only render children if isOpen is true */}
      {isOpen && hasChildren && (
        <div className="border-l-2 border-slate-100 dark:border-slate-800 ml-3.5 mt-1 animate-in slide-in-from-left-2 duration-200">
          {deps.slice(0, visibleChildren).map((dep: any, i: number) => (
            <TreeItem key={`${nodeId}::${dep.package_name || dep.name || "dep"}-${i}`} node={dep} depth={depth + 1} forceOpen={forceOpen} collapseToken={collapseToken} />
          ))}
          {deps.length > visibleChildren && (
            <div className="ml-6 py-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setVisibleChildren(prev => prev + 80);
                }}
                className="text-[10px] font-black uppercase tracking-wide text-blue-600 hover:underline"
              >
                Load more ({deps.length - visibleChildren} remaining)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export const StudioDependencyTree: React.FC<StudioDependencyTreeProps> = ({ venv }) => {
  const [tree, setTree] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visibleRoots, setVisibleRoots] = useState(120);
  const [query, setQuery] = useState("");
  const [collapseToken, setCollapseToken] = useState(0);
  const [treeProgress, setTreeProgress] = useState<string | null>(null);
  const [installingTool, setInstallingTool] = useState(false);
  const [installingElevated, setInstallingElevated] = useState(false);
  const [openingTerminal, setOpeningTerminal] = useState(false);
  const [elevationRequired, setElevationRequired] = useState(false);
  const showMissingToolHelp =
    venv.manager_type === "pip" &&
    /pipdeptree not found|no module named pipdeptree|missing dependency tree tool/i.test(error || "");
  const isWindows = typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent);
  const pythonPath = isWindows ? `${venv.path}\\Scripts\\python.exe` : `${venv.path}/bin/python`;
  const pipdeptreeInstallCommand = venv.manager_type === "uv"
    ? `uv pip install --python "${pythonPath}" pipdeptree`
    : "pip install pipdeptree";

  const fetchTree = async (force = false) => {
    setLoading(true);
    setError(null);
    setTreeProgress("Starting dependency analysis...");
    try {
      if (!force) {
        const prereq = await packageService.checkDependencyTreePrereq(venv);
        if (!prereq.ok) {
          setError(prereq.message || "Dependency tree tool is not available in this environment.");
          return;
        }
      }
      const data = await packageService.getDependencyTree(venv, {
        force,
        onUpdate: (snapshot) => {
          if (!snapshot.message) return;
          const pct = typeof snapshot.progress === "number"
            ? ` ${Math.round(snapshot.progress * 100)}%`
            : "";
          setTreeProgress(`${snapshot.message}${pct}`);
        }
      });
      setTree(Array.isArray(data) ? data : [data]);
      setVisibleRoots(120);
    } catch (err: any) {
      setError(err.toString());
    } finally {
      setLoading(false);
      setTreeProgress(null);
    }
  };

  const cancelTreeLoad = async () => {
    setTreeProgress("Cancelling dependency analysis...");
    try {
      await packageService.cancelDependencyTree(venv);
    } catch (err: any) {
      setError(err?.toString?.() || "Failed to cancel dependency analysis.");
    }
  };

  useEffect(() => {
    fetchTree(false);
  }, [venv.path, venv.manager_type]);

  if (loading) {
    return (
      <div className="vo-surface mx-auto flex max-w-xl flex-col items-center justify-center rounded-[2rem] border px-8 py-16 gap-4 text-slate-400 shadow-sm">
        <Loader2 size={32} className="animate-spin text-blue-600"/>
        <p className="text-xs font-black uppercase tracking-widest">Building tree hierarchy...</p>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest animate-pulse">
          {treeProgress || "Reading site-packages..."}
        </p>
        <p className="max-w-sm text-center text-[10px] font-bold leading-relaxed text-slate-500 dark:text-slate-400">
          Dependency analysis can take longer on large environments. Stop it before deleting or recreating this venv.
        </p>
        <button
          onClick={cancelTreeLoad}
          className="vo-secondary-action px-3 py-1.5 rounded-lg text-red-700 dark:text-red-200 text-[10px] font-black uppercase"
        >
          Stop Job
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-xl mx-auto p-8 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-3xl text-center shadow-sm">
        <Layers size={48} className="mx-auto text-red-400 mb-4 opacity-50"/>
        <h3 className="text-sm font-black text-red-600 uppercase mb-2">Analysis Failed</h3>
        <p className="text-xs text-red-500 mb-6 font-medium">{error}</p>
        {showMissingToolHelp && (
          <div className="vo-surface p-4 rounded-2xl text-left border shadow-sm">
            <p className="text-[10px] font-bold text-slate-500 uppercase mb-2 flex items-center gap-2"><Info size={12}/> Missing Tool:</p>
            <code className="vo-subpanel text-[10px] font-mono text-blue-600 dark:text-blue-400 block p-2 rounded-lg">
              pip install pipdeptree
            </code>
            <div className="mt-4 flex gap-2">
              <button
                onClick={async () => {
                  setInstallingTool(true);
                  setElevationRequired(false);
                  try {
                    await packageService.install(venv, "pipdeptree");
                    await fetchTree(true);
                  } catch (installErr: any) {
                    if (needsElevation(installErr)) {
                      setElevationRequired(true);
                      setError("Permission denied. This package needs to be installed with elevated privileges.");
                    } else {
                      setError(installErr?.toString?.() || "Failed to install pipdeptree.");
                    }
                  } finally {
                    setInstallingTool(false);
                  }
                }}
                disabled={installingTool || openingTerminal || installingElevated}
                className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-[10px] font-black uppercase disabled:opacity-50"
              >
                {installingTool ? "Installing..." : "Install Now"}
              </button>
              {elevationRequired && (
                <button
                  onClick={async () => {
                    setInstallingElevated(true);
                    try {
                      await packageService.installElevated(venv, "pipdeptree");
                      setElevationRequired(false);
                      await fetchTree(true);
                    } catch (elevErr: any) {
                      setError(stripElevationPrefix(elevErr) || "Elevated install failed.");
                    } finally {
                      setInstallingElevated(false);
                    }
                  }}
                  disabled={installingElevated || installingTool || openingTerminal}
                  className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-[10px] font-black uppercase disabled:opacity-50"
                  title={isWindows ? "Triggers a UAC prompt" : "Opens a terminal with sudo"}
                >
                  {installingElevated
                    ? (isWindows ? "Waiting for UAC..." : "Opening sudo terminal...")
                    : (isWindows ? "Retry as Administrator" : "Retry with sudo")}
                </button>
              )}
              <button
                onClick={async () => {
                  setOpeningTerminal(true);
                  try {
                    await invoke("open_terminal_with_venv_command", { path: venv.path, command: pipdeptreeInstallCommand });
                  } catch (openErr: any) {
                    setError(openErr?.toString?.() || "Failed to open terminal with command.");
                  } finally {
                    setOpeningTerminal(false);
                  }
                }}
                disabled={openingTerminal || installingTool || installingElevated}
                className="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-[10px] font-black uppercase disabled:opacity-50"
              >
                {openingTerminal ? "Opening..." : "Open Install Command"}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  const displayedTree = filterTree(tree, query);
  const searching = query.trim().length > 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="vo-surface flex flex-col lg:flex-row lg:items-center justify-between gap-3 rounded-[1.5rem] border p-4">
        <h4 className="font-black text-sm uppercase tracking-widest flex items-center gap-2">
          <Layers size={18} className="text-blue-600"/> Hierarchical Inspector
        </h4>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <label className="vo-control flex items-center gap-2 rounded-xl border px-3 py-2">
            <Search size={13} className="text-slate-400" />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setVisibleRoots(120);
              }}
              placeholder="Search dependency tree..."
              className="w-56 bg-transparent outline-none text-[10px] font-bold text-slate-700 dark:text-slate-200 placeholder:text-slate-400"
            />
          </label>
          <p className="text-[9px] font-bold text-slate-400 uppercase">Click arrows to expand dependencies lazily</p>
          <button
            onClick={() => {
              setQuery("");
              setVisibleRoots(120);
              setCollapseToken(prev => prev + 1);
            }}
            className="flex items-center gap-1 text-[9px] font-black uppercase tracking-wide text-slate-500 hover:text-blue-600 hover:underline"
          >
            Collapse all
          </button>
          <button
            onClick={() => fetchTree(true)}
            className="flex items-center gap-1 text-[9px] font-black uppercase tracking-wide text-blue-600 hover:underline"
          >
            <RefreshCcw size={12} />
            Refresh
          </button>
        </div>
      </div>
      
      <div className="vo-surface border rounded-[2.5rem] p-8 shadow-sm">
        {displayedTree.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-xs font-black uppercase tracking-widest text-slate-400">No dependency nodes match this search</p>
            <p className="mt-2 text-[10px] font-bold text-slate-500 dark:text-slate-400">Clear the search or reduce the query to a package name fragment.</p>
          </div>
        ) : displayedTree.slice(0, visibleRoots).map((node, i) => (
          <TreeItem key={`${node.package_name || node.name || "root"}-${i}`} node={node} depth={0} forceOpen={searching} collapseToken={collapseToken} />
        ))}
        {displayedTree.length > visibleRoots && (
          <div className="ml-2 mt-4">
            <button
              onClick={() => setVisibleRoots(prev => prev + 120)}
              className="text-[10px] font-black uppercase tracking-wide text-blue-600 hover:underline"
            >
              Load more roots ({displayedTree.length - visibleRoots} remaining)
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
