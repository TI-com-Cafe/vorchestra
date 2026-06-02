import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  X,
  Download,
  Loader2,
  ShieldAlert,
  Check,
  Zap,
  Cpu,
  AlertCircle
} from "lucide-react";
import { PythonVersion } from "../types";
import { waitForBackgroundJob } from "../services/backgroundJobs";
import { needsElevation, stripElevationPrefix } from "../services/packageManager";
import { cn } from "../utils/cn";

interface PythonInstallModalProps {
  uvAvailable: boolean;
  onClose: () => void;
  onInstalled: (version: PythonVersion) => void;
  /** Called when user clicks "Install uv first" */
  onRequestUvInstall: () => void;
}

const isWindows = typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent);

export const PythonInstallModal: React.FC<PythonInstallModalProps> = ({
  uvAvailable,
  onClose,
  onInstalled,
  onRequestUvInstall
}) => {
  const [versions, setVersions] = useState<PythonVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [installingKey, setInstallingKey] = useState<string | null>(null);
  const [installJobId, setInstallJobId] = useState<string | null>(null);
  const [installProgressByKey, setInstallProgressByKey] = useState<Record<string, string>>({});
  const [installingElevatedKey, setInstallingElevatedKey] = useState<string | null>(null);
  const [errorByKey, setErrorByKey] = useState<Record<string, string>>({});
  const [needsElevationKey, setNeedsElevationKey] = useState<string | null>(null);
  const [listJobId, setListJobId] = useState<string | null>(null);

  const loadVersions = async () => {
    const jobId = await invoke<string>("start_list_python_versions_job");
    setListJobId(jobId);
    try {
      return await waitForBackgroundJob<PythonVersion[]>(jobId);
    } finally {
      setListJobId(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    if (!uvAvailable) {
      setLoading(false);
      return () => { cancelled = true; };
    }
    (async () => {
      try {
        const list = await loadVersions();
        if (!cancelled) setVersions(list);
      } catch (err) {
        if (!cancelled) {
          const message = String(err).includes("Operation cancelled")
            ? "Python version query cancelled."
            : `${err}`;
          setLoadError(message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [uvAvailable]);

  const installVersion = async (entry: PythonVersion) => {
    setInstallingKey(entry.key);
    setInstallJobId(null);
    setInstallProgressByKey(prev => ({ ...prev, [entry.key]: "Starting install..." }));
    setNeedsElevationKey(null);
    setErrorByKey(prev => ({ ...prev, [entry.key]: "" }));
    let activeJobId: string | null = null;
    try {
      const jobId = await invoke<string>("start_install_python_job", { version: entry.version });
      activeJobId = jobId;
      setInstallJobId(jobId);
      await waitForBackgroundJob<string>(jobId, (snapshot) => {
        if (!snapshot.message) return;
        const pct = typeof snapshot.progress === "number"
          ? ` ${Math.round(snapshot.progress * 100)}%`
          : "";
        setInstallProgressByKey(prev => ({ ...prev, [entry.key]: `${snapshot.message}${pct}` }));
      });
      // Refresh list to flip installed state
      const list = await loadVersions();
      setVersions(list);
      const fresh = list.find(v => v.version === entry.version) ?? { ...entry, installed: true };
      onInstalled(fresh);
    } catch (err) {
      if (needsElevation(err)) {
        setNeedsElevationKey(entry.key);
        setErrorByKey(prev => ({
          ...prev,
          [entry.key]: "Permission denied. This install needs elevated privileges."
        }));
      } else if (String(err).includes("Operation cancelled")) {
        setErrorByKey(prev => ({ ...prev, [entry.key]: "Python install cancelled." }));
      } else {
        setErrorByKey(prev => ({ ...prev, [entry.key]: `${err}` }));
      }
    } finally {
      setInstallingKey(null);
      setInstallJobId(current => (current === activeJobId ? null : current));
      setInstallProgressByKey(prev => ({ ...prev, [entry.key]: "" }));
    }
  };

  const installElevated = async (entry: PythonVersion) => {
    setInstallingElevatedKey(entry.key);
    try {
      await invoke<string>("install_python_elevated", { version: entry.version });
      const list = await loadVersions();
      setVersions(list);
      const fresh = list.find(v => v.version === entry.version) ?? { ...entry, installed: true };
      setNeedsElevationKey(null);
      onInstalled(fresh);
    } catch (err) {
      setErrorByKey(prev => ({
        ...prev,
        [entry.key]: stripElevationPrefix(err) || "Elevated install failed."
      }));
    } finally {
      setInstallingElevatedKey(null);
    }
  };

  const cancelListVersions = async () => {
    if (!listJobId) return;
    await invoke<boolean>("cancel_background_job", { jobId: listJobId });
  };

  const cancelInstall = async () => {
    if (!installJobId) return;
    await invoke<boolean>("cancel_background_job", { jobId: installJobId });
    if (installingKey) {
      setInstallProgressByKey(prev => ({ ...prev, [installingKey]: "Cancelling install..." }));
    }
  };

  const installed = versions.filter(v => v.installed);
  const available = versions.filter(v => !v.installed);
  const runtimeGuidance = !uvAvailable
    ? "Install uv first. VOrchestra uses uv to discover and download managed Python runtimes."
    : loading
      ? "Checking managed CPython runtimes before showing install actions."
      : `${installed.length} installed runtime${installed.length === 1 ? "" : "s"} and ${available.length} downloadable runtime${available.length === 1 ? "" : "s"} found.`;

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-md z-[80] flex items-center justify-center p-8 animate-in fade-in duration-200">
      <div className="vo-surface w-full max-w-2xl max-h-[85vh] rounded-[2rem] border shadow-2xl overflow-hidden flex flex-col">
        <div className="vo-panel p-8 border-b flex items-center justify-between bg-blue-50/40 dark:bg-blue-900/10">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-600 text-white rounded-2xl shadow-lg shadow-blue-600/30">
              <Cpu size={24} />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-widest">Python Versions</h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Powered by uv (downloads from python-build-standalone)</p>
            </div>
          </div>
          <button onClick={onClose} className="vo-icon-button p-2">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="vo-subpanel p-4 border rounded-2xl">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Runtime guidance</p>
            <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">{runtimeGuidance}</p>
            <p className="mt-2 text-[10px] text-slate-400 leading-relaxed">
              Managed runtimes are used as the base for new environments; existing environments are not modified by installing a new Python version.
            </p>
          </div>

          {!uvAvailable ? (
            <div className="p-6 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 rounded-2xl">
              <p className="text-xs text-amber-700 dark:text-amber-300 font-medium mb-3">
                uv is required to download new Python versions. Install it first to unlock the full list.
              </p>
              <button
                onClick={() => { onRequestUvInstall(); onClose(); }}
                className="flex items-center gap-2 px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider"
              >
                <Zap size={14} /> Install uv
              </button>
            </div>
          ) : loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
              <Loader2 size={32} className="animate-spin text-blue-600" />
              <p className="text-[10px] font-black uppercase tracking-widest">Querying uv...</p>
              {listJobId && (
                <button
                  onClick={cancelListVersions}
                  className="vo-secondary-action px-3 py-1.5 rounded-lg text-[10px]"
                >
                  Cancel
                </button>
              )}
            </div>
          ) : loadError ? (
            <div className="p-4 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-2xl">
              <p className="text-xs text-red-600">{loadError}</p>
            </div>
          ) : (
            <>
              {installed.length > 0 && (
                <section>
                  <h3 className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 px-1">Installed ({installed.length})</h3>
                  <ul className="space-y-1.5">
                    {installed.map(v => (
                      <li key={v.key} className="flex items-center justify-between px-4 py-2.5 bg-green-50/40 dark:bg-green-900/10 border border-green-200/60 dark:border-green-800/30 rounded-xl">
                        <div className="flex items-center gap-3">
                          <Check size={14} className="text-green-600" />
                          <span className="font-black text-xs text-slate-900 dark:text-white">Python {v.version}</span>
                          {v.path && <span className="text-[10px] font-mono text-slate-400 truncate max-w-[280px]">{v.path}</span>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {available.length > 0 && (
                <section className="pt-3">
                  <h3 className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 px-1">Available to download ({available.length})</h3>
                  <ul className="space-y-1.5">
                    {available.map(v => {
                      const error = errorByKey[v.key];
                      const progress = installProgressByKey[v.key];
                      const isInstalling = installingKey === v.key;
                      const isElevating = installingElevatedKey === v.key;
                      const showElevation = needsElevationKey === v.key;
                      return (
                        <li key={v.key} className="vo-subpanel px-4 py-2.5 border rounded-xl">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <Download size={14} className="text-blue-500" />
                              <span className="font-black text-xs text-slate-900 dark:text-white">Python {v.version}</span>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => isInstalling ? cancelInstall() : installVersion(v)}
                                disabled={isElevating}
                                className={cn(
                                  "flex items-center gap-2 px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider disabled:opacity-50",
                                  isInstalling
                                    ? "bg-amber-500 hover:bg-amber-600 text-white"
                                    : "vo-primary-action"
                                )}
                              >
                                {isInstalling ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                                {isInstalling ? "Stop install" : "Install"}
                              </button>
                              {showElevation && (
                                <button
                                  onClick={() => installElevated(v)}
                                  disabled={isElevating || isInstalling}
                                  className="flex items-center gap-2 px-3 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-50"
                                  title={isWindows ? "Triggers a UAC prompt" : "Opens a terminal with sudo"}
                                >
                                  <ShieldAlert size={12} />
                                  {isElevating
                                    ? (isWindows ? "Waiting UAC..." : "Opening sudo...")
                                    : (isWindows ? "Retry as Admin" : "Retry with sudo")}
                                </button>
                              )}
                            </div>
                          </div>
                          {progress && (
                            <div className="mt-2 text-[10px] font-bold text-blue-600 dark:text-blue-300">
                              {progress}
                            </div>
                          )}
                          {error && (
                            <div className="mt-2 flex items-start gap-2 text-[10px] text-red-600 dark:text-red-400">
                              <AlertCircle size={12} className="shrink-0 mt-0.5" />
                              <span>{error}</span>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>

        <div className="vo-panel p-4 border-t flex justify-between items-center">
          <p className="text-[10px] text-slate-400">Installed Pythons appear in the New Env selector after install.</p>
          <button onClick={onClose} className="vo-secondary-action px-4 py-1.5 rounded-lg text-[10px]">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
