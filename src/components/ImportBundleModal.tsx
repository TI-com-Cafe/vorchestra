import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { X, Package2, Loader2, FileBox, AlertCircle, Hammer } from "lucide-react";
import { BundleManifest } from "../types";
import { waitForBackgroundJob } from "../services/backgroundJobs";

interface ImportBundleModalProps {
  workspaces: { path: string; is_default: boolean }[];
  defaultWorkspace: string;
  systemPythons: string[];
  onClose: () => void;
  onImported: (workspace: string) => Promise<void> | void;
}

const importReadiness = (manifest: BundleManifest): { title: string; detail: string; tone: "green" | "amber" | "red" } => {
  if (manifest.format_version !== 1) {
    return {
      title: "Unsupported bundle format",
      detail: `This bundle uses format v${manifest.format_version}. Import may fail if this app does not support it.`,
      tone: "red"
    };
  }
  if (manifest.package_count === 0) {
    return {
      title: "Bundle has no packages",
      detail: "Import will create an empty environment. Use this only when you intentionally exported a blank venv.",
      tone: "amber"
    };
  }
  return {
    title: `${manifest.package_count} package${manifest.package_count === 1 ? "" : "s"} ready to restore`,
    detail: `Original engine: ${manifest.engine}. VOrchestra will recreate the environment using the selected Python interpreter.`,
    tone: "green"
  };
};

export const ImportBundleModal: React.FC<ImportBundleModalProps> = ({
  workspaces, defaultWorkspace, systemPythons, onClose, onImported
}) => {
  const [bundlePath, setBundlePath] = useState<string | null>(null);
  const [manifest, setManifest] = useState<BundleManifest | null>(null);
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [workspace, setWorkspace] = useState(defaultWorkspace || workspaces[0]?.path || "");
  const [pythonBin, setPythonBin] = useState(systemPythons[0]?.split("|")[0] ?? "");
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const pickBundle = async () => {
    const picked = await openDialog({
      multiple: false,
      filters: [{ name: "VOrchestra bundle", extensions: ["zip"] }]
    });
    if (typeof picked !== "string") return;
    setBundlePath(picked);
    setReading(true);
    setError(null);
    try {
      const m = await invoke<BundleManifest>("read_bundle_manifest", { bundlePath: picked });
      setManifest(m);
      setName(m.venv_name);
    } catch (err) {
      setError(`${err}`);
      setManifest(null);
    } finally {
      setReading(false);
    }
  };

  const submit = async () => {
    if (!bundlePath || !manifest) return;
    setImporting(true);
    setError(null);
    setProgress("Starting import...");
    try {
      const startedJobId = await invoke<string>("start_import_venv_bundle_job", {
        bundlePath,
        targetWorkspace: workspace,
        newName: name.trim(),
        pythonBin
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
      await onImported(workspace);
      onClose();
      console.log(out);
    } catch (err) {
      setError(`${err}`);
    } finally {
      setImporting(false);
      setJobId(null);
      setProgress(null);
    }
  };

  const cancelImport = async () => {
    if (!jobId) return;
    setProgress("Cancelling import...");
    try {
      await invoke("cancel_background_job", { jobId });
    } catch (err) {
      setError(`${err}`);
    }
  };

  const close = () => {
    if (!importing) onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-md z-[80] flex items-center justify-center p-8 animate-in fade-in duration-200">
      <div className="vo-surface w-full max-w-xl rounded-[2rem] border shadow-2xl overflow-hidden">
        <div className="vo-panel p-6 border-b flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 vo-primary-action rounded-2xl shadow-lg shadow-blue-600/30"><Package2 size={18} /></div>
            <div>
              <h2 className="text-base font-black uppercase tracking-widest">Import Bundle</h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Re-create a venv from a VOrchestra zip</p>
            </div>
          </div>
          <button
            onClick={close}
            disabled={importing}
            className="vo-icon-button text-slate-400 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <button onClick={pickBundle} disabled={reading || importing} className="flex items-center gap-2 px-4 py-2 vo-secondary-action rounded-xl text-xs font-black uppercase tracking-wider disabled:opacity-50">
              {reading ? <Loader2 size={14} className="animate-spin" /> : <FileBox size={14} />}
              {reading ? "Reading..." : "Pick bundle..."}
            </button>
            <span className="text-xs text-slate-500 truncate">{bundlePath ?? "No bundle selected"}</span>
          </div>

          {manifest && (
            <>
              {(() => {
                const readiness = importReadiness(manifest);
                return (
                  <div className={`p-3 border rounded-xl space-y-1 text-[11px] ${
                    readiness.tone === "red"
                      ? "bg-red-50 dark:bg-red-950/20 border-red-100 dark:border-red-900/30 text-red-700 dark:text-red-300"
                      : readiness.tone === "amber"
                        ? "bg-amber-50 dark:bg-amber-950/20 border-amber-100 dark:border-amber-900/30 text-amber-700 dark:text-amber-300"
                        : "bg-green-50 dark:bg-green-950/20 border-green-100 dark:border-green-900/30 text-green-700 dark:text-green-300"
                  }`}>
                    <p className="text-[9px] font-black uppercase tracking-widest">Import readiness</p>
                    <p className="text-xs font-black">{readiness.title}</p>
                    <p className="font-bold opacity-80">{readiness.detail}</p>
                  </div>
                );
              })()}
              <div className="p-3 vo-subpanel border rounded-xl space-y-1 text-[11px]">
                <p><strong>Source venv:</strong> {manifest.venv_name}</p>
                <p><strong>Python:</strong> {manifest.python_version}</p>
                <p><strong>Engine:</strong> {manifest.engine}</p>
                <p><strong>Packages:</strong> {manifest.package_count}</p>
              </div>
              <div className="p-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/30 rounded-xl space-y-1 text-[11px] text-blue-700 dark:text-blue-300">
                <p className="text-[9px] font-black uppercase tracking-widest">Import plan</p>
                <p className="font-bold">
                  VOrchestra will create a new environment named <span className="font-mono">{name || manifest.venv_name}</span> in the selected workspace.
                </p>
                <p className="font-bold opacity-80">
                  Existing source environments are not modified. Package restore runs with the selected Python interpreter.
                </p>
              </div>
            </>
          )}

          {manifest && (
            <>
              <div>
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">New venv name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className="w-full mt-1 vo-control border rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Target workspace</label>
                <select value={workspace} onChange={(e) => setWorkspace(e.target.value)} className="w-full mt-1 vo-control border rounded-lg px-3 py-2 text-xs">
                  {workspaces.map(w => (<option key={w.path} value={w.path}>{w.path}</option>))}
                </select>
              </div>
              <div>
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Python interpreter</label>
                <select value={pythonBin} onChange={(e) => setPythonBin(e.target.value)} className="w-full mt-1 vo-control border rounded-lg px-3 py-2 text-xs">
                  {systemPythons.map(p => (<option key={p.split("|")[0]} value={p.split("|")[0]}>{p.split("|")[1]}</option>))}
                </select>
              </div>
            </>
          )}

          {error && (
            <div className="p-2.5 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-lg flex items-start gap-2 text-[11px] text-red-700 dark:text-red-300">
              <AlertCircle size={12} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {importing && progress && (
            <div className="p-2.5 bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 rounded-lg flex items-center gap-2 text-[11px] text-blue-700 dark:text-blue-300">
              <Loader2 size={12} className="shrink-0 animate-spin" />
              <span>{progress}</span>
            </div>
          )}
        </div>

        <div className="vo-panel p-4 border-t flex justify-end gap-2">
          {importing ? (
            <button onClick={cancelImport} className="px-4 py-1.5 bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-200 rounded-lg text-[10px] font-black uppercase">Stop Job</button>
          ) : (
            <button onClick={onClose} className="px-4 py-1.5 vo-secondary-action rounded-lg text-[10px] font-black uppercase">Cancel</button>
          )}
          <button onClick={submit} disabled={!manifest || importing || !name.trim() || !pythonBin || !workspace} className="flex items-center gap-2 px-5 py-1.5 vo-primary-action disabled:bg-slate-400 rounded-lg text-[10px] font-black uppercase tracking-wider">
            {importing ? <Loader2 size={12} className="animate-spin" /> : <Hammer size={12} />}
            {importing ? "Importing..." : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
};
