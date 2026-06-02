import { Suspense, lazy, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Activity, BookmarkPlus, Bot, Box, GitCompare, Globe, HardDrive, Loader2, PackageCheck, X, Zap } from "lucide-react";
import { STUDIO_TABS } from "../constants/ui";
import { Script, StudioTabId, VenvDetails, VenvInfo } from "../types";
import { cn } from "../utils/cn";
import { assessEnvironmentHealth } from "../utils/envHealth";
import { isReadOnlyManager, readOnlyManagerLabel } from "../utils/venvManagers";

const StudioPackages = lazy(() => import("./Studio/StudioPackages").then((m) => ({ default: m.StudioPackages })));
const StudioAutomation = lazy(() => import("./Studio/StudioAutomation").then((m) => ({ default: m.StudioAutomation })));
const StudioConfig = lazy(() => import("./Studio/StudioConfig").then((m) => ({ default: m.StudioConfig })));
const StudioDiagnostics = lazy(() => import("./Studio/StudioDiagnostics").then((m) => ({ default: m.StudioDiagnostics })));
const StudioDeploy = lazy(() => import("./Studio/StudioDeploy").then((m) => ({ default: m.StudioDeploy })));
const StudioLockfile = lazy(() => import("./Studio/StudioLockfile").then((m) => ({ default: m.StudioLockfile })));
const StudioRepair = lazy(() => import("./Studio/StudioRepair").then((m) => ({ default: m.StudioRepair })));

interface StudioModalProps {
  selectedVenv: VenvInfo;
  venvDetails: VenvDetails | null;
  studioTab: StudioTabId | "deploy";
  setStudioTab: (tab: StudioTabId | "deploy") => void;
  scripts: Script[];
  envContent: string;
  setEnvContent: (content: string) => void;
  pyvenvCfg: string;
  onClose: () => void;
  onCompare: (venv: VenvInfo) => void;
  onSaveTemplate: () => void;
  reloadStudio: (venv: VenvInfo) => void;
  onSync: (path: string) => Promise<void>;
  setMessage: (message: string) => void;
}

export const StudioModal: React.FC<StudioModalProps> = ({
  selectedVenv,
  venvDetails,
  studioTab,
  setStudioTab,
  scripts,
  envContent,
  setEnvContent,
  pyvenvCfg,
  onClose,
  onCompare,
  onSaveTemplate,
  reloadStudio,
  onSync,
  setMessage
}) => {
  const [effectiveDetails, setEffectiveDetails] = useState<VenvDetails | null>(venvDetails);

  useEffect(() => {
    setEffectiveDetails(venvDetails);
  }, [selectedVenv.path, venvDetails]);

  return (
  <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-50 flex items-center justify-center p-8 transition-all">
    <div className="vo-surface w-full h-full rounded-[2rem] border shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
      <div className="vo-panel p-6 border-b flex items-center justify-between select-none">
        <div className="flex items-center gap-6">
          <div className="p-4 bg-blue-600 text-white rounded-2xl shadow-lg"><Box size={32} /></div>
          <div>
            <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{selectedVenv.name}</h2>
            <div className="flex items-center gap-2">
              <p className="text-xs font-mono text-slate-400">{selectedVenv.path}</p>
              <span className="text-[9px] px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 rounded-md font-black uppercase tracking-widest">{selectedVenv.manager_type} Engine</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              try {
                await invoke("open_terminal_activated", { path: selectedVenv.path });
              } catch (err) {
                setMessage(`${err}`);
              }
            }}
            className="flex items-center gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded-xl border border-amber-100 dark:border-amber-800 text-xs font-black uppercase hover:bg-amber-500 hover:text-white transition-all"
            title="Open a terminal with this venv activated"
          >
            <Zap size={16} /> Activate
          </button>
          <button
            onClick={() => onCompare(selectedVenv)}
            className="vo-secondary-action flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase transition-all"
            title="Compare this venv with another"
          >
            <GitCompare size={16} /> Compare
          </button>
          <button onClick={onSaveTemplate} className="flex items-center gap-2 px-4 py-2 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl border border-blue-100 dark:border-blue-800 text-xs font-black uppercase hover:bg-blue-600 hover:text-white transition-all">
            <BookmarkPlus size={16} /> Save as Template
          </button>
          <button onClick={onClose} className="vo-icon-button bg-white dark:bg-slate-800 rounded-2xl transition-all shadow-sm">
            <X size={24} />
          </button>
        </div>
      </div>
      <div className="vo-surface flex px-6 border-b select-none overflow-x-auto">
        {[...STUDIO_TABS, { id: "deploy" as const, label: "Deploy", icon: Globe }].map(tab => {
          const TabIcon = tab.icon;
          return <button key={tab.id} onClick={() => setStudioTab(tab.id)} className={cn("flex items-center gap-2 px-6 py-4 text-xs font-black uppercase tracking-widest border-b-2 transition-all", studioTab === tab.id ? "border-blue-600 text-blue-600 bg-blue-50/10" : "border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-200")}><TabIcon size={16} /> {tab.label}</button>;
        })}
      </div>
      <div className="vo-app-bg flex-1 overflow-y-auto p-8 scrollbar-thin">
        {studioTab === "packages" && (
          <EnvironmentBrief
            venv={selectedVenv}
            details={effectiveDetails}
            onOpenRepair={() => setStudioTab("repair")}
            onOpenDiagnostics={() => setStudioTab("diagnostics")}
            onOpenLock={() => setStudioTab("lock")}
            onOpenPackages={() => setStudioTab("packages")}
          />
        )}
        <Suspense fallback={<StudioTabFallback />}>
          {studioTab === "packages" && (
            <StudioPackages
              venv={selectedVenv}
              details={effectiveDetails}
              refresh={() => reloadStudio(selectedVenv)}
              setMessage={setMessage}
              onDetailsChange={setEffectiveDetails}
            />
          )}
          {studioTab === "automation" && <StudioAutomation venv={selectedVenv} scripts={scripts} refreshScripts={() => reloadStudio(selectedVenv)} setMessage={setMessage} />}
          {studioTab === "config" && <StudioConfig venv={selectedVenv} envContent={envContent} setEnvContent={setEnvContent} pyvenvCfg={pyvenvCfg} setMessage={setMessage} />}
          {studioTab === "diagnostics" && <StudioDiagnostics venv={selectedVenv} />}
          {studioTab === "lock" && <StudioLockfile venv={selectedVenv} setMessage={setMessage} />}
          {studioTab === "repair" && <StudioRepair venv={selectedVenv} setStudioTab={setStudioTab} onSync={onSync} reloadStudio={reloadStudio} setMessage={setMessage} />}
          {studioTab === "deploy" && <StudioDeploy venv={selectedVenv} setMessage={setMessage} />}
        </Suspense>
      </div>
    </div>
  </div>
  );
};

const StudioTabFallback = () => (
  <div className="flex items-center justify-center py-24 gap-3 text-slate-400">
    <Loader2 size={24} className="animate-spin text-blue-600" />
    <span className="text-[10px] font-black uppercase tracking-widest">Loading Studio panel...</span>
  </div>
);

const formatSize = (sizeMb: number | undefined): string => {
  if (!sizeMb || sizeMb <= 0) return "Unknown";
  if (sizeMb >= 1024) return `${(sizeMb / 1024).toFixed(1)} GB`;
  return `${sizeMb.toFixed(1)} MB`;
};

const explainEnvironment = (venv: VenvInfo, details: VenvDetails | null): { summary: string; nextStep: string; actionLabel: string; actionTab: StudioTabId | "deploy" } => {
  const health = assessEnvironmentHealth(venv);
  const packageCount = details?.packages.length ?? 0;
  const sizeMb = details?.size_mb ?? 0;

  if (health.primaryAction === "delete_stale") {
    return {
      summary: "The database entry points to a missing environment path. Package, diagnostics and automation actions are unsafe until the stale entry is removed or the environment is recreated.",
      nextStep: "Open Repair and remove the stale database entry.",
      actionLabel: "Remove stale entry",
      actionTab: "repair"
    };
  }

  if (health.primaryAction === "sync") {
    return {
      summary: "External filesystem changes were detected. Refresh this environment before making package, lockfile or repair decisions.",
      nextStep: "Open Repair and sync the environment metadata.",
      actionLabel: "Sync in Repair",
      actionTab: "repair"
    };
  }

  if (health.tone === "red") {
    return {
      summary: "This environment is broken. Treat diagnostics and package actions as unreliable until the root issue is repaired.",
      nextStep: "Open Repair and run the safest recommended action first.",
      actionLabel: "Repair first",
      actionTab: "repair"
    };
  }

  if (isReadOnlyManager(venv.manager_type)) {
    const label = readOnlyManagerLabel(venv.manager_type);
    return {
      summary: `${label} environment detected. VOrchestra can inventory packages, size, tree and diagnostics, but package mutations stay read-only to avoid fighting the native manager.`,
      nextStep: `Use VOrchestra for visibility and use ${label} for package changes.`,
      actionLabel: "Open Packages",
      actionTab: "packages"
    };
  }

  if (packageCount === 0) {
    return {
      summary: "No installed packages were detected. This may be a fresh environment, a failed template install or an environment missing pip metadata.",
      nextStep: "Open Packages to install dependencies or Repair to check missing tooling.",
      actionLabel: "Open Packages",
      actionTab: "packages"
    };
  }

  if (sizeMb >= 1024) {
    return {
      summary: "This environment is large enough to review for cleanup, duplicate wheels or stale dependencies before it grows further.",
      nextStep: "Open Packages for large packages or Diagnostics for cleanup signals.",
      actionLabel: "Run Diagnostics",
      actionTab: "diagnostics"
    };
  }

  if (venv.manager_type === "pip") {
    return {
      summary: "This environment is usable, but pip-managed. uv can improve install speed, lockfile workflows and repeatable project sync.",
      nextStep: "Keep using it, or rebuild from project with uv when reproducibility matters.",
      actionLabel: "Review Lockfile",
      actionTab: "lock"
    };
  }

  return {
    summary: "Ready for normal package, automation and project operations.",
    nextStep: "Use Packages, Automation or Diagnostics based on the next project task.",
    actionLabel: "Open Packages",
    actionTab: "packages"
  };
};

const classifyEnvironmentProfile = (venv: VenvInfo, details: VenvDetails | null): { label: string; detail: string } => {
  const health = assessEnvironmentHealth(venv);
  const packageCount = details?.packages.length ?? 0;
  const sizeMb = details?.size_mb ?? 0;

  if (health.tone === "red") {
    return {
      label: "Recovery candidate",
      detail: "Prioritize repair actions before package or automation work."
    };
  }
  if (health.primaryAction === "sync") {
    return {
      label: "Maintenance needed",
      detail: "Metadata is stale compared with the filesystem."
    };
  }
  if (isReadOnlyManager(venv.manager_type)) {
    const label = readOnlyManagerLabel(venv.manager_type);
    return {
      label: `${label} read-only inventory`,
      detail: "VOrchestra avoids mutating packages managed by external environment tools."
    };
  }
  if (packageCount === 0) {
    return {
      label: "Bootstrap candidate",
      detail: "Likely new, empty or missing package metadata."
    };
  }
  if (sizeMb >= 1024) {
    return {
      label: "Cleanup candidate",
      detail: "Large enough to review package size and cache impact."
    };
  }
  if (venv.manager_type === "uv") {
    return {
      label: "Project-ready uv environment",
      detail: "Best fit for sync, lockfile and repeatable workflows."
    };
  }
  return {
    label: "Classic pip environment",
    detail: "Usable inventory with optional migration to uv when reproducibility matters."
  };
};

const EnvironmentBrief: React.FC<{
  venv: VenvInfo;
  details: VenvDetails | null;
  onOpenRepair: () => void;
  onOpenDiagnostics: () => void;
  onOpenLock: () => void;
  onOpenPackages: () => void;
}> = ({ venv, details, onOpenRepair, onOpenDiagnostics, onOpenLock, onOpenPackages }) => {
  const health = assessEnvironmentHealth(venv);
  const packageCount = details?.packages.length ?? 0;
  const sizeMb = details?.size_mb ?? 0;
  const explanation = explainEnvironment(venv, details);
  const profile = classifyEnvironmentProfile(venv, details);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiOutput, setAiOutput] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const productSignals = [
    ...health.signals.map(signal => signal.label),
    packageCount === 0 ? "No installed packages detected yet" : null,
    sizeMb >= 1024 ? "Large environment, review cleanup opportunities" : null
  ].filter(Boolean).slice(0, 3);
  const runPrimaryAction = () => {
    if (explanation.actionTab === "repair") onOpenRepair();
    else if (explanation.actionTab === "diagnostics") onOpenDiagnostics();
    else if (explanation.actionTab === "lock") onOpenLock();
    else onOpenPackages();
  };

  const explainWithLocalAi = async () => {
    setAiBusy(true);
    setAiError(null);
    setAiOutput(null);
    try {
      const context = [
        `Name: ${venv.name}`,
        `Path: ${venv.path}`,
        `Python: ${venv.version}`,
        `Status: ${venv.status}`,
        `Issue: ${venv.issue || "none"}`,
        `Manager: ${venv.manager_type}`,
        `Template: ${venv.template_name || "custom"}`,
        `Health: ${health.score}/100 - ${health.label}`,
        `Package count: ${packageCount}`,
        `Size MB: ${sizeMb.toFixed(1)}`,
        `Current explanation: ${explanation.summary}`,
        `Next step: ${explanation.nextStep}`,
        `Signals: ${productSignals.join(", ") || "none"}`,
        `Packages sample: ${(details?.packages || []).slice(0, 40).join(", ") || "none"}`
      ].join("\n");
      const status = await invoke<{ available: boolean; models: string[]; error: string | null }>("check_local_ai_status");
      if (!status.available) {
        setAiError(status.error || "Local AI is unavailable. Start Ollama and install a model such as llama3.2.");
        return;
      }
      const model = status.models[0] || "llama3.2";
      const output = await invoke<string>("explain_environment_with_local_ai", { context, model });
      setAiOutput(output);
    } catch (err) {
      setAiError(`${err}`);
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <section className="vo-surface mb-6 rounded-[2rem] border shadow-sm overflow-hidden">
      <div className="grid grid-cols-1 xl:grid-cols-[260px_1fr_auto] gap-5 p-5">
        <div className={cn(
          "rounded-[1.5rem] p-5 border",
          health.tone === "green" && "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-100 dark:border-emerald-900/30",
          health.tone === "amber" && "bg-amber-50 dark:bg-amber-950/20 border-amber-100 dark:border-amber-900/30",
          health.tone === "red" && "bg-red-50 dark:bg-red-950/20 border-red-100 dark:border-red-900/30"
        )}>
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 flex items-center gap-2">
            <Activity size={13} /> Environment Brief
          </p>
          <div className="mt-3 flex items-end gap-2">
            <span className="text-4xl font-black tabular-nums text-slate-900 dark:text-white">{health.score}</span>
            <span className="mb-1 text-[10px] font-black uppercase tracking-widest text-slate-400">health</span>
          </div>
          <p className="mt-1 text-xs font-black text-slate-700 dark:text-slate-200">{health.label}</p>
        </div>

        <div className="space-y-4">
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Explain this environment</p>
            <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">{explanation.summary}</p>
            <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-300">
              Next: {explanation.nextStep}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={explainWithLocalAi}
                disabled={aiBusy}
                className="vo-secondary-action inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-[9px] disabled:opacity-50"
              >
                {aiBusy ? <Loader2 size={12} className="animate-spin" /> : <Bot size={12} />}
                {aiBusy ? "Asking local AI..." : "Explain with local AI"}
              </button>
              <span className="text-[9px] font-bold text-slate-400">
                Ollama only. Localhost, no telemetry.
              </span>
            </div>
            {aiError && (
              <p className="mt-2 rounded-xl bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                {aiError}
              </p>
            )}
            {aiOutput && (
              <div className="mt-3 rounded-2xl border border-blue-100 dark:border-blue-900/30 bg-blue-50/70 dark:bg-blue-950/20 px-4 py-3">
                <p className="text-[9px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300">Local AI analysis</p>
                <p className="mt-2 whitespace-pre-wrap text-xs font-semibold leading-relaxed text-slate-700 dark:text-slate-200">{aiOutput}</p>
              </div>
            )}
          </div>
          <div className="vo-subpanel rounded-2xl border px-4 py-3">
            <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">Environment profile</p>
            <p className="mt-1 text-xs font-black text-slate-800 dark:text-slate-100">{profile.label}</p>
            <p className="mt-1 text-[10px] font-bold text-slate-500 dark:text-slate-400">{profile.detail}</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <BriefMetric icon={<PackageCheck size={14} />} label="Packages" value={packageCount ? String(packageCount) : "Unknown"} />
            <BriefMetric icon={<HardDrive size={14} />} label="Size" value={formatSize(sizeMb)} />
            <BriefMetric icon={<Zap size={14} />} label="Engine" value={venv.manager_type} />
            <BriefMetric icon={<Activity size={14} />} label="Status" value={venv.status} />
          </div>
          {productSignals.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {productSignals.map(signal => (
                <span key={signal} className="rounded-full bg-slate-100 dark:bg-slate-800 px-3 py-1 text-[10px] font-bold text-slate-500 dark:text-slate-300">
                  {signal}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex xl:flex-col gap-2">
          <button onClick={runPrimaryAction} className="vo-primary-action px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all">
            {explanation.actionLabel}
          </button>
          <button onClick={onOpenRepair} className="vo-secondary-action px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all">
            Repair
          </button>
          <button onClick={onOpenDiagnostics} className="vo-secondary-action px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all">
            Diagnose
          </button>
          <button onClick={onOpenLock} className="vo-secondary-action px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all">
            Lock
          </button>
        </div>
      </div>
    </section>
  );
};

const BriefMetric: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
  <div className="vo-subpanel rounded-xl border px-3 py-2">
    <p className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-slate-400">{icon}{label}</p>
    <p className="mt-1 truncate text-xs font-black text-slate-700 dark:text-slate-200">{value}</p>
  </div>
);
