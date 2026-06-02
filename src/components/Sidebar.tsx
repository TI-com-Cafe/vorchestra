import React from "react";
import { Plus, Folder, RefreshCcw, Trash2, Sparkles, Star, HardDrive, Package2 } from "lucide-react";
import { THEME_OPTIONS } from "../constants/ui";
import { ThemeMode } from "../types";
import { cn } from "../utils/cn";

interface SidebarProps {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  workspaces: { path: string, is_default: boolean }[];
  activeWorkspace: string;
  availableManagers: { uv: boolean; poetry: boolean; pdm: boolean; conda: boolean; pixi: boolean };
  setActiveWorkspace: (ws: string) => void;
  addWorkspace: () => void;
  scanWorkspace: (ws: string) => void;
  removeWorkspace: (ws: string) => void;
  openHygiene: () => void;
  openCache: () => void;
  openImportBundle: () => void;
  setDefaultWorkspace: (ws: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  theme, setTheme, workspaces, activeWorkspace, availableManagers, setActiveWorkspace, addWorkspace, scanWorkspace, removeWorkspace, openHygiene, openCache, openImportBundle, setDefaultWorkspace
}) => {
  const runtimeBadges = [
    { label: "uv", enabled: availableManagers.uv, managed: true },
    { label: "poetry", enabled: availableManagers.poetry, managed: false },
    { label: "pdm", enabled: availableManagers.pdm, managed: false },
    { label: "conda", enabled: availableManagers.conda, managed: false },
    { label: "pixi", enabled: availableManagers.pixi, managed: false }
  ];

  return (
    <aside className="vo-surface w-64 border-r flex flex-col shrink-0 font-bold select-none text-slate-900 dark:text-white">
      <div className="vo-panel p-6 border-b flex items-center gap-3">
        <img src="/vorchestra-icon.png" alt="" className="w-8 h-8 dark:invert dark:opacity-90" />
        <h1 className="text-sm uppercase tracking-tight">VOrchestra</h1>
      </div>
      <nav className="flex-1 px-4 py-6 space-y-6 overflow-y-auto text-[11px]">
        <div className="space-y-2">
          <p className="text-slate-400 uppercase tracking-widest ml-2">Orchestrator</p>
          <button
            onClick={openHygiene}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-slate-500 hover:bg-green-50 dark:hover:bg-green-900/20 hover:text-green-600 transition-all border border-transparent hover:border-green-200"
          >
            <Sparkles size={14} className="text-green-500"/>
            <span>Global Hygiene</span>
          </button>
          <button
            onClick={openCache}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-slate-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-600 transition-all border border-transparent hover:border-blue-200"
          >
            <HardDrive size={14} className="text-blue-500"/>
            <span>Cache Hygiene</span>
          </button>
          <button
            onClick={openImportBundle}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-slate-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 hover:text-amber-600 transition-all border border-transparent hover:border-amber-200"
          >
            <Package2 size={14} className="text-amber-500"/>
            <span>Import Bundle</span>
          </button>
        </div>

        <div className="space-y-2">
          <p className="text-slate-400 uppercase tracking-widest ml-2">Runtime Inventory</p>
          <div className="grid grid-cols-2 gap-1.5">
            {runtimeBadges.map(runtime => (
              <div
                key={runtime.label}
                title={runtime.managed ? "Managed by VOrchestra" : "Detected read-only"}
                className={`px-2 py-1 rounded-lg border text-[9px] font-black uppercase tracking-wider ${
                  runtime.enabled
                    ? runtime.managed
                      ? "bg-blue-50 border-blue-100 text-blue-600 dark:bg-blue-950/30 dark:border-blue-900/40 dark:text-blue-300"
                      : "bg-slate-50 border-slate-200 text-slate-500 dark:bg-slate-950/30 dark:border-slate-800 dark:text-slate-300"
                    : "bg-slate-50/40 border-slate-100 text-slate-300 dark:bg-slate-950/10 dark:border-slate-800 dark:text-slate-600"
                }`}
              >
                {runtime.label}
              </div>
            ))}
          </div>
          <p className="px-2 text-[9px] leading-relaxed text-slate-400">
            Conda and Pixi are inventory-only for now; VOrchestra will not mutate them.
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-slate-400 uppercase tracking-widest ml-2">Theme</p>
          <div className="vo-subpanel flex p-1 rounded-xl border">
            {THEME_OPTIONS.map(({ mode, icon: IconComponent }) => (
              <button key={mode} onClick={() => setTheme(mode)} className={`flex-1 flex justify-center py-1.5 rounded-lg transition-all ${theme === mode ? "bg-white dark:bg-slate-700 text-blue-600 shadow-sm" : "text-slate-400"}`}>
                <IconComponent size={14}/>
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between px-2">
            <p className="text-slate-400 uppercase tracking-widest">Workspaces</p>
            <button onClick={addWorkspace} className="vo-icon-button text-blue-600 hover:text-blue-700 transition-colors" title="Add workspace"><Plus size={16}/></button>
          </div>
          <div className="space-y-1.5 pt-2">
            {workspaces.filter(ws => ws && ws.path).length === 0 ? (
              <div className="vo-subpanel rounded-2xl border border-dashed px-3 py-4 text-center">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">No workspace</p>
                <p className="mt-1 text-[9px] leading-relaxed text-slate-400">Add a project folder to scan environments.</p>
              </div>
            ) : workspaces.filter(ws => ws && ws.path).map(ws => (
              <div key={ws.path} onClick={() => setActiveWorkspace(ws.path)} className={cn("group flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer border transition-all", activeWorkspace === ws.path ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 border-blue-200 dark:border-blue-800" : "bg-transparent border-transparent text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800/60")}>
                <div className="flex items-center gap-2 truncate flex-1 mr-2">
                  <Folder size={14} className={activeWorkspace === ws.path ? "text-blue-600" : "text-slate-400"} />
                  <span className="truncate text-[10px]">{String(ws.path).split(/[\/\\]/).pop() || ws.path}</span>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button 
                    onClick={(e) => { e.stopPropagation(); setDefaultWorkspace(ws.path); }} 
                    className={`vo-icon-button min-w-8 min-h-8 rounded-full transition-all shadow-sm ${ws.is_default ? "text-yellow-500 border-yellow-200" : "text-slate-300 hover:text-yellow-500"}`}
                    title={ws.is_default ? "Default Workspace" : "Set as Default"}
                  >
                    <Star size={10} fill={ws.is_default ? "currentColor" : "none"}/>
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); scanWorkspace(ws.path); }} className="vo-icon-button min-w-8 min-h-8 rounded-full text-slate-400 hover:text-blue-600 transition-all shadow-sm" title="Refresh"><RefreshCcw size={10}/></button>
                  <button onClick={(e) => { e.stopPropagation(); removeWorkspace(ws.path); }} className="vo-icon-button min-w-8 min-h-8 rounded-full text-slate-400 hover:text-red-600 transition-all shadow-sm" title="Remove"><Trash2 size={10}/></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </nav>
    </aside>
  );
};
