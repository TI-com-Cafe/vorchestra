import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  Code2,
  Copy,
  Download,
  ExternalLink,
  RefreshCcw,
  Settings,
  Terminal,
  Trash2
} from "lucide-react";
import { VenvInfo } from "../types";
import { waitForBackgroundJob } from "../services/backgroundJobs";
import { cn } from "../utils/cn";
import { assessEnvironmentHealth } from "../utils/envHealth";

interface VenvCardProps {
  venv: VenvInfo;
  syncing: boolean;
  onSync: (path: string) => void;
  onClone: (venv: VenvInfo) => void;
  onOpenStudio: (venv: VenvInfo, tab?: "packages" | "automation" | "config" | "diagnostics" | "lock" | "repair" | "deploy") => void;
  onDelete: (path: string) => void;
  setMessage: (msg: string) => void;
}

const healthGuidance = (health: ReturnType<typeof assessEnvironmentHealth>): string => {
  if (health.primaryAction === "delete_stale") {
    return "Path is missing. Remove the stale entry or recreate the environment.";
  }
  if (health.primaryAction === "repair") {
    return "Open Repair before package, automation or export actions.";
  }
  if (health.primaryAction === "sync") {
    return "Refresh metadata before making dependency decisions.";
  }
  if (health.tone === "amber") {
    return "Usable, but review recommendations when standardizing projects.";
  }
  return "Ready for package, automation and project operations.";
};

export const VenvCard: React.FC<VenvCardProps> = ({
  venv,
  syncing,
  onSync,
  onClone,
  onOpenStudio,
  onDelete,
  setMessage
}) => {
  const [exporting, setExporting] = useState(false);
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const isBroken = venv.status === "Broken";
  const health = assessEnvironmentHealth(venv);

  const openCommand = async (command: "open_in_vscode" | "open_terminal") => {
    if (isBroken) {
      setMessage(`Cannot open ${venv.name}: ${venv.issue || "environment folder is missing or invalid"}.`);
      return;
    }
    try {
      await invoke(command, { path: venv.path });
      setMessage(command === "open_in_vscode" ? "Opening project in VS Code..." : "Opening terminal...");
    } catch (err) {
      setMessage(`${err}`);
    }
  };

  const exportBundle = async () => {
    if (isBroken) {
      setMessage(`Cannot export ${venv.name}: ${venv.issue || "environment folder is missing or invalid"}.`);
      return;
    }
    const path = await saveDialog({
      defaultPath: `${venv.name}.zip`,
      filters: [{ name: "VOrchestra bundle", extensions: ["zip"] }]
    });
    if (typeof path !== "string") return;

    setExporting(true);
    setMessage("Exporting bundle...");
    try {
      const jobId = await invoke<string>("start_export_venv_bundle_job", {
        venvPath: venv.path,
        outputPath: path
      });
      setExportJobId(jobId);
      const out = await waitForBackgroundJob<string>(jobId, (snapshot) => {
        if (!snapshot.message) return;
        const pct = typeof snapshot.progress === "number"
          ? ` ${Math.round(snapshot.progress * 100)}%`
          : "";
        setMessage(`${snapshot.message}${pct}`);
      });
      setMessage(out);
    } catch (err) {
      setMessage(`Bundle export failed: ${err}`);
    } finally {
      setExportJobId(null);
      setExporting(false);
    }
  };

  const cancelExport = async () => {
    if (!exportJobId) return;
    try {
      await invoke<boolean>("cancel_background_job", { jobId: exportJobId });
      setMessage("Cancelling bundle export...");
    } catch (err) {
      setMessage(`Cancel failed: ${err}`);
    }
  };

  const runPrimaryHealthAction = () => {
    if (health.primaryAction === "sync") {
      onSync(venv.path);
      return;
    }
    if (health.primaryAction === "delete_stale") {
      onDelete(venv.path);
      return;
    }
    if (health.primaryAction === "repair") {
      if (isBroken) {
        setMessage(`Repair required for ${venv.name}: ${venv.issue || "environment is broken"}.`);
        return;
      }
      onOpenStudio(venv, "repair");
      return;
    }
    if (isBroken) {
      setMessage(`Cannot inspect ${venv.name}: ${venv.issue || "environment folder is missing or invalid"}.`);
      return;
    }
    onOpenStudio(venv);
  };

  const primaryHealthActionLabel = {
    open_studio: "Inspect",
    sync: "Sync now",
    repair: "Inspect issue",
    delete_stale: "Remove stale entry"
  }[health.primaryAction];
  const environmentType = venv.template_name || "Personalized";

  return (
    <div className={cn("vo-surface flex flex-col h-fit border rounded-2xl p-4 shadow-sm", isBroken ? "border-red-200 bg-red-50/10 shadow-none" : "hover:border-blue-400")}>
      <div className="flex justify-between mb-3 select-none">
        <div className={cn("p-2 rounded-lg shadow-sm", isBroken ? "bg-red-600 text-white" : "bg-slate-100 dark:bg-slate-800 text-blue-600")}><Terminal size={16} /></div>
        <div className="flex gap-1.5">
          <button
            onClick={() => onSync(venv.path)}
            className={cn(
              "vo-icon-button transition-all relative",
              syncing ? "animate-spin text-blue-600" : (venv.is_outdated ? "text-blue-500 bg-blue-50 dark:bg-blue-900/20 rounded-md shadow-sm" : "text-slate-400 hover:text-blue-600")
            )}
            title={venv.is_outdated ? "Sync Required (External Changes)" : "Sync"}
          >
            <RefreshCcw size={14} />
            {venv.is_outdated && <span className="absolute -top-1 -right-1 w-2 h-2 bg-blue-500 rounded-full animate-ping"></span>}
          </button>
          <button onClick={() => openCommand("open_in_vscode")} className={cn("vo-icon-button transition-colors", isBroken ? "text-slate-300 cursor-not-allowed" : "text-slate-400 hover:text-blue-600")} title={isBroken ? "Cannot open broken environment" : "VS Code"}><Code2 size={14} /></button>
          <button onClick={() => openCommand("open_terminal")} className={cn("vo-icon-button transition-colors", isBroken ? "text-slate-300 cursor-not-allowed" : "text-slate-400 hover:text-blue-600")} title={isBroken ? "Cannot open broken environment" : "Terminal"}><ExternalLink size={14} /></button>
          <button onClick={() => isBroken ? setMessage(`Cannot clone ${venv.name}: ${venv.issue || "environment folder is missing or invalid"}.`) : onClone(venv)} className={cn("vo-icon-button transition-colors", isBroken ? "text-slate-300 cursor-not-allowed" : "text-slate-400 hover:text-blue-600")} title={isBroken ? "Cannot clone broken environment" : "Clone"}><Copy size={14} /></button>
          <button onClick={exportBundle} disabled={exporting} className={cn("vo-icon-button transition-colors disabled:opacity-40 disabled:cursor-not-allowed", isBroken ? "text-slate-300 cursor-not-allowed" : "text-slate-400 hover:text-amber-600")} title={isBroken ? "Cannot export broken environment" : "Export bundle"}><Download size={14} className={exporting ? "animate-pulse" : undefined} /></button>
          {exportJobId && (
            <button onClick={cancelExport} className="px-2 py-1 text-[8px] font-black uppercase text-amber-700 bg-amber-100 dark:bg-amber-950/40 rounded-md" title="Cancel export">
              Stop
            </button>
          )}
          <button onClick={() => isBroken ? setMessage(`Cannot open Studio for ${venv.name}: ${venv.issue || "environment folder is missing or invalid"}.`) : onOpenStudio(venv)} className={cn("vo-icon-button transition-colors", isBroken ? "text-slate-300 cursor-not-allowed" : "text-slate-400 hover:text-slate-900 dark:hover:text-white")} title={isBroken ? "Cannot inspect broken environment" : "Studio"}><Settings size={14} /></button>
          <button onClick={() => onDelete(venv.path)} className="vo-icon-button text-slate-400 hover:text-red-500 transition-colors hover:border-red-100" title="Delete"><Trash2 size={14} /></button>
        </div>
      </div>
      <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
        <span
          title={environmentType}
          className={cn(
            "min-w-0 truncate rounded-full border px-2 py-0.5 text-[8px] font-black uppercase tracking-wider",
            venv.template_name
              ? "border-blue-100 bg-blue-50 text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-300"
              : "border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-300"
          )}
        >
          {environmentType}
        </span>
        <span
          title={health.signals.map(signal => signal.label).join(" • ") || "No known issues"}
          className={cn(
            "shrink-0 px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wide border",
            health.tone === "red"
              ? "bg-red-50 border-red-100 text-red-600 dark:bg-red-950/30 dark:border-red-900/40 dark:text-red-300"
              : health.tone === "amber"
                ? "bg-amber-50 border-amber-100 text-amber-700 dark:bg-amber-950/30 dark:border-amber-900/40 dark:text-amber-300"
                : "bg-green-50 border-green-100 text-green-700 dark:bg-green-950/30 dark:border-green-900/40 dark:text-green-300"
          )}
        >
          {health.score}
        </span>
      </div>
      <h4 className="font-black text-sm truncate select-text text-slate-900 dark:text-white">{venv.name}</h4>
      <p className="text-[10px] text-slate-400 font-mono truncate mt-1 opacity-70 select-text">{venv.path}</p>
      <p className="mt-2 text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
        {healthGuidance(health)}
      </p>

      {venv.is_outdated && (
        <div className="mt-2 flex items-center justify-between gap-2 text-[9px] font-black text-blue-600 bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded-lg animate-pulse">
          <span className="flex items-center gap-1.5">
            <AlertTriangle size={10} />
            SYNC REQUIRED
          </span>
          <button onClick={() => onSync(venv.path)} className="underline decoration-dotted underline-offset-2">
            Sync now
          </button>
        </div>
      )}

      {health.tone !== "green" && !venv.is_outdated && (
        <div className={cn(
          "mt-2 flex items-center justify-between gap-2 px-2 py-1 rounded-lg text-[9px] font-black",
          health.tone === "red"
            ? "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-300"
            : "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
        )}>
          <span className="truncate">{health.signals[0]?.label || health.label}</span>
          <button onClick={runPrimaryHealthAction} className="shrink-0 underline decoration-dotted underline-offset-2">
            {primaryHealthActionLabel}
          </button>
        </div>
      )}

      <div className="vo-subpanel mt-4 flex justify-between items-center text-[9px] font-bold uppercase text-slate-500 select-none rounded-xl border px-3 py-2">
        <span className={cn(
          health.tone === "red" ? "text-red-600" : health.tone === "amber" ? "text-amber-600" : "text-green-600"
        )}>
          {health.label}
        </span>
        <span className="text-blue-600 font-mono">{venv.version.split(" ")[1] || venv.version}</span>
      </div>
    </div>
  );
};
