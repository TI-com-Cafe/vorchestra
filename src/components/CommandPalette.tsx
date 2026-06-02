import React, { useState, useEffect, useRef } from "react";
import { Search, Command, Terminal, Package, ArrowRight, Wrench } from "lucide-react";
import { StudioTabId, VenvInfo } from "../types";
import { assessEnvironmentHealth } from "../utils/envHealth";
import { cn } from "../utils/cn";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  venvCache: Record<string, VenvInfo[]>;
  onSelectVenv: (venv: VenvInfo, tab?: StudioTabId | "deploy") => void;
}

const matchesQuery = (haystack: string, query: string): boolean => {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map(token => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every(token => haystack.includes(token));
};

const tabFromQuery = (query: string): StudioTabId | "deploy" | undefined => {
  const normalized = query.toLowerCase();
  if (/\b(repair|fix|doctor|stale|missing)\b/.test(normalized)) return "repair";
  if (/\b(package|packages|dependency|dependencies|tree|graph)\b/.test(normalized)) return "packages";
  if (/\b(security|audit|diagnostic|diagnostics|license|sbom|vulnerability|vulnerabilities)\b/.test(normalized)) return "diagnostics";
  if (/\b(lock|lockfile|drift|freeze)\b/.test(normalized)) return "lock";
  if (/\b(config|env|environment variable|dotenv)\b/.test(normalized)) return "config";
  if (/\b(automation|test|tests|lint|ruff|pytest|script|scripts)\b/.test(normalized)) return "automation";
  if (/\b(deploy|docker|vscode|jupyter|pre-commit|precommit)\b/.test(normalized)) return "deploy";
  return undefined;
};

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose, venvCache, onSelectVenv }) => {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const allVenvs = Object.values(venvCache).flat();
  const openResult = (venv: VenvInfo) => {
    const health = assessEnvironmentHealth(venv);
    const requestedTab = tabFromQuery(query);
    const tab = requestedTab
      ?? (health.primaryAction === "repair" || health.primaryAction === "delete_stale"
      ? "repair"
      : health.primaryAction === "sync"
        ? "repair"
        : undefined);
    onSelectVenv(venv, tab);
    onClose();
  };
  
  const results = allVenvs.filter(v => {
    const health = assessEnvironmentHealth(v);
    const actionTerms = {
      open_studio: "open inspect studio",
      sync: "sync refresh metadata external changes",
      repair: "repair fix doctor issue",
      delete_stale: "delete stale remove stale entry remove missing path"
    }[health.primaryAction];
    const haystack = [
      v.name,
      v.path,
      v.version,
      v.status,
      v.manager_type,
      health.label,
      "packages dependency tree graph diagnostics security audit license sbom lock lockfile drift config env automation tests lint deploy docker vscode jupyter precommit pre-commit",
      actionTerms,
      ...health.signals.map(signal => signal.label),
      v.issue ?? ""
    ].join(" ").toLowerCase();
    return matchesQuery(haystack, query);
  }
  ).slice(0, 8); // Limit to top 8 for UI cleanliness

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeys = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % Math.max(1, results.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + results.length) % Math.max(1, results.length));
      } else if (e.key === "Enter" && results[selectedIndex]) {
        openResult(results[selectedIndex]);
      } else if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeys);
    return () => window.removeEventListener("keydown", handleKeys);
  }, [isOpen, results, selectedIndex]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4 animate-in fade-in duration-200">
      <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" onClick={onClose} />
      
      <div className="vo-surface w-full max-w-2xl rounded-[2.5rem] border shadow-2xl overflow-hidden relative animate-in zoom-in-95 duration-200">
        <div className="vo-panel flex items-center px-6 py-5 border-b">
          <Search size={20} className="text-blue-600 mr-4"/>
          <input 
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search environments, paths or packages..."
            className="flex-1 bg-transparent border-none outline-none text-sm font-bold text-slate-800 dark:text-white placeholder:text-slate-400"
          />
          <div className="vo-subpanel flex items-center gap-1 px-2 py-1 rounded-lg border">
            <span className="text-[10px] font-black text-slate-400">ESC</span>
          </div>
        </div>

        <div className="p-4 max-h-[400px] overflow-y-auto scrollbar-thin">
          {results.length > 0 ? (
            <div className="space-y-1">
              <p className="px-4 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">Environments ({results.length})</p>
              {results.map((v, i) => (
                <div
                  key={v.path}
                  onClick={() => openResult(v)}
                  onMouseEnter={() => setSelectedIndex(i)}
                  className={`
                    flex items-center justify-between px-4 py-3 rounded-2xl cursor-pointer transition-all border
                    ${selectedIndex === i 
                      ? "bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/20 translate-x-1" 
                      : "bg-transparent border-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50"}
                  `}
                >
                  <div className="flex items-center gap-4 flex-1 truncate">
                    <div className={`p-2 rounded-xl ${selectedIndex === i ? "bg-white/20" : "vo-subpanel"}`}>
                      <Terminal size={16} className={selectedIndex === i ? "text-white" : "text-blue-600"}/>
                    </div>
                    <div className="flex flex-col truncate">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-black text-xs truncate">{v.name}</span>
                        <EnvBadge venv={v} active={selectedIndex === i} />
                      </div>
                      <span className={`text-[9px] font-mono truncate opacity-70 ${selectedIndex === i ? "text-blue-100" : ""}`}>
                        {v.path}
                      </span>
                    </div>
                  </div>
                  {selectedIndex === i && (
                    <div className="flex items-center gap-2 animate-in slide-in-from-left-2">
                      {assessEnvironmentHealth(v).tone !== "green" && (
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            openResult(v);
                          }}
                          className="flex items-center gap-1 rounded-lg bg-white/20 px-2 py-1 text-[9px] font-black uppercase"
                        >
                          <Wrench size={11} /> Suggested
                        </button>
                      )}
                      <span className="text-[9px] font-black uppercase">
                        {assessEnvironmentHealth(v).tone === "green" ? "Open Studio" : "Open Recommended"}
                      </span>
                      <ArrowRight size={14}/>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-4">
              <div className="vo-subpanel p-4 rounded-full border-2 border-dashed">
                <Package size={32} className="opacity-20"/>
              </div>
              <p className="text-xs font-bold uppercase tracking-widest">No environments found</p>
              <p className="max-w-sm text-center text-[10px] font-bold leading-relaxed text-slate-400">
                Try action terms like repair, sync, remove stale, missing path, uv, pip or a project folder name.
              </p>
            </div>
          )}
        </div>

        <div className="vo-panel p-4 border-t flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <div className="vo-surface p-1 rounded border"><Command size={10} className="text-slate-400"/></div>
              <span className="text-[9px] font-bold text-slate-400 uppercase">Navigation</span>
            </div>
          </div>
          <p className="text-[9px] font-black text-blue-600/50 uppercase tracking-tighter">VOrchestra Discovery</p>
        </div>
      </div>
    </div>
  );
};

const EnvBadge: React.FC<{ venv: VenvInfo; active: boolean }> = ({ venv, active }) => {
  const health = assessEnvironmentHealth(venv);
  return (
    <span className={cn(
      "shrink-0 rounded-full px-2 py-0.5 text-[8px] font-black uppercase tracking-wider",
      active && "bg-white/20 text-white",
      !active && health.tone === "green" && "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-300",
      !active && health.tone === "amber" && "bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-300",
      !active && health.tone === "red" && "bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-300"
    )}>
      {venv.manager_type} · {health.label}
    </span>
  );
};
