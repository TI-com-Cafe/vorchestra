import { invoke } from "@tauri-apps/api/core";
import { Loader2 } from "lucide-react";
import { PYTHON_TEMPLATES } from "../constants/templates";
import { Template } from "../types";
import { cn } from "../utils/cn";

interface NewEnvironmentBarProps {
  newVenvName: string;
  setNewVenvName: (value: string) => void;
  selectedEngine: "pip" | "uv";
  setSelectedEngine: (engine: "pip" | "uv") => void;
  availableManagers: { uv: boolean; poetry: boolean; pdm: boolean; conda: boolean; pixi: boolean };
  selectedPython: string;
  setSelectedPython: (python: string) => void;
  systemPythons: string[];
  selectedTemplate: Template;
  setSelectedTemplate: (template: Template) => void;
  customTemplates: Template[];
  loading: boolean;
  buildJobId: string | null;
  statusText: string;
  onBuild: () => void;
  onFromProject: () => void;
  setUvInstallCmd: (cmd: string) => void;
  openUvInstall: () => void;
  openPythonInstall: () => void;
  setMessage: (message: string) => void;
}

export const NewEnvironmentBar: React.FC<NewEnvironmentBarProps> = ({
  newVenvName,
  setNewVenvName,
  selectedEngine,
  setSelectedEngine,
  availableManagers,
  selectedPython,
  setSelectedPython,
  systemPythons,
  selectedTemplate,
  setSelectedTemplate,
  customTemplates,
  loading,
  buildJobId,
  statusText,
  onBuild,
  onFromProject,
  setUvInstallCmd,
  openUvInstall,
  openPythonInstall,
  setMessage
}) => {
  const templates = [...PYTHON_TEMPLATES, ...customTemplates];
  const packageCount = selectedTemplate.pkgs.length;
  const buildPlan = `${selectedEngine.toUpperCase()} · ${packageCount} package${packageCount === 1 ? "" : "s"} · ${selectedTemplate.name}`;
  const readOnlyManagers = [
    availableManagers.conda ? "Conda" : null,
    availableManagers.pixi ? "Pixi" : null
  ].filter(Boolean).join(" / ");

  const requestUvInstall = async () => {
    try {
      setUvInstallCmd(await invoke<string>("uv_install_command"));
    } catch {
      setUvInstallCmd("");
    }
    openUvInstall();
  };

  const cancelBuild = async () => {
    if (!buildJobId) return;
    try {
      await invoke<boolean>("cancel_background_job", { jobId: buildJobId });
      setMessage("Cancelling build...");
    } catch (err) {
      setMessage(`Cancel failed: ${err}`);
    }
  };

  return (
    <div className="vo-panel px-8 py-3 border-b flex flex-col gap-2 shrink-0 select-none font-bold">
      <div className="flex items-center gap-3">
        <p className="text-[9px] font-black uppercase text-slate-400">New Env</p>
        <input value={newVenvName} onChange={(e) => setNewVenvName(e.target.value)} className="vo-control border rounded-md px-3 py-1 text-xs w-64 outline-none focus:border-blue-500" placeholder="Name..." />

        <div className="vo-subpanel flex p-0.5 rounded-lg border shadow-inner">
          <button onClick={() => setSelectedEngine("pip")} className={cn("px-2 py-0.5 rounded-md text-[9px] font-black transition-all", selectedEngine === "pip" ? "bg-white dark:bg-slate-700 text-blue-600 shadow-sm" : "text-slate-400")}>PIP</button>
          {availableManagers.uv ? (
            <button onClick={() => setSelectedEngine("uv")} className={cn("px-2 py-0.5 rounded-md text-[9px] font-black transition-all", selectedEngine === "uv" ? "bg-white dark:bg-slate-700 text-blue-600 shadow-sm" : "text-slate-400")}>UV</button>
          ) : (
            <button onClick={requestUvInstall} className="px-2 py-0.5 rounded-md text-[9px] font-black text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-all" title="Install uv for 10x faster package installs">+ UV</button>
          )}
        </div>

        <select value={selectedPython} onChange={(e) => setSelectedPython(e.target.value)} className="vo-control border rounded-md px-2 py-1 text-xs text-blue-600">{systemPythons.map(p => <option key={p.split('|')[0]} value={p.split('|')[0]}>{p.split('|')[1]}</option>)}</select>
        <button onClick={openPythonInstall} className="px-2 py-1 rounded-md text-[9px] font-black text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 border border-dashed border-blue-300 dark:border-blue-800 transition-all" title="Install another Python version via uv">+ Py</button>
        <select value={selectedTemplate.id} onChange={(e) => setSelectedTemplate(templates.find(t => t.id === e.target.value) || PYTHON_TEMPLATES[0])} className="vo-control border rounded-md px-2 py-1 text-xs">{templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <button onClick={onBuild} disabled={loading || !newVenvName} className="vo-primary-action px-4 py-1 rounded-md text-[10px] font-black uppercase shadow-sm active:scale-95 transition-all disabled:opacity-50">{loading ? <Loader2 size={10} className="animate-spin" /> : "Build"}</button>
        {buildJobId && (
          <button onClick={cancelBuild} className="px-3 py-1 rounded-md text-[10px] font-black uppercase bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-700 transition-all">
            Cancel
          </button>
        )}
        <button onClick={onFromProject} className="px-3 py-1 rounded-md text-[10px] font-black text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 border border-dashed border-blue-300 dark:border-blue-800 transition-all" title="Detect manifests in a folder and build a venv from them">From Project</button>
        {statusText && <p className="text-[9px] font-black text-blue-500 truncate ml-auto uppercase">{statusText}</p>}
      </div>
      <div className="ml-[52px] flex flex-wrap items-center gap-x-4 gap-y-1 text-[9px] text-slate-400">
        {selectedPython && <p className="font-mono truncate opacity-70">Binary: {selectedPython}</p>}
        <p className="font-black uppercase tracking-widest text-blue-500">Build plan: {buildPlan}</p>
        {readOnlyManagers && (
          <p className="font-black uppercase tracking-widest text-amber-500">
            {readOnlyManagers} detected read-only. Use From Project to inspect environment.yml or pixi.toml.
          </p>
        )}
      </div>
    </div>
  );
};
