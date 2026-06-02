import React, { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, Box, Code2, FileBox, FolderTree, Lock, RefreshCcw, Settings, ShieldAlert, ShieldCheck, Terminal, Zap } from "lucide-react";

import { ProjectDetection, ToolRunResult, VenvInfo } from "../types";
import { waitForBackgroundJob } from "../services/backgroundJobs";
import { assessEnvironmentHealth } from "../utils/envHealth";
import { cn } from "../utils/cn";
import { isReadOnlyManager, readOnlyManagerLabel } from "../utils/venvManagers";

interface ProjectBoardProps {
  venvs: VenvInfo[];
  onOpenStudio: (venv: VenvInfo, tab?: "packages" | "automation" | "config" | "diagnostics" | "lock" | "repair" | "deploy") => void;
  onSync: (path: string) => void;
  setMessage: (message: string) => void;
}

interface ProjectGroup {
  root: string;
  name: string;
  venvs: VenvInfo[];
  bestVenv: VenvInfo;
  attention: number;
  broken: number;
}

type UvProjectAction = "sync" | "lock" | "run" | "add" | "remove";
type ProjectNextStep = {
  label: string;
  description: string;
  action: "repair" | "scan" | "sync" | "uv_sync" | "packages" | "diagnostics";
  actionLabel: string;
  tone: "red" | "amber" | "blue" | "green";
};

const projectRootForVenv = (venvPath: string): string => {
  const parts = venvPath.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 1) return venvPath;
  const rootParts = parts.slice(0, -1);
  const prefix = venvPath.startsWith("/") ? "/" : "";
  return `${prefix}${rootParts.join("/")}`;
};

const basename = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() || path;
const isReadOnlyManifest = (kind: ProjectDetection["manifests"][number]["kind"]): boolean =>
  kind === "conda_environment" || kind === "pixi_toml";

export const parseProjectCommandArgs = (raw: string): string[] => {
  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (const char of raw.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (escaping) current += "\\";
  if (current) args.push(current);
  return args;
};

const buildProjectGroups = (venvs: VenvInfo[]): ProjectGroup[] => {
  const byRoot = new Map<string, VenvInfo[]>();
  for (const venv of venvs) {
    const root = projectRootForVenv(venv.path);
    byRoot.set(root, [...(byRoot.get(root) ?? []), venv]);
  }

  return [...byRoot.entries()].map(([root, groupVenvs]) => {
    const sorted = [...groupVenvs].sort((a, b) => {
      const healthA = assessEnvironmentHealth(a).score;
      const healthB = assessEnvironmentHealth(b).score;
      return healthB - healthA;
    });
    const attention = groupVenvs.filter(venv => assessEnvironmentHealth(venv).tone !== "green").length;
    const broken = groupVenvs.filter(venv => venv.status === "Broken").length;
    return {
      root,
      name: basename(root),
      venvs: groupVenvs,
      bestVenv: sorted[0],
      attention,
      broken
    };
  }).sort((a, b) => b.attention - a.attention || a.name.localeCompare(b.name));
};

const projectNextStep = (project: ProjectGroup, detection?: ProjectDetection): ProjectNextStep => {
  if (project.broken > 0) {
    return {
      label: "Repair broken environment",
      description: "One or more environments are broken. Start with Repair before package operations.",
      action: "repair",
      actionLabel: "Open repair",
      tone: "red"
    };
  }
  if (project.attention > 0) {
    return {
      label: "Refresh project inventory",
      description: "External changes or lower health signals were detected. Sync the best environment first.",
      action: "sync",
      actionLabel: "Sync now",
      tone: "amber"
    };
  }
  if (!detection) {
    return {
      label: "Scan dependency sources",
      description: "Detect requirements.txt, pyproject.toml and lock inputs before changing dependencies.",
      action: "scan",
      actionLabel: "Scan now",
      tone: "blue"
    };
  }
  if (isReadOnlyManager(project.bestVenv.manager_type)) {
    const label = readOnlyManagerLabel(project.bestVenv.manager_type);
    return {
      label: `Review ${label} native inventory`,
      description: "This project is backed by a read-only native manager. Use Diagnostics and Packages for inventory, and mutate through the native manager.",
      action: "diagnostics",
      actionLabel: "Open diagnostics",
      tone: "blue"
    };
  }
  if (project.bestVenv.manager_type === "uv" && detection.manifests.length > 0) {
    return {
      label: "Run uv sync",
      description: "Project manifests are known and this is uv-managed. Sync keeps the environment aligned.",
      action: "uv_sync",
      actionLabel: "Run uv sync",
      tone: "green"
    };
  }
  return {
    label: "Inspect packages",
    description: "Environment looks healthy. Review packages, tree, graph or metadata from Studio.",
    action: "packages",
    actionLabel: "Open packages",
    tone: "green"
  };
};

const projectPostureSignals = (project: ProjectGroup, detection?: ProjectDetection): string[] => {
  const signals: string[] = [];
  const engineCount = new Set(project.venvs.map(venv => venv.manager_type)).size;
  const readOnlyCount = detection?.manifests.filter(manifest => isReadOnlyManifest(manifest.kind)).length ?? 0;

  if (project.venvs.length > 1) {
    signals.push(`${project.venvs.length} environments under this project`);
  }
  if (project.attention > 0) {
    signals.push(`${project.attention} environment${project.attention === 1 ? "" : "s"} need attention`);
  }
  if (engineCount > 1) {
    signals.push("Mixed package engines detected");
  }
  if (readOnlyCount > 0) {
    signals.push(`${readOnlyCount} read-only manifest${readOnlyCount === 1 ? "" : "s"} detected`);
  }
  if (detection && detection.manifests.length > 0 && detection.merged_packages.length === 0) {
    signals.push("No pip/uv-installable packages detected from manifests");
  }
  if (!detection && project.attention === 0) {
    signals.push("Manifest sources not scanned yet");
  }

  return signals.slice(0, 3);
};

export const ProjectBoard: React.FC<ProjectBoardProps> = ({ venvs, onOpenStudio, onSync, setMessage }) => {
  const projects = useMemo(() => buildProjectGroups(venvs), [venvs]);
  const [detections, setDetections] = useState<Record<string, ProjectDetection>>({});
  const [scanningRoot, setScanningRoot] = useState<string | null>(null);
  const [scanJob, setScanJob] = useState<{ root: string; jobId: string } | null>(null);
  const [runningUv, setRunningUv] = useState<{ root: string; action: UvProjectAction; jobId: string } | null>(null);
  const [uvResults, setUvResults] = useState<Record<string, ToolRunResult>>({});
  const [uvPackageDrafts, setUvPackageDrafts] = useState<Record<string, string>>({});
  const [uvGroupDrafts, setUvGroupDrafts] = useState<Record<string, string>>({});
  const [uvRunDrafts, setUvRunDrafts] = useState<Record<string, string>>({});
  const [uvSyncAllGroups, setUvSyncAllGroups] = useState<Record<string, boolean>>({});
  const [uvSyncAllExtras, setUvSyncAllExtras] = useState<Record<string, boolean>>({});

  const scanProject = async (root: string) => {
    setScanningRoot(root);
    let activeJobId: string | null = null;
    try {
      const jobId = await invoke<string>("start_detect_project_manifests_job", { path: root });
      activeJobId = jobId;
      setScanJob({ root, jobId });
      const detection = await waitForBackgroundJob<ProjectDetection>(jobId, (snapshot) => {
        if (snapshot.message) setMessage(`${basename(root)}: ${snapshot.message}`);
      });
      setDetections(prev => ({ ...prev, [root]: detection }));
      setMessage(`Detected ${detection.manifests.length} manifest(s) in ${basename(root)}.`);
    } catch (err) {
      const message = String(err).includes("Operation cancelled")
        ? `Project scan cancelled for ${basename(root)}.`
        : `Project scan failed for ${basename(root)}: ${err}`;
      setMessage(message);
    } finally {
      setScanningRoot(null);
      setScanJob(current => (current?.jobId === activeJobId ? null : current));
    }
  };

  const runUvProjectAction = async (project: ProjectGroup, action: UvProjectAction, packageSpecs: string[] = []) => {
    const resultKey = `${project.root}:${action}`;
    const runArgs = action === "run" ? (packageSpecs.length > 0 ? packageSpecs : ["python", "--version"]) : packageSpecs;
    let activeJobId: string | null = null;
    try {
      const jobId = await invoke<string>("start_run_uv_project_job", {
        venvPath: project.bestVenv.path,
        action,
        runArgs,
        timeoutSecs: 600
      });
      activeJobId = jobId;
      setRunningUv({ root: project.root, action, jobId });
      const result = await waitForBackgroundJob<ToolRunResult>(jobId, (snapshot) => {
        if (snapshot.message) setMessage(`${project.name}: ${snapshot.message}`);
      });
      setUvResults(prev => ({ ...prev, [resultKey]: result }));
      setMessage(result.success ? `uv ${action} finished for ${project.name}.` : `uv ${action} failed for ${project.name}.`);
    } catch (err) {
      const message = String(err).includes("Operation cancelled")
        ? `uv ${action} cancelled for ${project.name}.`
        : `uv ${action} failed for ${project.name}: ${err}`;
      setMessage(message);
    } finally {
      setRunningUv(current => (current?.jobId === activeJobId ? null : current));
    }
  };

  const cancelJob = async (jobId: string, label: string) => {
    try {
      await invoke<boolean>("cancel_background_job", { jobId });
      setMessage(`${label} cancellation requested.`);
    } catch (err) {
      setMessage(`Failed to cancel ${label.toLowerCase()}: ${err}`);
    }
  };

  const openProjectTerminal = async (project: ProjectGroup) => {
    try {
      await invoke("open_terminal", { path: project.root });
      setMessage(`Opening ${project.name} project terminal...`);
    } catch (err) {
      setMessage(`Failed to open ${project.name} terminal: ${err}`);
    }
  };

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-slate-400">
        <FolderTree size={36} />
        <p className="mt-3 text-xs font-black uppercase tracking-widest">No projects in this workspace yet</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-8 grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-4 items-start content-start auto-rows-max pb-20">
      {projects.map(project => (
        <ProjectCard
          key={project.root}
          project={project}
          detection={detections[project.root]}
          scanning={scanningRoot === project.root}
          scanJobId={scanJob?.root === project.root ? scanJob.jobId : null}
          onScan={() => scanProject(project.root)}
          onCancelScan={(jobId) => cancelJob(jobId, `${project.name} project scan`)}
          onOpenStudio={onOpenStudio}
          onSync={onSync}
          runningUv={runningUv?.root === project.root ? runningUv : null}
          uvResults={uvResults}
          onRunUv={(action, args) => runUvProjectAction(project, action, args)}
          onCancelUv={(jobId, action) => cancelJob(jobId, `${project.name} uv ${action}`)}
          packageDraft={uvPackageDrafts[project.root] ?? ""}
          onPackageDraftChange={(value) => setUvPackageDrafts(prev => ({ ...prev, [project.root]: value }))}
          groupDraft={uvGroupDrafts[project.root] ?? ""}
          onGroupDraftChange={(value) => setUvGroupDrafts(prev => ({ ...prev, [project.root]: value }))}
          runDraft={uvRunDrafts[project.root] ?? ""}
          onRunDraftChange={(value) => setUvRunDrafts(prev => ({ ...prev, [project.root]: value }))}
          onRunUvPackages={(action, specs) => runUvProjectAction(project, action, specs)}
          onRunUvCommand={(args) => runUvProjectAction(project, "run", args)}
          syncAllGroups={uvSyncAllGroups[project.root] ?? false}
          onSyncAllGroupsChange={(checked) => setUvSyncAllGroups(prev => ({ ...prev, [project.root]: checked }))}
          syncAllExtras={uvSyncAllExtras[project.root] ?? false}
          onSyncAllExtrasChange={(checked) => setUvSyncAllExtras(prev => ({ ...prev, [project.root]: checked }))}
          onOpenProjectTerminal={() => openProjectTerminal(project)}
        />
      ))}
    </div>
  );
};

const ProjectCard: React.FC<{
  project: ProjectGroup;
  detection?: ProjectDetection;
  scanning: boolean;
  scanJobId: string | null;
  onScan: () => void;
  onCancelScan: (jobId: string) => void;
  onOpenStudio: ProjectBoardProps["onOpenStudio"];
  onSync: ProjectBoardProps["onSync"];
  runningUv: { root: string; action: UvProjectAction; jobId: string } | null;
  uvResults: Record<string, ToolRunResult>;
  onRunUv: (action: UvProjectAction, args?: string[]) => void;
  onCancelUv: (jobId: string, action: UvProjectAction) => void;
  packageDraft: string;
  onPackageDraftChange: (value: string) => void;
  groupDraft: string;
  onGroupDraftChange: (value: string) => void;
  runDraft: string;
  onRunDraftChange: (value: string) => void;
  onRunUvPackages: (action: Extract<UvProjectAction, "add" | "remove">, specs: string[]) => void;
  onRunUvCommand: (args: string[]) => void;
  syncAllGroups: boolean;
  onSyncAllGroupsChange: (checked: boolean) => void;
  syncAllExtras: boolean;
  onSyncAllExtrasChange: (checked: boolean) => void;
  onOpenProjectTerminal: () => void;
}> = ({ project, detection, scanning, scanJobId, onScan, onCancelScan, onOpenStudio, onSync, runningUv, uvResults, onRunUv, onCancelUv, packageDraft, onPackageDraftChange, groupDraft, onGroupDraftChange, runDraft, onRunDraftChange, onRunUvPackages, onRunUvCommand, syncAllGroups, onSyncAllGroupsChange, syncAllExtras, onSyncAllExtrasChange, onOpenProjectTerminal }) => {
  const primaryHealth = assessEnvironmentHealth(project.bestVenv);
  const engines = [...new Set(project.venvs.map(venv => venv.manager_type))].join(" + ");
  const uvNative = project.bestVenv.manager_type === "uv";
  const nextStep = projectNextStep(project, detection);
  const postureSignals = projectPostureSignals(project, detection);
  const rawPackageSpecs = parseProjectCommandArgs(packageDraft);
  const groupArgs = groupDraft.trim() ? ["--group", groupDraft.trim()] : [];
  const packageSpecs = [...groupArgs, ...rawPackageSpecs];
  const syncArgs = [
    ...(syncAllGroups ? ["--all-groups"] : []),
    ...(syncAllExtras ? ["--all-extras"] : [])
  ];
  const runArgs = parseProjectCommandArgs(runDraft);
  const installablePackages = detection?.merged_packages ?? [];
  const packagePreview = installablePackages.slice(0, 8);
  const remainingPackageCount = Math.max(0, installablePackages.length - packagePreview.length);
  const manifestStatus = detection ? `${detection.manifests.length} scanned` : "Not scanned";
  const workspace = detection?.workspace ?? null;
  const latestUvResult = (["sync", "lock", "run", "add", "remove"] as UvProjectAction[])
    .map(action => uvResults[`${project.root}:${action}`])
    .find(Boolean);

  return (
    <article className="vo-surface rounded-[1.5rem] border p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex items-start gap-3">
          <div className={cn(
            "p-3 rounded-2xl text-white shadow-lg",
            project.broken > 0 ? "bg-red-600" : project.attention > 0 ? "bg-amber-500" : "bg-blue-600"
          )}>
            <FolderTree size={20} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-black truncate">{project.name}</h3>
            <p className="mt-1 text-[10px] font-mono text-slate-400 truncate">{project.root}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge>{project.venvs.length} env{project.venvs.length === 1 ? "" : "s"}</Badge>
              <Badge>{engines}</Badge>
              <Badge tone={primaryHealth.tone}>{primaryHealth.score}/100</Badge>
            </div>
          </div>
        </div>
        {project.attention > 0 && (
          <div className="flex items-center gap-1 text-[9px] font-black uppercase text-amber-600 dark:text-amber-300">
            <AlertTriangle size={12} /> {project.attention} attention
          </div>
        )}
      </div>

      <section className="vo-panel mt-4 grid grid-cols-2 gap-2 rounded-2xl border p-3">
        <ProjectReadinessMetric
          label="Best env health"
          value={`${primaryHealth.score}/100`}
          tone={primaryHealth.tone}
        />
        <ProjectReadinessMetric
          label="Inventory issues"
          value={`${project.attention}`}
          detail={`${project.broken} broken`}
          tone={project.broken > 0 ? "red" : project.attention > 0 ? "amber" : "green"}
        />
        <ProjectReadinessMetric
          label="Manifest scan"
          value={manifestStatus}
          tone={detection ? "green" : "amber"}
        />
        <ProjectReadinessMetric
          label="Installable inputs"
          value={`${installablePackages.length}`}
          tone={installablePackages.length > 0 ? "green" : detection ? "amber" : "blue"}
        />
      </section>

      {postureSignals.length > 0 && (
        <section className="vo-panel mt-4 rounded-2xl border p-3">
          <h4 className="text-[9px] font-black uppercase tracking-widest text-slate-400">Project posture</h4>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {postureSignals.map(signal => (
              <span key={signal} className="vo-surface rounded-full border px-2.5 py-1 text-[9px] font-bold text-slate-500 dark:text-slate-300">
                {signal}
              </span>
            ))}
          </div>
        </section>
      )}

      {project.venvs.length > 1 && (
        <section className="vo-panel mt-4 rounded-2xl border p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-[9px] font-black uppercase tracking-widest text-slate-400">Project environments</h4>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">Pick the exact venv before changing packages or repair state.</p>
            </div>
            <span className="text-[9px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-300">
              {project.venvs.length} total
            </span>
          </div>
          <div className="mt-3 space-y-1.5">
            {[...project.venvs]
              .sort((a, b) => assessEnvironmentHealth(b).score - assessEnvironmentHealth(a).score)
              .map((venv) => {
                const health = assessEnvironmentHealth(venv);
                return (
                  <div key={venv.path} className="vo-surface flex items-center justify-between gap-2 rounded-xl border px-3 py-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-[10px] font-black truncate">{venv.name}</p>
                        <Badge tone={health.tone}>{health.score}</Badge>
                      </div>
                      <p className="mt-0.5 text-[9px] font-mono text-slate-400 truncate">{venv.manager_type} · {venv.status}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => onOpenStudio(venv, health.tone === "green" ? "packages" : "repair")}
                        className={cn(
                          "px-2 py-1 rounded-lg text-[8px] font-black uppercase tracking-wider",
                          health.tone === "green"
                            ? "bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-300"
                            : "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-200"
                        )}
                      >
                        {health.tone === "green" ? "Packages" : "Repair"}
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        </section>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          onClick={() => onOpenStudio(project.bestVenv, "repair")}
          className="flex items-center justify-center gap-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-950 px-3 py-2 text-[10px] font-black uppercase tracking-wider"
        >
          <ShieldCheck size={13} /> Repair
        </button>
        <button
          onClick={() => onOpenStudio(project.bestVenv, "packages")}
          className="flex items-center justify-center gap-2 rounded-xl bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-300 px-3 py-2 text-[10px] font-black uppercase tracking-wider"
        >
          <Box size={13} /> Packages
        </button>
        <button
          onClick={() => onOpenStudio(project.bestVenv, "deploy")}
          className="flex items-center justify-center gap-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-3 py-2 text-[10px] font-black uppercase tracking-wider"
        >
          <Code2 size={13} /> Project tools
        </button>
        <button
          onClick={() => onSync(project.bestVenv.path)}
          className="flex items-center justify-center gap-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-3 py-2 text-[10px] font-black uppercase tracking-wider"
        >
          <RefreshCcw size={13} /> Sync
        </button>
      </div>

      <section className="vo-panel mt-4 rounded-2xl border p-3">
        <h4 className="text-[9px] font-black uppercase tracking-widest text-slate-400">Project command center</h4>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <ProjectCommandButton label="Lockfile" Icon={Lock} onClick={() => onOpenStudio(project.bestVenv, "lock")} />
          <ProjectCommandButton label="Config" Icon={Settings} onClick={() => onOpenStudio(project.bestVenv, "config")} />
          <ProjectCommandButton label="Automation" Icon={Zap} onClick={() => onOpenStudio(project.bestVenv, "automation")} />
          <ProjectCommandButton label="Diagnostics" Icon={ShieldAlert} onClick={() => onOpenStudio(project.bestVenv, "diagnostics")} />
          <ProjectCommandButton label="Terminal" Icon={Terminal} onClick={onOpenProjectTerminal} />
        </div>
      </section>

      <section className={cn(
        "mt-4 rounded-2xl border p-3",
        nextStep.tone === "red" && "border-red-100 dark:border-red-900/40 bg-red-50 dark:bg-red-950/10",
        nextStep.tone === "amber" && "border-amber-100 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/10",
        nextStep.tone === "blue" && "border-blue-100 dark:border-blue-900/40 bg-blue-50 dark:bg-blue-950/10",
        nextStep.tone === "green" && "border-emerald-100 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-950/10"
      )}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-300">Next best action</h4>
            <p className="mt-1 text-xs font-black text-slate-800 dark:text-slate-100">{nextStep.label}</p>
            <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">{nextStep.description}</p>
          </div>
          <button
            onClick={() => {
              if (nextStep.action === "repair") onOpenStudio(project.bestVenv, "repair");
              else if (nextStep.action === "scan") onScan();
              else if (nextStep.action === "sync") onSync(project.bestVenv.path);
              else if (nextStep.action === "uv_sync") onRunUv("sync", syncArgs);
              else if (nextStep.action === "diagnostics") onOpenStudio(project.bestVenv, "diagnostics");
              else onOpenStudio(project.bestVenv, "packages");
            }}
            disabled={scanning || !!runningUv}
            className="vo-secondary-action shrink-0 rounded-xl px-3 py-1.5 text-[9px] disabled:opacity-50"
          >
            {nextStep.actionLabel}
          </button>
        </div>
      </section>

      <section className="vo-panel mt-4 rounded-2xl border p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-[9px] font-black uppercase tracking-widest text-slate-400">Manifests</h4>
            <p className="text-[10px] text-slate-500 dark:text-slate-400">
              {detection ? `${detection.manifests.length} found, ${detection.merged_packages.length} package(s)` : "Scan project root to inspect dependency sources."}
            </p>
          </div>
          <button
            onClick={() => scanning && scanJobId ? onCancelScan(scanJobId) : onScan()}
            className="vo-secondary-action flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[9px] disabled:opacity-50"
          >
            {scanning ? <AlertTriangle size={11} /> : <FileBox size={11} />}
            {scanning ? "Stop scan" : "Scan"}
          </button>
        </div>
        {detection && detection.manifests.length > 0 && (
          <div className="mt-3 space-y-3">
            <ul className="space-y-1">
              {detection.manifests.map(manifest => (
                <li key={manifest.path} className="flex items-center justify-between gap-3 text-[10px]" title={manifest.note ?? undefined}>
                  <span className="font-mono truncate text-slate-600 dark:text-slate-300">{basename(manifest.path)}</span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {isReadOnlyManifest(manifest.kind) && (
                      <span className="px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-200 text-[8px] font-black uppercase tracking-wider">
                        Read-only
                      </span>
                    )}
                    <span className="font-black text-slate-400">{manifest.packages.length}</span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="vo-surface rounded-xl border px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">Installable dependency inputs</p>
                <span className="text-[8px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-300">
                  {installablePackages.length} ready
                </span>
              </div>
              {packagePreview.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {packagePreview.map(pkg => (
                    <span key={pkg} className="rounded-full bg-blue-50 dark:bg-blue-950/30 px-2 py-0.5 text-[9px] font-mono text-blue-700 dark:text-blue-300">
                      {pkg}
                    </span>
                  ))}
                  {remainingPackageCount > 0 && (
                    <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[9px] font-black text-slate-500">
                      +{remainingPackageCount} more
                    </span>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-[9px] font-bold text-amber-600 dark:text-amber-300">
                  No pip/uv-installable dependencies were found. Conda and Pixi manifests remain read-only inventory.
                </p>
              )}
            </div>
          </div>
        )}
      </section>

      {workspace && (
        <section className="mt-4 rounded-2xl border border-emerald-100 dark:border-emerald-900/40 bg-emerald-50/60 dark:bg-emerald-950/10 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-[9px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
                uv workspace
              </h4>
              <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                Sync and lock run from this root and may affect all configured workspace members.
              </p>
            </div>
            <Badge tone="green">{workspace.members.length} member{workspace.members.length === 1 ? "" : "s"}</Badge>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2">
            <WorkspacePatternList
              title="Members"
              empty="No explicit workspace members were listed."
              values={workspace.members}
            />
            {workspace.excludes.length > 0 && (
              <WorkspacePatternList
                title="Excluded"
                empty=""
                values={workspace.excludes}
              />
            )}
          </div>
        </section>
      )}

      {uvNative && (
        <section className="mt-3 rounded-2xl border border-emerald-100 dark:border-emerald-900/40 bg-emerald-50/60 dark:bg-emerald-950/10 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-[9px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-300">UV-native workflow</h4>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">Run project-level uv actions from the project root.</p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <UvButton action="sync" running={runningUv?.action === "sync"} disabled={!!runningUv && runningUv.action !== "sync"} onClick={() => onRunUv("sync", syncArgs)} onCancel={() => runningUv?.action === "sync" && onCancelUv(runningUv.jobId, "sync")} />
            <UvButton action="lock" running={runningUv?.action === "lock"} disabled={!!runningUv && runningUv.action !== "lock"} onClick={() => onRunUv("lock")} onCancel={() => runningUv?.action === "lock" && onCancelUv(runningUv.jobId, "lock")} />
            <UvButton action="run" running={runningUv?.action === "run"} disabled={!!runningUv && runningUv.action !== "run"} onClick={() => onRunUvCommand(runArgs)} onCancel={() => runningUv?.action === "run" && onCancelUv(runningUv.jobId, "run")} />
          </div>
          <div className="vo-subpanel mt-3 rounded-2xl border border-emerald-100 dark:border-emerald-900/40 p-3">
            <p className="text-[8px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
              uv sync scope
            </p>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="vo-surface flex items-center gap-2 rounded-xl border px-3 py-2 text-[10px] font-bold text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={syncAllGroups}
                  onChange={(event) => onSyncAllGroupsChange(event.target.checked)}
                />
                Include all dependency groups
              </label>
              <label className="vo-surface flex items-center gap-2 rounded-xl border px-3 py-2 text-[10px] font-bold text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={syncAllExtras}
                  onChange={(event) => onSyncAllExtrasChange(event.target.checked)}
                />
                Include all extras
              </label>
            </div>
            <p className="mt-2 text-[9px] font-bold text-emerald-700 dark:text-emerald-300">
              These map to <span className="font-mono">uv sync --all-groups</span> and <span className="font-mono">--all-extras</span>; no raw sync flags are accepted.
            </p>
          </div>
          <div className="vo-subpanel mt-3 rounded-2xl border border-emerald-100 dark:border-emerald-900/40 p-3">
            <label className="text-[8px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
              uv run command
            </label>
            <input
              value={runDraft}
              onChange={(event) => onRunDraftChange(event.target.value)}
              placeholder="pytest -q"
              className="vo-control mt-2 w-full rounded-xl border px-3 py-2 text-[10px] font-mono focus:border-emerald-500"
            />
            <p className="mt-2 text-[9px] font-bold text-emerald-700 dark:text-emerald-300">
              Empty runs <span className="font-mono">uv run python --version</span> as a quick project sanity check.
            </p>
          </div>
          <div className="vo-subpanel mt-3 rounded-2xl border border-emerald-100 dark:border-emerald-900/40 p-3">
            <label className="text-[8px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
              Project dependency spec
            </label>
            <input
              value={packageDraft}
              onChange={(event) => onPackageDraftChange(event.target.value)}
              placeholder="httpx fastapi[standard]"
              className="vo-control mt-2 w-full rounded-xl border px-3 py-2 text-[10px] font-mono focus:border-emerald-500"
            />
            <input
              value={groupDraft}
              onChange={(event) => onGroupDraftChange(event.target.value)}
              placeholder="optional group, e.g. dev"
              className="vo-control mt-2 w-full rounded-xl border px-3 py-2 text-[10px] font-mono focus:border-emerald-500"
            />
            <p className="mt-2 text-[9px] font-bold text-emerald-700 dark:text-emerald-300">
              Group is passed as <span className="font-mono">--group</span> for uv dependency groups; leave empty for main dependencies.
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <UvButton action="add" running={runningUv?.action === "add"} disabled={rawPackageSpecs.length === 0 || (!!runningUv && runningUv.action !== "add")} onClick={() => onRunUvPackages("add", packageSpecs)} onCancel={() => runningUv?.action === "add" && onCancelUv(runningUv.jobId, "add")} />
              <UvButton action="remove" running={runningUv?.action === "remove"} disabled={rawPackageSpecs.length === 0 || (!!runningUv && runningUv.action !== "remove")} onClick={() => onRunUvPackages("remove", packageSpecs)} onCancel={() => runningUv?.action === "remove" && onCancelUv(runningUv.jobId, "remove")} />
            </div>
          </div>
          {latestUvResult && (
            <p className={cn(
              "mt-2 text-[10px] font-mono truncate",
              latestUvResult.success ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-300"
            )}>
              {(latestUvResult.stdout || latestUvResult.stderr || "uv command completed.").trim()}
            </p>
          )}
        </section>
      )}
    </article>
  );
};

const UvButton: React.FC<{
  action: UvProjectAction;
  running: boolean;
  disabled: boolean;
  onClick: () => void;
  onCancel: () => void;
}> = ({ action, running, disabled, onClick, onCancel }) => (
  <button
    onClick={running ? onCancel : onClick}
    disabled={disabled}
    className="vo-surface flex items-center justify-center gap-1.5 rounded-xl border border-emerald-100 dark:border-emerald-900/40 text-emerald-700 dark:text-emerald-300 px-2 py-2 text-[9px] font-black uppercase tracking-wider disabled:opacity-50 hover:border-emerald-300 dark:hover:border-emerald-700 transition-all"
  >
    {running ? <AlertTriangle size={11} /> : <RefreshCcw size={11} />}
    {running ? `Stop uv ${action}` : `uv ${action === "run" ? "run py" : action}`}
  </button>
);

const ProjectCommandButton: React.FC<{
  label: string;
  Icon: React.ComponentType<{ size?: number }>;
  onClick: () => void;
}> = ({ label, Icon, onClick }) => (
  <button
    onClick={onClick}
    className="vo-secondary-action flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-[9px] hover:border-blue-200 dark:hover:border-blue-900/40"
  >
    <Icon size={11} /> {label}
  </button>
);

const WorkspacePatternList: React.FC<{ title: string; values: string[]; empty: string }> = ({ title, values, empty }) => (
  <div className="vo-subpanel rounded-xl border border-emerald-100 dark:border-emerald-900/40 px-3 py-2">
    <p className="text-[8px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-300">{title}</p>
    {values.length > 0 ? (
      <div className="mt-2 flex flex-wrap gap-1.5">
        {values.slice(0, 8).map(value => (
          <span key={value} className="rounded-full bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 text-[9px] font-mono text-emerald-700 dark:text-emerald-300">
            {value}
          </span>
        ))}
        {values.length > 8 && (
          <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[9px] font-black text-slate-500">
            +{values.length - 8} more
          </span>
        )}
      </div>
    ) : (
      <p className="mt-1 text-[9px] font-bold text-slate-400">{empty}</p>
    )}
  </div>
);

const ProjectReadinessMetric: React.FC<{
  label: string;
  value: string;
  detail?: string;
  tone: "green" | "amber" | "red" | "blue";
}> = ({ label, value, detail, tone }) => (
  <div className="vo-surface rounded-xl border px-3 py-2">
    <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">{label}</p>
    <p className={cn(
      "mt-1 text-[11px] font-black tabular-nums",
      tone === "green" && "text-emerald-600 dark:text-emerald-300",
      tone === "amber" && "text-amber-600 dark:text-amber-300",
      tone === "red" && "text-red-600 dark:text-red-300",
      tone === "blue" && "text-blue-600 dark:text-blue-300"
    )}>
      {value}
    </p>
    {detail && <p className="mt-0.5 text-[9px] font-bold text-slate-400">{detail}</p>}
  </div>
);

const Badge: React.FC<{ children: React.ReactNode; tone?: "green" | "amber" | "red" }> = ({ children, tone }) => (
  <span className={cn(
    "px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wide border",
    tone === "red"
      ? "bg-red-50 border-red-100 text-red-600 dark:bg-red-950/30 dark:border-red-900/40 dark:text-red-300"
      : tone === "amber"
        ? "bg-amber-50 border-amber-100 text-amber-700 dark:bg-amber-950/30 dark:border-amber-900/40 dark:text-amber-300"
        : tone === "green"
          ? "bg-green-50 border-green-100 text-green-700 dark:bg-green-950/30 dark:border-green-900/40 dark:text-green-300"
          : "bg-slate-50 border-slate-100 text-slate-500 dark:bg-slate-950/40 dark:border-slate-800"
  )}>
    {children}
  </span>
);
