import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, Copy, Loader2, AlertCircle } from "lucide-react";
import { VenvInfo } from "../types";
import { waitForBackgroundJob } from "../services/backgroundJobs";

interface CloneVenvModalProps {
  source: VenvInfo;
  workspaces: { path: string; is_default: boolean }[];
  defaultWorkspace: string;
  onClose: () => void;
  onCloned: (newPath: string, workspace: string) => void;
}

export const CloneVenvModal: React.FC<CloneVenvModalProps> = ({
  source, workspaces, defaultWorkspace, onClose, onCloned
}) => {
  const [name, setName] = useState(`${source.name}-clone`);
  const [workspace, setWorkspace] = useState(defaultWorkspace || workspaces[0]?.path || "");
  const [includePackages, setIncludePackages] = useState(true);
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const submit = async () => {
    setCloning(true);
    setError(null);
    setProgress("Starting clone...");
    try {
      const startedJobId = await invoke<string>("start_clone_venv_job", {
        sourcePath: source.path,
        targetWorkspace: workspace,
        newName: name.trim(),
        includePackages
      });
      setJobId(startedJobId);
      const out = await waitForBackgroundJob<string>(startedJobId, (snapshot) => {
        if (snapshot.message) {
          const pct = typeof snapshot.progress === "number"
            ? ` ${Math.round(snapshot.progress * 100)}%`
            : "";
          setProgress(`${snapshot.message}${pct}`);
        }
      });
      onCloned(out, workspace);
      onClose();
    } catch (err) {
      setError(`${err}`);
    } finally {
      setCloning(false);
      setJobId(null);
      setProgress(null);
    }
  };

  const cancelClone = async () => {
    if (!jobId) return;
    setProgress("Cancelling clone...");
    try {
      await invoke("cancel_background_job", { jobId });
    } catch (err) {
      setError(`${err}`);
    }
  };

  const close = () => {
    if (!cloning) onClose();
  };

  const clonePlan = includePackages
    ? "Create a fresh environment and re-install packages from the source. This is safer than copying site-packages, but can take time and may fail if indexes or build tools are unavailable."
    : "Create an empty environment with the same base setup. Use this when you want a clean target and will sync packages from project manifests later.";

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-md z-[80] flex items-center justify-center p-8 animate-in fade-in duration-200">
      <div className="vo-surface w-full max-w-lg rounded-[2rem] border shadow-2xl overflow-hidden">
        <div className="vo-panel p-6 border-b flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 vo-primary-action rounded-2xl shadow-lg shadow-blue-600/30"><Copy size={18} /></div>
            <div>
              <h2 className="text-base font-black uppercase tracking-widest">Clone Venv</h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">{source.name} → new venv</p>
            </div>
          </div>
          <button
            onClick={close}
            disabled={cloning}
            className="vo-icon-button text-slate-400 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="p-3 vo-subpanel border rounded-2xl">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Clone plan</p>
            <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">{clonePlan}</p>
          </div>

          <div>
            <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">New venv name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full mt-1 vo-control border rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Target workspace</label>
            <select
              value={workspace}
              onChange={(e) => setWorkspace(e.target.value)}
              className="w-full mt-1 vo-control border rounded-lg px-3 py-2 text-xs"
            >
              {workspaces.map(w => (<option key={w.path} value={w.path}>{w.path}</option>))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-[11px] font-bold text-slate-600 dark:text-slate-400 select-none cursor-pointer">
            <input
              type="checkbox"
              checked={includePackages}
              onChange={(e) => setIncludePackages(e.target.checked)}
              className="accent-blue-600"
            />
            Re-install all packages from the source venv
          </label>

          {error && (
            <div className="p-2.5 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-lg flex items-start gap-2 text-[11px] text-red-700 dark:text-red-300">
              <AlertCircle size={12} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {cloning && progress && (
            <div className="p-2.5 bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 rounded-lg flex items-center gap-2 text-[11px] text-blue-700 dark:text-blue-300">
              <Loader2 size={12} className="shrink-0 animate-spin" />
              <span>{progress}</span>
            </div>
          )}
        </div>

        <div className="vo-panel p-4 border-t flex justify-end gap-2">
          {cloning ? (
            <button onClick={cancelClone} className="px-4 py-1.5 bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-200 rounded-lg text-[10px] font-black uppercase">
              Stop Job
            </button>
          ) : (
            <button onClick={onClose} className="px-4 py-1.5 vo-secondary-action rounded-lg text-[10px] font-black uppercase">
              Cancel
            </button>
          )}
          <button
            onClick={submit}
            disabled={cloning || !name.trim() || !workspace}
            className="flex items-center gap-2 px-5 py-1.5 vo-primary-action disabled:bg-slate-400 rounded-lg text-[10px] font-black uppercase tracking-wider"
          >
            {cloning ? <Loader2 size={12} className="animate-spin" /> : <Copy size={12} />}
            {cloning ? "Cloning..." : "Clone"}
          </button>
        </div>
      </div>
    </div>
  );
};
