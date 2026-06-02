import React, { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Trash2, Plus, X, AlertTriangle, Loader2, Sparkles } from "lucide-react";
import { VenvInfo } from "../types";
import { dbService } from "../services/db";
import { waitForBackgroundJob } from "../services/backgroundJobs";

interface HygieneOverlayProps {
  onClose: () => void;
  workspaces: string[];
  onRefresh: () => Promise<void> | void;
  setMessage: (msg: string) => void;
}

interface AuditReport {
  broken_links: string[];
  untracked_venvs: VenvInfo[];
}

const hygienePlan = (report: AuditReport): string[] => {
  const steps: string[] = [];
  if (report.broken_links.length > 0) {
    steps.push(`Prune ${report.broken_links.length} ghost entr${report.broken_links.length === 1 ? "y" : "ies"} first. These records point to missing folders.`);
  }
  if (report.untracked_venvs.length > 0) {
    steps.push(`Adopt ${report.untracked_venvs.length} untracked environment${report.untracked_venvs.length === 1 ? "" : "s"} if they belong to your workspace.`);
  }
  if (steps.length === 0) {
    steps.push("Inventory is aligned with disk. No database cleanup is needed right now.");
  }
  return steps;
};

export const HygieneOverlay: React.FC<HygieneOverlayProps> = ({ onClose, workspaces, onRefresh, setMessage }) => {
  const [report, setReport] = useState<AuditReport>({ broken_links: [], untracked_venvs: [] });
  const [loading, setLoading] = useState(true);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState("Preparing audit...");
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const runAudit = async () => {
    setLoading(true);
    setError(null);
    setProgress("Preparing audit...");
    try {
      const allCached = await dbService.getCachedVenvs();
      const registeredPaths = Object.values(allCached).flat().map(v => v.path);
      const startedJobId = await invoke<string>("start_audit_environments_job", {
        workspacePaths: workspaces, 
        registeredPaths 
      });
      if (mountedRef.current) setJobId(startedJobId);
      const res = await waitForBackgroundJob<AuditReport>(startedJobId, (snapshot) => {
        if (!snapshot.message || !mountedRef.current) return;
        const pct = typeof snapshot.progress === "number"
          ? ` ${Math.round(snapshot.progress * 100)}%`
          : "";
        setProgress(`${snapshot.message}${pct}`);
      });
      if (mountedRef.current) setReport(res);
    } catch (err) {
      if (mountedRef.current) setError(`${err}`);
    } finally {
      if (mountedRef.current) setJobId(null);
      if (mountedRef.current) setLoading(false);
    }
  };

  const cancelAudit = async () => {
    if (!jobId) return;
    setProgress("Cancelling audit...");
    await invoke<boolean>("cancel_background_job", { jobId });
  };

  const workspacesKey = workspaces.join("\n");
  useEffect(() => {
    runAudit();
    // workspacesKey is a stable serialization; the array identity changes every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacesKey]);

  const prune = async (path: string) => {
    await dbService.removeVenvByPath(path);
    await runAudit();
    await onRefresh();
    setMessage("Dead link pruned from database.");
  };

  const adopt = async (venv: VenvInfo) => {
    // Find the longest matching workspace path to ensure it goes to the correct sub-workspace
    const matchingWorkspaces = workspaces
      .filter(w => venv.path.startsWith(w))
      .sort((a, b) => b.length - a.length);
    
    const targetWs = matchingWorkspaces[0] || workspaces[0];
    
    await dbService.addSingleVenv(targetWs, venv);
    await runAudit();
    await onRefresh();
    setMessage(`Adopted ${venv.name} into workspace: ${targetWs.split('/').pop()}`);
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-xl z-[60] flex items-center justify-center p-12 animate-in fade-in duration-300">
      <div className="vo-surface w-full max-w-4xl h-[80vh] rounded-[3rem] border shadow-2xl flex flex-col overflow-hidden">
        <div className="vo-panel p-8 border-b flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-green-600 text-white rounded-2xl shadow-lg shadow-green-500/20"><Sparkles size={24}/></div>
            <div>
              <h2 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-widest">Global Hygiene</h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Sync database with physical disk state</p>
            </div>
          </div>
          <button onClick={onClose} className="vo-icon-button p-3 rounded-2xl"><X size={24}/></button>
        </div>

        <div className="flex-1 overflow-y-auto p-10 space-y-10">
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center gap-4 text-slate-400">
              <Loader2 size={48} className="animate-spin text-blue-600"/>
              <p className="font-black uppercase tracking-widest text-xs">Auditing Workspaces...</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{progress}</p>
              {jobId && (
                <button
                  onClick={cancelAudit}
                  className="px-5 py-2 bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-200 rounded-xl text-[10px] font-black uppercase tracking-wider hover:bg-amber-200 dark:hover:bg-amber-900/60 transition-all"
                >
                  Cancel audit
                </button>
              )}
            </div>
          ) : error ? (
            <div className="h-full flex flex-col items-center justify-center gap-4 text-red-500">
              <AlertTriangle size={42} />
              <p className="font-black uppercase tracking-widest text-xs">Audit failed</p>
              <p className="max-w-xl text-center text-xs text-red-600 dark:text-red-300">{error}</p>
              <button onClick={runAudit} className="px-5 py-2 bg-red-600 text-white rounded-xl text-[10px] font-black uppercase tracking-wider hover:bg-red-700 transition-all">
                Retry
              </button>
            </div>
          ) : (
            <>
              <section className="rounded-[2rem] border border-green-100 dark:border-green-900/30 bg-green-50/70 dark:bg-green-950/10 p-5">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-green-700 dark:text-green-300">
                  Hygiene plan
                </h3>
                <ol className="mt-3 space-y-2">
                  {hygienePlan(report).map((step, index) => (
                    <li key={step} className="flex gap-2 text-[11px] font-bold text-slate-600 dark:text-slate-300">
                      <span className="shrink-0 text-green-700 dark:text-green-300">{index + 1}.</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </section>

              {/* Broken Links Section */}
              <div className="space-y-4">
                <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-red-500">
                  <AlertTriangle size={16}/> Ghost Entries ({report.broken_links.length})
                </h3>
                <div className="space-y-2">
                  {report.broken_links.map(path => (
                    <div key={path} className="flex items-center justify-between p-4 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-2xl">
                      <div className="flex flex-col truncate mr-4">
                        <span className="text-[10px] font-mono text-slate-500 truncate">{path}</span>
                        <span className="text-[9px] font-bold text-red-400 uppercase italic">Entry exists in DB but folder is missing on disk</span>
                      </div>
                      <button onClick={() => prune(path)} className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-xl text-[10px] font-black uppercase hover:bg-red-700 transition-all shadow-md active:scale-95"><Trash2 size={12}/> Prune</button>
                    </div>
                  ))}
                  {report.broken_links.length === 0 && <p className="text-[10px] text-slate-400 italic px-4">No broken links found. Database is healthy.</p>}
                </div>
              </div>

              {/* Untracked Venvs Section */}
              <div className="space-y-4 pt-4">
                <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-blue-500">
                  <Plus size={16}/> Untracked Environments ({report.untracked_venvs.length})
                </h3>
                <div className="space-y-2">
                  {report.untracked_venvs.map(venv => (
                    <div key={venv.path} className="vo-subpanel flex items-center justify-between p-4 border rounded-2xl">
                      <div className="flex flex-col truncate mr-4">
                        <span className="font-black text-xs text-slate-800 dark:text-slate-200">{venv.name}</span>
                        <span className="text-[10px] font-mono text-slate-400 truncate">{venv.path}</span>
                      </div>
                      <button onClick={() => adopt(venv)} className="vo-primary-action flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] shadow-md"><Plus size={12}/> Adopt</button>
                    </div>
                  ))}
                  {report.untracked_venvs.length === 0 && <p className="text-[10px] text-slate-400 italic px-4">No orphan environments found in your workspaces.</p>}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="vo-panel p-8 border-t text-center">
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.2em]">The orchestrator ensures 100% synchronization between your database and filesystem.</p>
        </div>
      </div>
    </div>
  );
};
