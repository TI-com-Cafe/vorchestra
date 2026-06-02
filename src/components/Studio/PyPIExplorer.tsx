import React from "react";
import {
  Search, Package, Plus, Loader2, X, ExternalLink, Activity, Check, AlertCircle,
  GitBranch, FileBox, FolderTree, Globe, ShieldAlert
} from "lucide-react";
import { VenvInfo } from "../../types";
import { cn } from "../../utils/cn";
import {
  isWindows,
  PyPISourceTab,
  TEST_PYPI_INDEX,
  usePyPIExplorerController
} from "../../hooks/studio/usePyPIExplorerController";

interface PyPIExplorerProps {
  venv: VenvInfo;
  onClose: () => void;
  onInstalled: () => void;
  setMessage: (msg: string) => void;
}

const TABS: { id: PyPISourceTab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: "pypi", label: "PyPI", icon: Search },
  { id: "git", label: "Git", icon: GitBranch },
  { id: "url", label: "URL", icon: Globe },
  { id: "file", label: "Local File", icon: FileBox },
  { id: "project", label: "Local Project", icon: FolderTree }
];

const SOURCE_GUIDANCE: Record<PyPISourceTab, { title: string; detail: string }> = {
  pypi: {
    title: "Best for published packages",
    detail: "Search PyPI first when you want a normal package release with version discovery and compatibility checks."
  },
  git: {
    title: "Best for unreleased code",
    detail: "Use Git when you need a branch, tag, SHA or repository subdirectory that is not published to PyPI yet."
  },
  url: {
    title: "Best for hosted artifacts",
    detail: "Use a URL for private wheels, source archives or alternate indexes that expose direct artifact links."
  },
  file: {
    title: "Best for offline installs",
    detail: "Use a local wheel or source distribution when the artifact is already on disk or network access is restricted."
  },
  project: {
    title: "Best for local development",
    detail: "Use editable local project installs when source changes should be reflected without reinstalling."
  }
};

const IMPACT_TONES = {
  green: "border-emerald-200 bg-emerald-50/80 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300",
  blue: "border-blue-200 bg-blue-50/80 text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-300",
  red: "border-red-200 bg-red-50/80 text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300"
};

const ImpactBucket: React.FC<{ label: string; items: string[]; tone: keyof typeof IMPACT_TONES }> = ({ label, items, tone }) => (
  <div className={cn("rounded-xl border px-3 py-2", IMPACT_TONES[tone])}>
    <p className="text-[9px] font-black uppercase tracking-widest">{label}</p>
    {items.length > 0 ? (
      <p className="mt-1 text-[10px] font-mono leading-relaxed break-words">
        {items.slice(0, 8).join(", ")}{items.length > 8 ? `, +${items.length - 8} more` : ""}
      </p>
    ) : (
      <p className="mt-1 text-[10px] font-bold opacity-60">No changes</p>
    )}
  </div>
);

export const PyPIExplorer: React.FC<PyPIExplorerProps> = ({ venv, onClose, onInstalled, setMessage }) => {
  const c = usePyPIExplorerController({ venv, onInstalled, setMessage });
  const guidance = SOURCE_GUIDANCE[c.tab];

  return (
    <div className="vo-surface flex flex-col h-full animate-in slide-in-from-bottom-4 duration-300">
      <div className="vo-panel flex items-center justify-between p-6 border-b">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 dark:bg-blue-900/30 text-blue-600 rounded-xl">
            <Package size={20} />
          </div>
          <div>
            <h3 className="font-black text-sm uppercase tracking-widest">Install Package</h3>
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">PyPI · Git · URL · Local file · Editable project</p>
          </div>
        </div>
        <button onClick={onClose} className="vo-icon-button p-2 rounded-full">
          <X size={20} />
        </button>
      </div>

      <div className="vo-panel flex px-6 border-b gap-1 overflow-x-auto">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => c.setTab(id)}
            className={cn(
              "flex items-center gap-2 px-4 py-3 text-[11px] font-black uppercase tracking-wider border-b-2 transition-all whitespace-nowrap",
              c.tab === id
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            )}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      <div className="p-8 space-y-6 overflow-y-auto">
        <div className="vo-panel rounded-2xl border border-blue-100/80 dark:border-blue-900/30 bg-blue-50/70 dark:bg-blue-950/10 px-4 py-3">
          <p className="text-[9px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300">Source guidance</p>
          <p className="mt-1 text-xs font-black text-slate-800 dark:text-slate-100">{guidance.title}</p>
          <p className="mt-1 text-[10px] font-bold text-slate-500 dark:text-slate-400">{guidance.detail}</p>
        </div>

        {c.tab === "pypi" && (
          <>
            <form onSubmit={c.handlePypiSearch} className="relative">
              <input
                autoFocus
                value={c.query}
                onChange={(e) => {
                  c.setQuery(e.target.value);
                  if (c.searchError) c.setSearchError(null);
                }}
                placeholder="Search package on PyPI (e.g. requests, pandas...)"
                className="vo-control w-full border-2 rounded-2xl py-4 px-6 pr-14 font-medium"
              />
              <button
                type={c.searching ? "button" : "submit"}
                onClick={c.searching ? c.cancelPypiSearch : undefined}
                className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-xl transition-all"
                title={c.searching ? "Cancel current search" : "Search PyPI"}
              >
                {c.searching ? <X size={24} /> : <Search size={24} />}
              </button>
            </form>

            {c.searching && (
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-blue-600">
                <Loader2 size={12} className="animate-spin" /> Searching PyPI...
              </div>
            )}

            {c.searchError && !c.searching && (
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 text-[11px] font-bold text-amber-700 dark:text-amber-300 flex items-start gap-2">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>{c.searchError}</span>
              </div>
            )}

            <label className="flex items-center gap-2 text-[11px] font-bold text-slate-600 dark:text-slate-400 select-none cursor-pointer">
              <input type="checkbox" checked={c.useTestPyPI} onChange={(e) => c.setUseTestPyPI(e.target.checked)} className="accent-blue-600" />
              Use Test PyPI ({TEST_PYPI_INDEX})
            </label>

            {c.result ? (
              <div className="vo-panel rounded-[2rem] border-2 border-blue-500/20 p-8 space-y-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="flex items-center gap-4">
                    <div className="vo-surface p-4 rounded-2xl shadow-sm"><Package size={32} className="text-blue-600" /></div>
                    <div>
                      <h4 className="text-2xl font-black text-slate-900 dark:text-white">{c.result.info.name}</h4>
                      <div className="flex items-center gap-3 mt-1">
                        <select
                          value={c.selectedVersion}
                          onChange={(e) => { c.setSelectedVersion(e.target.value); c.resetCompatibility(); }}
                          className="text-[10px] font-black text-blue-600 bg-blue-100 dark:bg-blue-900/40 px-2 py-0.5 rounded-md uppercase tracking-widest outline-none border-none cursor-pointer"
                        >
                          {(c.result.version_list || [c.result.info.version]).map(v => (<option key={v} value={v}>v{v}</option>))}
                        </select>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">by {c.result.info.author || "Unknown"}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button onClick={c.checkingConflicts ? c.cancelConflictCheck : c.checkConflicts} disabled={c.installing}
                      className={cn(
                        "flex items-center justify-center gap-3 bg-white dark:bg-slate-800 border-2 px-6 py-3 rounded-2xl font-black text-sm uppercase tracking-tighter active:scale-95 transition-all disabled:opacity-50",
                        c.checkingConflicts
                          ? "border-red-200 dark:border-red-900/40 text-red-500"
                          : "vo-secondary-action"
                      )}>
                      {c.checkingConflicts ? <X size={18} /> : <Activity size={18} className="text-blue-600" />}
                      {c.checkingConflicts ? "Cancel Check" : "Check Compatibility"}
                    </button>
                    <button onClick={c.installing ? c.cancelInstall : c.installPypi} disabled={c.checkingConflicts || c.installingElevated}
                      className="vo-primary-action flex items-center justify-center gap-3 disabled:bg-slate-400 px-8 py-3 rounded-2xl text-sm shadow-lg shadow-blue-600/20">
                      {c.installing ? <X size={18} /> : <Plus size={18} />}
                      {c.installing ? "Cancel Install" : "Install"}
                    </button>
                    {c.pendingElevation && (
                      <button onClick={c.runInstallElevated} disabled={c.installingElevated || c.installing}
                        className="flex items-center justify-center gap-3 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-400 text-white px-6 py-3 rounded-2xl font-black text-sm uppercase tracking-tighter shadow-lg shadow-amber-500/20 active:scale-95 transition-all"
                        title={isWindows ? "Triggers a UAC prompt" : "Opens a terminal with sudo"}>
                        {c.installingElevated ? <Loader2 size={18} className="animate-spin" /> : <ShieldAlert size={18} />}
                        {c.installingElevated ? (isWindows ? "Waiting UAC..." : "Opening sudo...") : (isWindows ? "Retry as Admin" : "Retry with sudo")}
                      </button>
                    )}
                  </div>
                </div>

                {c.isCompatible !== null && (
                  <div className={cn(
                    "p-4 rounded-2xl border flex items-start gap-4 animate-in slide-in-from-top-2",
                    c.isCompatible ? "bg-green-50 border-green-200 text-green-700" : "bg-red-50 border-red-200 text-red-700"
                  )}>
                    {c.isCompatible ? <Check size={20} className="shrink-0" /> : <AlertCircle size={20} className="shrink-0" />}
                    <div className="space-y-3 min-w-0 flex-1">
                      <p className="text-xs font-black uppercase tracking-widest">
                        {c.isCompatible ? "Compatible Environment" : "Potential Conflicts Detected"}
                      </p>
                      {c.installImpact && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                          <ImpactBucket label="Would install" items={c.installImpact.installs} tone="green" />
                          <ImpactBucket label="Would upgrade" items={c.installImpact.upgrades} tone="blue" />
                          <ImpactBucket label="Would remove" items={c.installImpact.uninstalls} tone="red" />
                        </div>
                      )}
                      {c.installImpact && c.installImpact.installs.length + c.installImpact.upgrades.length + c.installImpact.uninstalls.length === 0 ? (
                        <p className="text-[10px] font-bold uppercase tracking-widest opacity-80">
                          Dry-run completed, but no package delta was reported by the resolver.
                        </p>
                      ) : null}
                      {!c.isCompatible && (
                        <p className="text-[10px] font-medium leading-relaxed opacity-80 whitespace-pre-wrap font-mono max-h-32 overflow-y-auto">
                          {c.conflictReport || "This version may cause issues with your existing dependencies."}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                <div className="space-y-4">
                  <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed font-medium">
                    {c.result.info.summary || "No description provided for this package."}
                  </p>
                  {c.result.info.home_page && (
                    <a href={c.result.info.home_page} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-2 text-xs font-bold text-blue-600 hover:underline">
                      <ExternalLink size={14} /> Official Documentation
                    </a>
                  )}
                </div>
              </div>
            ) : !c.searching && c.query && (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-4 opacity-50">
                <Package size={48} strokeWidth={1} />
                <p className="text-xs font-bold uppercase tracking-widest">Search for a package above</p>
              </div>
            )}
          </>
        )}

        {c.tab === "git" && (
          <SimpleSourcePanel
            description="Install directly from a Git repository. URL is normalized to pip's `git+` form automatically."
            primary={
              <input value={c.gitUrl} onChange={(e) => c.setGitUrl(e.target.value)}
                placeholder="https://github.com/user/repo.git or git+ssh://git@..."
                className="vo-control w-full border-2 rounded-2xl py-3 px-5 font-medium" />
            }
            extras={
              <div className="grid grid-cols-2 gap-3">
                <input value={c.gitRef} onChange={(e) => c.setGitRef(e.target.value)} placeholder="branch / tag / SHA (optional)"
                  className="vo-control border rounded-xl py-2 px-3 text-xs" />
                <input value={c.gitSubdir} onChange={(e) => c.setGitSubdir(e.target.value)} placeholder="subdirectory (optional)"
                  className="vo-control border rounded-xl py-2 px-3 text-xs" />
              </div>
            }
            installLabel="Install from Git"
            installDisabled={!c.gitUrl.trim()}
            onInstall={c.installGit}
            installing={c.installing}
            installingElevated={c.installingElevated}
            onCancelInstall={c.cancelInstall}
            pendingElevation={!!c.pendingElevation}
            onInstallElevated={c.runInstallElevated}
          />
        )}

        {c.tab === "url" && (
          <SimpleSourcePanel
            description="Install from any pip-compatible URL - wheel hosted on a server, archive, or alternate VCS."
            primary={
              <input value={c.rawUrl} onChange={(e) => c.setRawUrl(e.target.value)}
                placeholder="https://example.com/path/to/package.whl"
                className="vo-control w-full border-2 rounded-2xl py-3 px-5 font-medium" />
            }
            installLabel="Install from URL"
            installDisabled={!c.rawUrl.trim()}
            onInstall={c.installUrl}
            installing={c.installing}
            installingElevated={c.installingElevated}
            onCancelInstall={c.cancelInstall}
            pendingElevation={!!c.pendingElevation}
            onInstallElevated={c.runInstallElevated}
          />
        )}

        {c.tab === "file" && (
          <SimpleSourcePanel
            description="Pick a wheel (.whl) or source distribution (.tar.gz, .zip) from disk."
            primary={
              <div className="flex items-center gap-3">
                <button onClick={c.pickFile} className="vo-secondary-action px-5 py-3 rounded-2xl text-xs">
                  Browse...
                </button>
                <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {c.filePath ?? "No file selected"}
                </span>
              </div>
            }
            installLabel="Install local file"
            installDisabled={!c.filePath}
            onInstall={c.installFile}
            installing={c.installing}
            installingElevated={c.installingElevated}
            onCancelInstall={c.cancelInstall}
            pendingElevation={!!c.pendingElevation}
            onInstallElevated={c.runInstallElevated}
          />
        )}

        {c.tab === "project" && (
          <SimpleSourcePanel
            description="Install a local project directory containing pyproject.toml or setup.py. Editable mode (-e) is the standard for development."
            primary={
              <div className="flex items-center gap-3">
                <button onClick={c.pickProject} className="vo-secondary-action px-5 py-3 rounded-2xl text-xs">
                  Browse folder...
                </button>
                <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {c.projectPath ?? "No folder selected"}
                </span>
              </div>
            }
            extras={
              <label className="flex items-center gap-2 text-[11px] font-bold text-slate-600 dark:text-slate-400 select-none cursor-pointer">
                <input type="checkbox" checked={c.editable} onChange={(e) => c.setEditable(e.target.checked)} className="accent-blue-600" />
                Editable install (-e) - picks up source changes without reinstalling
              </label>
            }
            installLabel="Install project"
            installDisabled={!c.projectPath}
            onInstall={c.installProject}
            installing={c.installing}
            installingElevated={c.installingElevated}
            onCancelInstall={c.cancelInstall}
            pendingElevation={!!c.pendingElevation}
            onInstallElevated={c.runInstallElevated}
          />
        )}
      </div>
    </div>
  );
};

interface SimpleSourcePanelProps {
  description: string;
  primary: React.ReactNode;
  extras?: React.ReactNode;
  installLabel: string;
  installDisabled: boolean;
  installing: boolean;
  installingElevated: boolean;
  pendingElevation: boolean;
  onInstall: () => void;
  onCancelInstall: () => void;
  onInstallElevated: () => void;
}

const SimpleSourcePanel: React.FC<SimpleSourcePanelProps> = ({
  description, primary, extras, installLabel, installDisabled,
  installing, installingElevated, pendingElevation, onInstall, onCancelInstall, onInstallElevated
}) => (
  <div className="space-y-5">
    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{description}</p>
    {primary}
    {extras}
    <div className="flex flex-wrap gap-2">
      <button onClick={installing ? onCancelInstall : onInstall} disabled={installDisabled || installingElevated}
        className="vo-primary-action flex items-center justify-center gap-3 disabled:bg-slate-400 px-8 py-3 rounded-2xl text-sm shadow-lg shadow-blue-600/20">
        {installing ? <X size={18} /> : <Plus size={18} />}
        {installing ? "Cancel install" : installLabel}
      </button>
      {pendingElevation && (
        <button onClick={onInstallElevated} disabled={installingElevated || installing}
          className="flex items-center justify-center gap-3 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-400 text-white px-6 py-3 rounded-2xl font-black text-sm uppercase tracking-tighter shadow-lg shadow-amber-500/20 active:scale-95 transition-all"
          title={isWindows ? "Triggers a UAC prompt" : "Opens a terminal with sudo"}>
          {installingElevated ? <Loader2 size={18} className="animate-spin" /> : <ShieldAlert size={18} />}
          {installingElevated ? (isWindows ? "Waiting UAC..." : "Opening sudo...") : (isWindows ? "Retry as Admin" : "Retry with sudo")}
        </button>
      )}
    </div>
  </div>
);
