import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  X, Loader2, FolderTree, FileBox, Layers, Hammer, AlertCircle, Plus, Trash2
} from "lucide-react";
import { ProjectDetection, ProjectManifest, ManifestKind } from "../types";
import { waitForBackgroundJob } from "../services/backgroundJobs";

interface ProjectDetectModalProps {
  defaultEngine: "pip" | "uv";
  uvAvailable: boolean;
  systemPythons: string[];
  onClose: () => void;
  /** Triggered with the chosen project root + python bin + engine + final
   *  package list once the user clicks "Build venv from project". */
  onBuild: (args: {
    projectRoot: string;
    pythonBin: string;
    engine: "pip" | "uv";
    venvName: string;
    packages: string[];
    onProgress?: (message: string) => void;
    onJobStart?: (jobId: string) => void;
  }) => Promise<void> | void;
  onCancelBuild?: (jobId: string) => Promise<void> | void;
}

const KIND_LABEL: Record<ManifestKind, string> = {
  requirements_txt: "requirements.txt",
  pyproject: "pyproject.toml",
  pipfile: "Pipfile",
  setup_py: "setup.py",
  setup_cfg: "setup.cfg",
  conda_environment: "environment.yml",
  pixi_toml: "pixi.toml"
};

const isReadOnlyManifest = (kind: ManifestKind): boolean =>
  kind === "conda_environment" || kind === "pixi_toml";

const buildReadiness = (detection: ProjectDetection, packages: string[]): { title: string; detail: string; tone: "green" | "amber" | "red" } => {
  const readOnlyCount = detection.manifests.filter(manifest => isReadOnlyManifest(manifest.kind)).length;
  if (packages.length === 0) {
    return {
      title: "No installable packages detected",
      detail: readOnlyCount > 0
        ? "Only read-only Conda/Pixi inventory was found. Add packages manually or use a pip/uv manifest."
        : "Add packages manually before building this environment.",
      tone: "red"
    };
  }
  if (readOnlyCount > 0) {
    return {
      title: `${packages.length} installable package${packages.length === 1 ? "" : "s"} ready`,
      detail: `${readOnlyCount} read-only manifest${readOnlyCount === 1 ? "" : "s"} will be shown as inventory and will not be installed by pip/uv.`,
      tone: "amber"
    };
  }
  return {
    title: `${packages.length} package${packages.length === 1 ? "" : "s"} ready to install`,
    detail: "Review the editable package list before building the environment.",
    tone: "green"
  };
};

const standardizationProposal = (
  detection: ProjectDetection,
  uvAvailable: boolean
): { title: string; detail: string; tone: "blue" | "amber" | "green" }[] => {
  const kinds = new Set(detection.manifests.map(manifest => manifest.kind));
  const readOnlyCount = detection.manifests.filter(manifest => isReadOnlyManifest(manifest.kind)).length;
  const installableCount = detection.manifests.length - readOnlyCount;
  const proposals: { title: string; detail: string; tone: "blue" | "amber" | "green" }[] = [];

  if (installableCount > 1) {
    proposals.push({
      title: "Consolidate dependency sources",
      detail: "Multiple installable manifests were found. Pick one source of truth before adding lockfile workflows.",
      tone: "amber"
    });
  }
  if (kinds.has("pyproject") && uvAvailable) {
    proposals.push({
      title: "Standardize on uv project workflow",
      detail: "Use uv sync, uv lock and dependency groups from the project board after the environment is created.",
      tone: "green"
    });
    if (detection.workspace) {
      proposals.push({
        title: "Review uv workspace scope",
        detail: `${detection.workspace.members.length} workspace member pattern${detection.workspace.members.length === 1 ? "" : "s"} detected. Sync and lock should be treated as monorepo-wide operations.`,
        tone: "blue"
      });
    }
  } else if (kinds.has("requirements_txt")) {
    proposals.push({
      title: "Add a lockfile when dependencies stabilize",
      detail: "Build from requirements.txt now, then freeze requirements.lock to make rebuilds repeatable.",
      tone: "blue"
    });
  }
  if (readOnlyCount > 0) {
    proposals.push({
      title: "Keep Conda/Pixi as read-only inventory",
      detail: "VOrchestra will show environment.yml and pixi.toml context, but pip/uv builds only install Python package specs.",
      tone: "amber"
    });
  }
  if (proposals.length === 0) {
    proposals.push({
      title: "Single-source project is ready",
      detail: "The detected manifest set is simple enough to build now and refine later from Studio.",
      tone: "green"
    });
  }

  return proposals;
};

export const ProjectDetectModal: React.FC<ProjectDetectModalProps> = ({
  defaultEngine,
  uvAvailable,
  systemPythons,
  onClose,
  onBuild,
  onCancelBuild
}) => {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detection, setDetection] = useState<ProjectDetection | null>(null);
  const [packages, setPackages] = useState<string[]>([]);
  const [venvName, setVenvName] = useState(".venv");
  const [pythonBin, setPythonBin] = useState(systemPythons[0]?.split("|")[0] ?? "");
  const [engine, setEngine] = useState<"pip" | "uv">(uvAvailable ? defaultEngine : "pip");
  const [building, setBuilding] = useState(false);
  const [buildJobId, setBuildJobId] = useState<string | null>(null);
  const [scanJobId, setScanJobId] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState("");
  const [buildProgress, setBuildProgress] = useState("");
  const [newPkg, setNewPkg] = useState("");

  const pickFolder = async () => {
    setError(null);
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked !== "string") return;
    setScanning(true);
    setScanProgress("Preparing manifest scan...");
    setDetection(null);
    setPackages([]);
    try {
      const jobId = await invoke<string>("start_detect_project_manifests_job", { path: picked });
      setScanJobId(jobId);
      const r = await waitForBackgroundJob<ProjectDetection>(jobId, (snapshot) => {
        if (!snapshot.message) return;
        const pct = typeof snapshot.progress === "number"
          ? ` ${Math.round(snapshot.progress * 100)}%`
          : "";
        setScanProgress(`${snapshot.message}${pct}`);
      });
      setDetection(r);
      setPackages(r.merged_packages);
      // Default name to the project folder's basename
      const base = picked.split(/[/\\]/).filter(Boolean).pop() ?? "project";
      setVenvName(`${base}-venv`);
    } catch (err) {
      setError(`${err}`);
    } finally {
      setScanning(false);
      setScanJobId(null);
      setScanProgress("");
    }
  };

  const cancelScan = async () => {
    if (!scanJobId) return;
    setScanProgress("Cancelling scan...");
    await invoke<boolean>("cancel_background_job", { jobId: scanJobId });
  };

  const removePackage = (pkg: string) => {
    setPackages(prev => prev.filter(p => p !== pkg));
  };

  const addPackage = () => {
    const v = newPkg.trim();
    if (!v) return;
    if (!packages.includes(v)) {
      setPackages(prev => [...prev, v]);
    }
    setNewPkg("");
  };

  const build = async () => {
    if (!detection) return;
    if (!venvName.trim()) {
      setError("Pick a name for the venv.");
      return;
    }
    if (!pythonBin) {
      setError("Pick a Python interpreter.");
      return;
    }
    setBuilding(true);
    setBuildJobId(null);
    setBuildProgress("Starting build...");
    setError(null);
    try {
      await onBuild({
        projectRoot: detection.project_root,
        pythonBin,
        engine,
        venvName: venvName.trim(),
        packages,
        onProgress: setBuildProgress,
        onJobStart: setBuildJobId
      });
      onClose();
    } catch (err) {
      setError(`${err}`);
    } finally {
      setBuilding(false);
      setBuildJobId(null);
    }
  };

  const cancelBuild = async () => {
    if (!buildJobId || !onCancelBuild) return;
    setBuildProgress("Cancelling build...");
    await onCancelBuild(buildJobId);
  };

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-md z-[80] flex items-center justify-center p-8 animate-in fade-in duration-200">
      <div className="vo-surface w-full max-w-3xl max-h-[88vh] rounded-[2rem] border shadow-2xl overflow-hidden flex flex-col">
        <div className="vo-panel p-7 border-b flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 vo-primary-action rounded-2xl shadow-lg shadow-blue-600/30">
              <FolderTree size={24} />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-widest">From Project</h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Detect manifests, review deps, build venv</p>
            </div>
          </div>
          <button onClick={onClose} disabled={building} className="vo-icon-button text-slate-400 transition-all disabled:opacity-40">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* 1. Pick folder */}
          <section>
            <h3 className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 px-1">1. Pick the project folder</h3>
            <div className="flex items-center gap-3">
              <button onClick={pickFolder} disabled={scanning} className="flex items-center gap-2 px-5 py-3 vo-secondary-action rounded-2xl text-xs font-black uppercase tracking-wider disabled:opacity-50">
                {scanning ? <Loader2 size={14} className="animate-spin" /> : <FolderTree size={14} />}
                {scanning ? "Scanning..." : "Browse..."}
              </button>
              {scanning && scanJobId && (
                <button
                  onClick={cancelScan}
                  className="px-4 py-3 bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-200 rounded-2xl text-xs font-black uppercase tracking-wider"
                >
                  Stop scan
                </button>
              )}
              <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {detection?.project_root ?? "No folder selected"}
              </span>
            </div>
            {scanning && scanProgress && (
              <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">{scanProgress}</p>
            )}
          </section>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-2xl flex items-start gap-3 text-xs text-red-700 dark:text-red-300">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {building && buildProgress && (
            <div className="p-3 bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 rounded-2xl flex items-center gap-3 text-xs text-blue-700 dark:text-blue-300">
              <Loader2 size={14} className="animate-spin shrink-0" />
              <span>{buildProgress}</span>
            </div>
          )}

          {/* 2. Detected manifests */}
          {detection && (
            <section>
              <h3 className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 px-1">
                2. Detected manifests ({detection.manifests.length})
              </h3>
              {detection.manifests.length === 0 ? (
                <p className="text-xs text-slate-500 italic">No manifests found in that folder.</p>
              ) : (
                <ul className="space-y-2">
                  {detection.manifests.map((m: ProjectManifest) => (
                    <li key={m.path} className="px-4 py-3 vo-subpanel border rounded-xl">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <FileBox size={14} className="text-blue-500" />
                          <span className="text-xs font-black">{KIND_LABEL[m.kind]}</span>
                          {isReadOnlyManifest(m.kind) && (
                            <span className="px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-200 text-[8px] font-black uppercase tracking-wider">
                              Read-only
                            </span>
                          )}
                          <span className="text-[10px] font-mono text-slate-400 truncate max-w-[260px]">{m.path}</span>
                        </div>
                        <span className="text-[10px] font-bold text-slate-500">{m.packages.length} pkg</span>
                      </div>
                      {m.note && (
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 italic ml-7">{m.note}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {detection && (
            <section>
              <h3 className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 px-1">
                Standardization proposal
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {standardizationProposal(detection, uvAvailable).map(proposal => (
                  <div
                    key={proposal.title}
                    className={`rounded-2xl border px-4 py-3 ${
                      proposal.tone === "amber"
                        ? "bg-amber-50 dark:bg-amber-950/20 border-amber-100 dark:border-amber-900/30 text-amber-700 dark:text-amber-300"
                        : proposal.tone === "green"
                          ? "bg-green-50 dark:bg-green-950/20 border-green-100 dark:border-green-900/30 text-green-700 dark:text-green-300"
                          : "bg-blue-50 dark:bg-blue-950/20 border-blue-100 dark:border-blue-900/30 text-blue-700 dark:text-blue-300"
                    }`}
                  >
                    <p className="text-[10px] font-black uppercase tracking-widest">{proposal.title}</p>
                    <p className="mt-1 text-[10px] font-bold opacity-80">{proposal.detail}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 3. Editable package list */}
          {detection && (
            <section>
              <h3 className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 px-1 flex items-center gap-2">
                <Layers size={12} /> 3. Package list ({packages.length})
              </h3>
              {(() => {
                const readiness = buildReadiness(detection, packages);
                return (
                  <div className={`mb-3 rounded-2xl border px-4 py-3 ${
                    readiness.tone === "red"
                      ? "bg-red-50 dark:bg-red-950/20 border-red-100 dark:border-red-900/30 text-red-700 dark:text-red-300"
                      : readiness.tone === "amber"
                        ? "bg-amber-50 dark:bg-amber-950/20 border-amber-100 dark:border-amber-900/30 text-amber-700 dark:text-amber-300"
                        : "bg-green-50 dark:bg-green-950/20 border-green-100 dark:border-green-900/30 text-green-700 dark:text-green-300"
                  }`}>
                    <p className="text-[10px] font-black uppercase tracking-widest">Build readiness</p>
                    <p className="mt-1 text-xs font-black">{readiness.title}</p>
                    <p className="mt-1 text-[10px] font-bold opacity-80">{readiness.detail}</p>
                  </div>
                );
              })()}
              <ul className="space-y-1 max-h-48 overflow-y-auto pr-1">
                {packages.map(pkg => (
                  <li key={pkg} className="flex items-center justify-between px-3 py-1.5 vo-control border rounded-lg text-xs font-mono">
                    <span className="truncate">{pkg}</span>
                    <button
                      onClick={() => removePackage(pkg)}
                      className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                      title="Remove"
                    >
                      <Trash2 size={12} />
                    </button>
                  </li>
                ))}
                {packages.length === 0 && (
                  <li className="px-3 py-1.5 text-[11px] italic text-slate-400">List is empty.</li>
                )}
              </ul>
              <div className="flex gap-2 mt-2">
                <input
                  value={newPkg}
                  onChange={(e) => setNewPkg(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addPackage())}
                  placeholder="Add a package (e.g. requests==2.31.0)"
                  className="flex-1 vo-control border rounded-lg px-3 py-1.5 text-xs font-mono outline-none focus:border-blue-500"
                />
                <button onClick={addPackage} className="flex items-center gap-1 px-3 py-1.5 vo-primary-action rounded-lg text-[10px] font-black uppercase tracking-wider">
                  <Plus size={12} /> Add
                </button>
              </div>
            </section>
          )}

          {/* 4. Build options */}
          {detection && (
            <section>
              <h3 className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 px-1">4. Build options</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input
                  value={venvName}
                  onChange={(e) => setVenvName(e.target.value)}
                  placeholder="venv name"
                  className="vo-control border rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-500"
                />
                <select
                  value={pythonBin}
                  onChange={(e) => setPythonBin(e.target.value)}
                  className="vo-control border rounded-lg px-3 py-2 text-xs text-blue-600"
                >
                  {systemPythons.map(p => (
                    <option key={p.split("|")[0]} value={p.split("|")[0]}>{p.split("|")[1]}</option>
                  ))}
                </select>
                <div className="flex items-center vo-subpanel rounded-lg p-0.5 border">
                  <button
                    onClick={() => setEngine("pip")}
                    className={`flex-1 px-3 py-1.5 rounded-md text-[10px] font-black uppercase ${engine === "pip" ? "bg-white dark:bg-slate-700 text-blue-600 shadow-sm" : "text-slate-400"}`}
                  >pip</button>
                  {uvAvailable && (
                    <button
                      onClick={() => setEngine("uv")}
                      className={`flex-1 px-3 py-1.5 rounded-md text-[10px] font-black uppercase ${engine === "uv" ? "bg-white dark:bg-slate-700 text-blue-600 shadow-sm" : "text-slate-400"}`}
                    >uv</button>
                  )}
                </div>
              </div>
            </section>
          )}
        </div>

        <div className="vo-panel p-4 border-t flex justify-between items-center">
          <p className="text-[10px] text-slate-400">
            The venv is created inside the chosen project folder. Editable installs (-e .) keep your code synced automatically.
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} disabled={building} className="px-4 py-1.5 vo-secondary-action rounded-lg text-[10px] font-black uppercase disabled:opacity-50">
              Cancel
            </button>
            {building && buildJobId && (
              <button
                onClick={cancelBuild}
                className="px-4 py-1.5 bg-amber-500 text-white rounded-lg text-[10px] font-black uppercase"
              >
                Stop build
              </button>
            )}
            <button
              onClick={build}
              disabled={!detection || building || !packages.length || !pythonBin || !venvName.trim()}
              className="flex items-center gap-2 px-5 py-1.5 vo-primary-action disabled:bg-slate-400 rounded-lg text-[10px] font-black uppercase tracking-wider"
            >
              {building ? <Loader2 size={12} className="animate-spin" /> : <Hammer size={12} />}
              {building ? "Building..." : "Build venv from project"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
