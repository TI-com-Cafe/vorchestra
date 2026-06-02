import React, { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, Box, CheckCircle2, Code2, Download, Loader2, Lock, RefreshCcw, ShieldCheck, Terminal, Trash2, TreePine, Wrench } from "lucide-react";

import { VenvInfo, StudioTabId, VscodeInterpreterStatus } from "../../types";
import { assessEnvironmentHealth } from "../../utils/envHealth";
import { packageService } from "../../services/packageManager";
import { waitForBackgroundJob } from "../../services/backgroundJobs";
import { cn } from "../../utils/cn";
import { dbService } from "../../services/db";
import { isReadOnlyManager, readOnlyManagerLabel } from "../../utils/venvManagers";

interface StudioRepairProps {
  venv: VenvInfo;
  setStudioTab: (tab: StudioTabId | "deploy") => void;
  onSync: (path: string) => Promise<void>;
  reloadStudio: (venv: VenvInfo) => void;
  setMessage: (message: string) => void;
}

type RepairStepId = "sync" | "pip" | "rebuild" | "stale_entry" | "project_sync" | "lock" | "pipdeptree" | "pipaudit" | "vscode" | "terminal" | "diagnostics";

interface RepairStep {
  id: RepairStepId;
  title: string;
  description: string;
  actionLabel: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  tone: "blue" | "amber" | "green";
  recommended: boolean;
  run: () => Promise<void>;
}

interface VenvSetupResult {
  venv_path: string;
  installed: string[];
}

interface RebuildSourcePreview {
  kind: string;
  label: string;
  path: string;
  package_count: number;
  note: string;
}

const projectRootForVenv = (venvPath: string): string => {
  const parts = venvPath.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 1) return venvPath;
  const rootParts = parts.slice(0, -1);
  const prefix = venvPath.startsWith("/") ? "/" : "";
  return `${prefix}${rootParts.join("/")}`;
};

const hasPipIssue = (venv: VenvInfo): boolean =>
  /no module named pip|pip not installed|missing pip|without pip/i.test(venv.issue || "");

export const StudioRepair: React.FC<StudioRepairProps> = ({ venv, setStudioTab, onSync, reloadStudio, setMessage }) => {
  const [busyStep, setBusyStep] = useState<RepairStepId | null>(null);
  const [stepStatus, setStepStatus] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [stepJobs, setStepJobs] = useState<Partial<Record<RepairStepId, string>>>({});
  const [vscodeStatus, setVscodeStatus] = useState<VscodeInterpreterStatus | null>(null);
  const [rebuildPreview, setRebuildPreview] = useState<RebuildSourcePreview | null>(null);
  const [loadingRebuildPreview, setLoadingRebuildPreview] = useState(false);
  const [loadingVscodeStatus, setLoadingVscodeStatus] = useState(false);
  const [exportingSupport, setExportingSupport] = useState(false);
  const health = assessEnvironmentHealth(venv);
  const readOnlyManager = isReadOnlyManager(venv.manager_type);
  const readOnlyManagerName = readOnlyManagerLabel(venv.manager_type);

  const loadVscodeStatus = useCallback(async () => {
    setLoadingVscodeStatus(true);
    try {
      const status = await invoke<VscodeInterpreterStatus>("get_vscode_interpreter_status", { venvPath: venv.path });
      setVscodeStatus(status);
    } catch (err) {
      setVscodeStatus({
        settings_path: "",
        exists: false,
        expected_interpreter: "",
        configured_interpreter: null,
        terminal_activation: null,
        env_file: null,
        in_sync: false,
        issue: `${err}`
      });
    } finally {
      setLoadingVscodeStatus(false);
    }
  }, [venv.path]);

  useEffect(() => {
    void loadVscodeStatus();
  }, [loadVscodeStatus]);

  const loadRebuildPreview = useCallback(async () => {
    setLoadingRebuildPreview(true);
    try {
      const preview = await invoke<RebuildSourcePreview>("get_rebuild_source_preview", {
        venvPath: venv.path,
        engine: venv.manager_type
      });
      setRebuildPreview(preview);
    } catch (err) {
      setRebuildPreview({
        kind: "unknown",
        label: "source unavailable",
        path: projectRootForVenv(venv.path),
        package_count: 0,
        note: `Could not inspect rebuild source: ${err}`
      });
    } finally {
      setLoadingRebuildPreview(false);
    }
  }, [venv.manager_type, venv.path]);

  useEffect(() => {
    void loadRebuildPreview();
  }, [loadRebuildPreview]);

  const runStep = async (step: RepairStep) => {
    setBusyStep(step.id);
    setStepStatus(prev => ({ ...prev, [step.id]: { ok: true, message: "Running..." } }));
    try {
      await step.run();
    } catch (err) {
      setStepStatus(prev => ({ ...prev, [step.id]: { ok: false, message: `${err}` } }));
    } finally {
      setBusyStep(null);
      setStepJobs(prev => {
        const next = { ...prev };
        delete next[step.id];
        return next;
      });
    }
  };

  const cancelStep = async (step: RepairStep, jobId: string) => {
    try {
      await invoke<boolean>("cancel_background_job", { jobId });
      setStepStatus(prev => ({ ...prev, [step.id]: { ok: true, message: "Cancellation requested." } }));
      setMessage(`${step.title} cancellation requested.`);
    } catch (err) {
      setStepStatus(prev => ({ ...prev, [step.id]: { ok: false, message: `Cancel failed: ${err}` } }));
    }
  };

  const steps = useMemo<RepairStep[]>(() => [
    {
      id: "sync",
      title: "Re-sync environment inventory",
      description: "Refreshes packages, size and database metadata after external changes or manual terminal operations.",
      actionLabel: "Sync now",
      icon: RefreshCcw,
      tone: "blue",
      recommended: !!venv.is_outdated || health.primaryAction === "sync",
      run: async () => {
        await onSync(venv.path);
        reloadStudio(venv);
        setStepStatus(prev => ({ ...prev, sync: { ok: true, message: "Sync requested." } }));
      }
    },
    {
      id: "pip",
      title: "Install missing pip",
      description: readOnlyManager
        ? `${readOnlyManagerName} environments are read-only in VOrchestra. Use the native manager if pip support is needed.`
        : "Runs `python -m ensurepip --upgrade` inside this environment, then verifies `python -m pip --version`.",
      actionLabel: readOnlyManager ? "Native manager only" : "Install pip",
      icon: Wrench,
      tone: readOnlyManager ? "blue" : "amber",
      recommended: !readOnlyManager && hasPipIssue(venv),
      run: async () => {
        if (readOnlyManager) {
          setStepStatus(prev => ({ ...prev, pip: { ok: true, message: "Use the native manager to add pip support." } }));
          return;
        }
        const jobId = await invoke<string>("start_install_pip_in_venv_job", { venvPath: venv.path });
        setStepJobs(prev => ({ ...prev, pip: jobId }));
        const out = await waitForBackgroundJob<string>(jobId, (snapshot) => {
          if (snapshot.message) setStepStatus(prev => ({ ...prev, pip: { ok: true, message: snapshot.message ?? "Installing pip..." } }));
        });
        const scanJobId = await invoke<string>("start_scan_venv_job", { path: venv.path });
        setStepJobs(prev => ({ ...prev, pip: scanJobId }));
        const repaired = await waitForBackgroundJob<VenvInfo>(scanJobId);
        await dbService.updateSingleVenv(venv.path, repaired);
        reloadStudio(repaired);
        setStepStatus(prev => ({ ...prev, pip: { ok: true, message: out || "pip installed." } }));
        setMessage("pip installed and environment metadata refreshed.");
      }
    },
    {
      id: "pipdeptree",
      title: "Install dependency tree tool",
      description: readOnlyManager
        ? `${readOnlyManagerName} environments are read-only in VOrchestra. Open Packages and use the Tree/Graph views for native pipdeptree guidance.`
        : "Installs pipdeptree in this environment so the Tree and Graph package views can resolve dependency hierarchy.",
      actionLabel: readOnlyManager ? "Open packages" : "Install pipdeptree",
      icon: TreePine,
      tone: readOnlyManager ? "blue" : "green",
      recommended: false,
      run: async () => {
        if (readOnlyManager) {
          setStudioTab("packages");
          setStepStatus(prev => ({ ...prev, pipdeptree: { ok: true, message: "Packages opened with native manager guidance." } }));
          return;
        }
        const out = await packageService.install(venv, "pipdeptree");
        setStepStatus(prev => ({ ...prev, pipdeptree: { ok: true, message: out || "pipdeptree installed." } }));
        setMessage("pipdeptree installed.");
      }
    },
    {
      id: "rebuild",
      title: "Rebuild from project manifests",
      description: readOnlyManager
        ? `${readOnlyManagerName} environments are read-only in VOrchestra. Recreate or sync them with the native manager to preserve environment semantics.`
        : "Moves the current environment to recoverable trash, recreates it with the same engine, then restores from requirements.lock, uv.lock, requirements.txt, or detected project manifests in that order.",
      actionLabel: readOnlyManager ? "Native manager only" : "Rebuild environment",
      icon: Wrench,
      tone: readOnlyManager ? "blue" : "amber",
      recommended: !readOnlyManager && health.primaryAction === "repair",
      run: async () => {
        if (readOnlyManager) {
          setStepStatus(prev => ({ ...prev, rebuild: { ok: true, message: "Use the native manager to rebuild this environment." } }));
          return;
        }
        const jobId = await invoke<string>("start_rebuild_venv_from_project_job", {
          venvPath: venv.path,
          engine: venv.manager_type,
          pythonBin: null
        });
        setStepJobs(prev => ({ ...prev, rebuild: jobId }));
        const result = await waitForBackgroundJob<VenvSetupResult>(jobId, (snapshot) => {
          if (snapshot.message) setStepStatus(prev => ({ ...prev, rebuild: { ok: true, message: snapshot.message ?? "Rebuilding..." } }));
        });
        const scanJobId = await invoke<string>("start_scan_venv_job", { path: result.venv_path });
        setStepJobs(prev => ({ ...prev, rebuild: scanJobId }));
        const rebuilt = await waitForBackgroundJob<VenvInfo>(scanJobId);
        await dbService.addSingleVenv(projectRootForVenv(result.venv_path), rebuilt);
        reloadStudio(rebuilt);
        setStepStatus(prev => ({ ...prev, rebuild: { ok: true, message: `Rebuilt with ${result.installed.length} package(s).` } }));
        setMessage(`Rebuilt ${rebuilt.name} with ${result.installed.length} package(s).`);
      }
    },
    ...(health.primaryAction === "delete_stale" ? [{
      id: "stale_entry" as const,
      title: "Remove stale database entry",
      description: "Removes only the VOrchestra inventory record for this missing path. The environment folder is already absent, so no files are deleted.",
      actionLabel: "Remove stale entry",
      icon: Trash2,
      tone: "amber" as const,
      recommended: true,
      run: async () => {
        await dbService.removeVenvByPath(venv.path);
        setStepStatus(prev => ({ ...prev, stale_entry: { ok: true, message: "Stale database entry removed." } }));
        setMessage(`Removed stale entry for ${venv.name}.`);
      }
    }] : []),
    {
      id: "project_sync",
      title: "Sync from project manifests",
      description: "Opens Packages so you can run Sync Project from requirements.txt, pyproject.toml or uv project metadata before manual package changes.",
      actionLabel: "Open packages",
      icon: Box,
      tone: "blue",
      recommended: !!venv.is_outdated || venv.manager_type === "uv",
      run: async () => {
        setStudioTab("packages");
        setStepStatus(prev => ({ ...prev, project_sync: { ok: true, message: "Packages tab opened." } }));
      }
    },
    {
      id: "lock",
      title: "Review lockfile drift",
      description: "Opens Lockfile & Drift to compare this environment against requirements.lock before rebuilding or changing packages.",
      actionLabel: "Open lockfile",
      icon: Lock,
      tone: "blue",
      recommended: venv.status !== "Broken" && health.tone !== "green",
      run: async () => {
        setStudioTab("lock");
        setStepStatus(prev => ({ ...prev, lock: { ok: true, message: "Lockfile tab opened." } }));
      }
    },
    {
      id: "pipaudit",
      title: "Install security audit tool",
      description: readOnlyManager
        ? `${readOnlyManagerName} environments are read-only in VOrchestra. Open Diagnostics for the native pip-audit install command.`
        : "Installs pip-audit in this environment so Security Check can scan installed packages.",
      actionLabel: readOnlyManager ? "Open diagnostics" : "Install pip-audit",
      icon: ShieldCheck,
      tone: readOnlyManager ? "blue" : "green",
      recommended: false,
      run: async () => {
        if (readOnlyManager) {
          setStudioTab("diagnostics");
          setStepStatus(prev => ({ ...prev, pipaudit: { ok: true, message: "Diagnostics opened with native manager guidance." } }));
          return;
        }
        const out = await packageService.install(venv, "pip-audit");
        setStepStatus(prev => ({ ...prev, pipaudit: { ok: true, message: out || "pip-audit installed." } }));
        setMessage("pip-audit installed.");
      }
    },
    {
      id: "vscode",
      title: "Repair VS Code interpreter config",
      description: "Writes .vscode/settings.json for the project root using this environment as the selected interpreter.",
      actionLabel: "Generate config",
      icon: Code2,
      tone: "blue",
      recommended: !!vscodeStatus && !vscodeStatus.in_sync,
      run: async () => {
        const jobId = await invoke<string>("start_generate_vscode_config_job", { venvPath: venv.path });
        setStepJobs(prev => ({ ...prev, vscode: jobId }));
        const out = await waitForBackgroundJob<string>(jobId);
        setStepStatus(prev => ({ ...prev, vscode: { ok: true, message: out } }));
        setMessage(out);
        await loadVscodeStatus();
      }
    },
    {
      id: "terminal",
      title: "Open activated terminal",
      description: "Opens a terminal with the environment activated for manual checks such as ensurepip, custom scripts or framework commands.",
      actionLabel: "Open terminal",
      icon: Terminal,
      tone: "amber",
      recommended: false,
      run: async () => {
        await invoke("open_terminal_activated", { path: venv.path });
        setStepStatus(prev => ({ ...prev, terminal: { ok: true, message: "Activated terminal opened." } }));
      }
    },
    {
      id: "diagnostics",
      title: "Run guided diagnostics",
      description: "Switches to Diagnostics so you can run outdated-package checks and security scan only when needed.",
      actionLabel: "Open diagnostics",
      icon: Wrench,
      tone: "amber",
      recommended: health.tone !== "green",
      run: async () => {
        setStudioTab("diagnostics");
        setStepStatus(prev => ({ ...prev, diagnostics: { ok: true, message: "Diagnostics tab opened." } }));
      }
    }
  ], [health.primaryAction, health.tone, loadVscodeStatus, onSync, reloadStudio, setMessage, setStudioTab, venv, vscodeStatus]);

  const recommendedSteps = steps.filter(step => step.recommended);
  const orderedSteps = [...steps].sort((a, b) => Number(b.recommended) - Number(a.recommended));
  const primaryRecommendedStep = recommendedSteps[0] ?? null;

  const exportSupportBundle = async () => {
    const path = await saveDialog({
      defaultPath: `${venv.name}-support.json`,
      filters: [{ name: "VOrchestra support bundle", extensions: ["json"] }]
    });
    if (typeof path !== "string") return;

    setExportingSupport(true);
    try {
      const out = await invoke<string>("export_support_bundle", {
        venvPath: venv.path,
        outputPath: path
      });
      setMessage(out);
    } catch (err) {
      setMessage(`Support bundle export failed: ${err}`);
    } finally {
      setExportingSupport(false);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[340px_1fr] gap-6 animate-in fade-in duration-300">
      <aside className="vo-surface rounded-[2rem] border p-6 h-fit">
        <div className="flex items-center gap-3">
          <div className={cn(
            "p-3 rounded-2xl text-white shadow-lg",
            health.tone === "red" ? "bg-red-600" : health.tone === "amber" ? "bg-amber-500" : "bg-green-600"
          )}>
            {health.tone === "green" ? <CheckCircle2 size={22} /> : <AlertTriangle size={22} />}
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Environment Health</p>
            <h3 className="text-2xl font-black tabular-nums">{health.score}/100</h3>
          </div>
        </div>
        <p className="mt-4 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
          {health.label}. The repair wizard groups the safest next actions for this environment. It does not delete or recreate anything automatically.
        </p>
        <button
          onClick={exportSupportBundle}
          disabled={exportingSupport}
          className="mt-5 w-full flex items-center justify-center gap-2 rounded-2xl bg-slate-900 dark:bg-slate-100 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white dark:text-slate-900 disabled:opacity-50"
        >
          {exportingSupport ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {exportingSupport ? "Exporting..." : "Export Support Bundle"}
        </button>
        <p className="mt-2 text-[9px] text-slate-400 leading-relaxed">
          Includes package and project metadata for support. .env values are not exported.
        </p>
        <div className="vo-panel mt-3 rounded-2xl border p-3">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Bug report checklist</p>
          <p className="mt-1 text-[9px] leading-relaxed text-slate-500 dark:text-slate-400">
            Attach the support JSON with OS, action attempted, expected result and actual error. The bundle is sanitized and excludes .env values.
          </p>
        </div>
        <div className="mt-5 space-y-2">
          {health.signals.length === 0 ? (
            <div className="rounded-2xl border border-green-100 dark:border-green-900/40 bg-green-50 dark:bg-green-950/20 p-3 text-[10px] font-bold text-green-700 dark:text-green-300">
              No health signals require action right now.
            </div>
          ) : health.signals.map(signal => (
            <div key={signal.label} className="rounded-2xl border border-amber-100 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/20 p-3">
              <p className="text-[10px] font-black uppercase tracking-wider text-amber-700 dark:text-amber-300">{signal.label}</p>
              <p className="mt-1 text-[9px] text-slate-500">Score impact: -{signal.penalty}</p>
            </div>
          ))}
        </div>
      </aside>

      <section className="space-y-4">
        <VscodeDoctorCard
          status={vscodeStatus}
          loading={loadingVscodeStatus}
          onRefresh={loadVscodeStatus}
          onFix={() => {
            const step = steps.find(item => item.id === "vscode");
            if (step) void runStep(step);
          }}
          fixing={busyStep === "vscode"}
        />

        <RebuildSourceCard
          preview={rebuildPreview}
          loading={loadingRebuildPreview}
          onRefresh={loadRebuildPreview}
        />

        {readOnlyManager && (
          <NativeManagerRepairCard managerName={readOnlyManagerName} manager={venv.manager_type} />
        )}

        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-black uppercase tracking-widest">Repair Wizard</h3>
            <p className="text-[10px] text-slate-400">Recommended actions first. Use package/diagnostic tabs for deeper inspection.</p>
          </div>
          <span className="px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-300 text-[9px] font-black uppercase tracking-widest">
            {recommendedSteps.length} recommended
          </span>
        </div>

        <RepairSequenceCard
          recommendedSteps={recommendedSteps}
          primaryStep={primaryRecommendedStep}
          busy={busyStep !== null}
          onRunPrimary={() => {
            if (primaryRecommendedStep) void runStep(primaryRecommendedStep);
          }}
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {orderedSteps.map(step => (
            <RepairStepCard
              key={step.id}
              step={step}
              busy={busyStep === step.id}
              disabled={busyStep !== null && busyStep !== step.id}
              status={stepStatus[step.id]}
              jobId={stepJobs[step.id]}
              onRun={() => runStep(step)}
              onCancel={(jobId) => cancelStep(step, jobId)}
            />
          ))}
        </div>
      </section>
    </div>
  );
};

const NativeManagerRepairCard: React.FC<{
  managerName: string;
  manager: VenvInfo["manager_type"];
}> = ({ managerName, manager }) => {
  const commands = manager === "pixi"
    ? ["pixi list", "pixi lock", "pixi install", "pixi run python -m ipykernel install --user"]
    : ["conda list", "conda env export", "conda update --all --dry-run", "python -m ipykernel install --user"];

  return (
    <section className="rounded-[1.5rem] border border-blue-100 dark:border-blue-900/40 bg-blue-50/70 dark:bg-blue-950/10 p-5">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-blue-600 p-2 text-white">
          <Terminal size={18} />
        </div>
        <div>
          <h3 className="text-xs font-black uppercase tracking-widest">{managerName} native repair instructions</h3>
          <p className="mt-2 text-[10px] font-bold leading-relaxed text-slate-500 dark:text-slate-400">
            VOrchestra keeps this environment read-only to avoid corrupting native metadata. Use the native manager for rebuild, sync, update and tool installation, then re-sync inventory here.
          </p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-2">
        {commands.map(command => (
          <code key={command} className="vo-subpanel rounded-xl border border-blue-100/80 dark:border-blue-900/30 px-3 py-2 text-[10px] font-bold text-blue-700 dark:text-blue-300">
            {command}
          </code>
        ))}
      </div>
    </section>
  );
};

const VscodeDoctorCard: React.FC<{
  status: VscodeInterpreterStatus | null;
  loading: boolean;
  fixing: boolean;
  onRefresh: () => void;
  onFix: () => void;
}> = ({ status, loading, fixing, onRefresh, onFix }) => {
  const ok = !!status?.in_sync;

  return (
    <section className={cn(
      "vo-surface rounded-[1.5rem] border p-5 shadow-sm",
      ok
        ? "border-green-200 dark:border-green-900/40"
        : "border-amber-200 dark:border-amber-900/40"
    )}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Code2 size={16} className={ok ? "text-green-600" : "text-amber-600"} />
            <h3 className="text-xs font-black uppercase tracking-widest">VS Code Interpreter Doctor</h3>
            {loading && <Loader2 size={13} className="animate-spin text-blue-600" />}
          </div>
          <p className="mt-2 text-[10px] text-slate-500 dark:text-slate-400">
            Checks whether VS Code points to this environment and can repair `.vscode/settings.json` safely.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={onRefresh}
            disabled={loading || fixing}
            className="vo-secondary-action px-3 py-1.5 rounded-xl disabled:opacity-50 text-[9px]"
          >
            Refresh
          </button>
          <button
            onClick={onFix}
            disabled={loading || fixing}
            className="vo-primary-action px-3 py-1.5 rounded-xl disabled:bg-slate-300 text-[9px]"
          >
            {fixing ? "Fixing..." : "Fix settings"}
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-2">
        <DoctorField label="Expected interpreter" value={status?.expected_interpreter || "Loading..."} />
        <DoctorField label="Configured interpreter" value={status?.configured_interpreter || "Not configured"} />
        <DoctorField label="Settings file" value={status?.settings_path || "Not checked yet"} />
        <DoctorField label="Terminal activation" value={status?.terminal_activation === true ? "Enabled" : "Missing or disabled"} />
      </div>

      <div className={cn(
        "mt-3 rounded-2xl px-4 py-3 text-[10px] font-bold",
        ok
          ? "bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-300"
          : "bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300"
      )}>
        {ok ? "VS Code is pinned to this environment." : (status?.issue || "VS Code interpreter status needs review.")}
      </div>
    </section>
  );
};

const DoctorField: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="vo-panel rounded-2xl border px-4 py-3 min-w-0">
    <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">{label}</p>
    <p className="mt-1 text-[10px] font-mono text-slate-700 dark:text-slate-200 truncate">{value}</p>
  </div>
);

const RebuildSourceCard: React.FC<{
  preview: RebuildSourcePreview | null;
  loading: boolean;
  onRefresh: () => void;
}> = ({ preview, loading, onRefresh }) => (
  <section className="vo-surface rounded-[1.5rem] border p-5 shadow-sm">
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Wrench size={16} className="text-amber-600" />
          <h3 className="text-xs font-black uppercase tracking-widest">Rebuild Source Preview</h3>
          {loading && <Loader2 size={13} className="animate-spin text-blue-600" />}
        </div>
        <p className="mt-2 text-[10px] text-slate-500 dark:text-slate-400">
          Shows the exact source the rebuild action will use before it moves the current environment to recoverable trash.
        </p>
      </div>
      <button
        onClick={onRefresh}
        disabled={loading}
        className="vo-secondary-action px-3 py-1.5 rounded-xl disabled:opacity-50 text-[9px]"
      >
        Refresh
      </button>
    </div>

    <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-2">
      <DoctorField label="Source" value={preview?.label || "Loading..."} />
      <DoctorField label="Detected packages" value={preview ? String(preview.package_count) : "Loading..."} />
      <DoctorField label="Kind" value={preview?.kind || "Loading..."} />
    </div>
    <div className="vo-panel mt-2 rounded-2xl border px-4 py-3">
      <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">Path</p>
      <p className="mt-1 text-[10px] font-mono text-slate-700 dark:text-slate-200 truncate">
        {preview?.path || "Loading..."}
      </p>
    </div>
    {preview?.note && (
      <p className="mt-3 rounded-2xl bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-[10px] font-bold text-amber-700 dark:text-amber-300">
        {preview.note}
      </p>
    )}
  </section>
);

const RepairSequenceCard: React.FC<{
  recommendedSteps: RepairStep[];
  primaryStep: RepairStep | null;
  busy: boolean;
  onRunPrimary: () => void;
}> = ({ recommendedSteps, primaryStep, busy, onRunPrimary }) => (
  <section className="rounded-[1.5rem] border border-blue-100 dark:border-blue-900/40 bg-blue-50/70 dark:bg-blue-950/10 p-5">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300">
          Recommended sequence
        </p>
        <h3 className="mt-1 text-sm font-black text-slate-900 dark:text-white">
          {primaryStep ? `Next: ${primaryStep.title}` : "No repair action needed"}
        </h3>
        <p className="mt-1 text-[10px] font-bold leading-relaxed text-slate-500 dark:text-slate-400">
          Run one action, let VOrchestra refresh the environment state, then continue only if another recommendation remains.
        </p>
      </div>
      <button
        onClick={onRunPrimary}
        disabled={!primaryStep || busy}
        className="vo-primary-action shrink-0 rounded-xl px-4 py-2 text-[10px] disabled:bg-slate-300 disabled:text-slate-500"
      >
        {busy ? "Action running..." : "Run next safe action"}
      </button>
    </div>

    {recommendedSteps.length > 0 ? (
      <ol className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
        {recommendedSteps.map((step, index) => (
          <li key={step.id} className="vo-subpanel flex gap-2 rounded-2xl border border-blue-100/80 dark:border-blue-900/30 px-3 py-2">
            <span className="shrink-0 text-[10px] font-black text-blue-600 dark:text-blue-300">{index + 1}.</span>
            <div className="min-w-0">
              <p className="truncate text-[10px] font-black uppercase tracking-wider text-slate-700 dark:text-slate-200">
                {step.title}
              </p>
              <p className="mt-0.5 line-clamp-2 text-[9px] font-bold text-slate-400">
                {step.description}
              </p>
            </div>
          </li>
        ))}
      </ol>
    ) : (
      <p className="vo-subpanel mt-4 rounded-2xl px-4 py-3 text-[10px] font-bold text-green-700 dark:text-green-300">
        This environment has no recommended repair steps right now.
      </p>
    )}
  </section>
);

const RepairStepCard: React.FC<{
  step: RepairStep;
  busy: boolean;
  disabled: boolean;
  status?: { ok: boolean; message: string };
  jobId?: string;
  onRun: () => void;
  onCancel: (jobId: string) => void;
}> = ({ step, busy, disabled, status, jobId, onRun, onCancel }) => {
  const Icon = step.icon;
  const toneClass = step.tone === "green"
    ? "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300 border-green-100 dark:border-green-900/40"
    : step.tone === "amber"
      ? "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border-amber-100 dark:border-amber-900/40"
      : "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 border-blue-100 dark:border-blue-900/40";

  return (
    <article className="vo-surface rounded-[1.5rem] border p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className={cn("p-2 rounded-xl border", toneClass)}>
          <Icon size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-black uppercase tracking-wider">{step.title}</h4>
            {step.recommended && (
              <span className="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950/50 text-blue-600 dark:text-blue-300 text-[8px] font-black uppercase tracking-widest">
                Recommended
              </span>
            )}
          </div>
          <p className="mt-2 text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">{step.description}</p>
        </div>
      </div>
      {status && (
        <p className={cn("mt-3 text-[10px] font-bold", status.ok ? "text-green-600" : "text-red-600")}>{status.message}</p>
      )}
      <div className="mt-4 flex justify-end">
        <button
          onClick={busy && jobId ? () => onCancel(jobId) : onRun}
          disabled={disabled || (busy && !jobId)}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 py-1.5 text-[9px] font-black uppercase tracking-wider text-white transition-all disabled:bg-slate-300 disabled:text-slate-500 dark:bg-white dark:text-slate-950"
        >
          {busy ? <AlertTriangle size={12} /> : <Icon size={12} />}
          {busy && jobId ? "Stop job" : busy ? "Running..." : step.actionLabel}
        </button>
      </div>
    </article>
  );
};
