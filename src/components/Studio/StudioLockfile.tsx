import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Lock, Loader2, Save, RotateCcw, GitCompare, Check, AlertCircle, Plus, Minus, ArrowRight, Search
} from "lucide-react";
import { VenvInfo, DriftReport, DriftEntry, DriftKind } from "../../types";
import { needsElevation, stripElevationPrefix } from "../../services/packageManager";
import { waitForBackgroundJob } from "../../services/backgroundJobs";
import { cn } from "../../utils/cn";
import { isReadOnlyManager, readOnlyManagerLabel } from "../../utils/venvManagers";

interface StudioLockfileProps {
  venv: VenvInfo;
  setMessage: (msg: string) => void;
}

const KIND_META: Record<DriftKind, { label: string; tone: string; Icon: React.ComponentType<{ size?: number; className?: string }> }> = {
  different_version: { label: "Drift",     tone: "amber",  Icon: ArrowRight },
  missing:           { label: "Missing",   tone: "red",    Icon: Minus },
  extra:             { label: "Extra",     tone: "blue",   Icon: Plus },
  in_sync:           { label: "In sync",   tone: "green",  Icon: Check },
};

const TONE_BG: Record<string, string> = {
  amber: "bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/30 text-amber-700 dark:text-amber-300",
  red:   "bg-red-50 dark:bg-red-900/10 border-red-100 dark:border-red-900/30 text-red-700 dark:text-red-300",
  blue:  "bg-blue-50 dark:bg-blue-900/10 border-blue-100 dark:border-blue-900/30 text-blue-700 dark:text-blue-300",
  green: "bg-green-50 dark:bg-green-900/10 border-green-100 dark:border-green-900/30 text-green-700 dark:text-green-300",
};

const DRIFT_FILTERS: Array<{ key: DriftKind | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "different_version", label: "Version" },
  { key: "missing", label: "Missing" },
  { key: "extra", label: "Extra" },
  { key: "in_sync", label: "In sync" },
];

const driftSummary = (entries: DriftEntry[]) => {
  const counts = entries.reduce<Record<DriftKind, number>>((acc, entry) => {
    acc[entry.kind] += 1;
    return acc;
  }, { different_version: 0, missing: 0, extra: 0, in_sync: 0 });

  const advice = counts.different_version > 0 || counts.missing > 0
    ? "Restore applies the lockfile to make the environment match the pinned snapshot."
    : counts.extra > 0
      ? "Freeze again if these extra packages are intentional; restore removes packages not present in the lockfile."
      : "No package action is needed.";

  return { counts, advice };
};

const lockfileWorkflowGuidance = (report: DriftReport | null): { title: string; detail: string; tone: "blue" | "green" | "amber" } => {
  if (!report) {
    return {
      title: "Start with a baseline",
      detail: "Freeze creates requirements.lock from the current environment. Check Drift compares the environment against an existing lockfile before you restore.",
      tone: "blue"
    };
  }
  if (report.in_sync) {
    return {
      title: "Environment matches the lockfile",
      detail: "No restore is needed. Freeze again only if you intentionally changed the dependency baseline.",
      tone: "green"
    };
  }
  return {
    title: "Review drift before restoring",
    detail: "Restore can downgrade, upgrade, add or remove packages to match the lockfile. Use the drift list to confirm the change is intentional.",
    tone: "amber"
  };
};

export const StudioLockfile: React.FC<StudioLockfileProps> = ({ venv, setMessage }) => {
  const [generating, setGenerating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoringElevated, setRestoringElevated] = useState(false);
  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState<DriftReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingElevation, setPendingElevation] = useState(false);
  const [restoreJobId, setRestoreJobId] = useState<string | null>(null);
  const [restoreProgress, setRestoreProgress] = useState<string | null>(null);
  const [lockfileProgress, setLockfileProgress] = useState<string | null>(null);
  const [confirmRestoreOpen, setConfirmRestoreOpen] = useState(false);
  const [driftQuery, setDriftQuery] = useState("");
  const [driftFilter, setDriftFilter] = useState<DriftKind | "all">("all");

  const isWindows = typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent);
  const readOnlyManager = isReadOnlyManager(venv.manager_type);
  const readOnlyManagerName = readOnlyManagerLabel(venv.manager_type);
  const workflowGuidance = lockfileWorkflowGuidance(report);
  const normalizedDriftQuery = driftQuery.trim().toLowerCase();
  const visibleDriftEntries = report?.entries.filter((entry) => {
    if (driftFilter !== "all" && entry.kind !== driftFilter) return false;
    if (!normalizedDriftQuery) return true;
    return [
      entry.name,
      entry.kind,
      entry.lock_version ?? "",
      entry.installed_version ?? ""
    ].some((value) => value.toLowerCase().includes(normalizedDriftQuery));
  }) ?? [];

  const generate = async () => {
    setGenerating(true);
    setError(null);
    setLockfileProgress("Starting lockfile generation...");
    try {
      const jobId = await invoke<string>("start_generate_lockfile_job", {
        venvPath: venv.path,
        engine: venv.manager_type,
        outputPath: null
      });
      const out = await waitForBackgroundJob<string>(jobId, (snapshot) => {
        if (!snapshot.message) return;
        const pct = typeof snapshot.progress === "number" ? ` ${Math.round(snapshot.progress * 100)}%` : "";
        setLockfileProgress(`${snapshot.message}${pct}`);
      });
      setMessage(out);
      // Re-run drift after generating so user sees the freshly synced state.
      await runDrift();
    } catch (err) {
      setError(`${err}`);
    } finally {
      setGenerating(false);
      setLockfileProgress(null);
    }
  };

  const runDrift = async () => {
    setChecking(true);
    setError(null);
    setLockfileProgress("Starting drift check...");
    try {
      const jobId = await invoke<string>("start_compute_lockfile_drift_job", {
        venvPath: venv.path,
        engine: venv.manager_type,
        lockfilePath: null
      });
      const r = await waitForBackgroundJob<DriftReport>(jobId, (snapshot) => {
        if (!snapshot.message) return;
        const pct = typeof snapshot.progress === "number" ? ` ${Math.round(snapshot.progress * 100)}%` : "";
        setLockfileProgress(`${snapshot.message}${pct}`);
      });
      setReport(r);
      setDriftQuery("");
      setDriftFilter("all");
    } catch (err) {
      setError(`${err}`);
      setReport(null);
    } finally {
      setChecking(false);
      setLockfileProgress(null);
    }
  };

  const restore = async () => {
    if (readOnlyManager) {
      setConfirmRestoreOpen(false);
      setError(`${readOnlyManagerName} environments are read-only in VOrchestra. Use the native manager to restore or sync dependencies.`);
      return;
    }
    setConfirmRestoreOpen(false);
    setRestoring(true);
    setError(null);
    setPendingElevation(false);
    setRestoreProgress("Starting restore...");
    try {
      const jobId = await invoke<string>("start_restore_from_lockfile_job", {
        venvPath: venv.path,
        engine: venv.manager_type,
        lockfilePath: null
      });
      setRestoreJobId(jobId);
      const out = await waitForBackgroundJob<string>(jobId, (snapshot) => {
        if (snapshot.message) {
          const pct = typeof snapshot.progress === "number"
            ? ` ${Math.round(snapshot.progress * 100)}%`
            : "";
          setRestoreProgress(`${snapshot.message}${pct}`);
        }
      });
      setMessage(out);
      await runDrift();
    } catch (err) {
      if (needsElevation(err)) {
        setPendingElevation(true);
        setError("Permission denied. The restore needs elevated privileges.");
      } else {
        setError(`${err}`);
      }
    } finally {
      setRestoring(false);
      setRestoreJobId(null);
      setRestoreProgress(null);
    }
  };

  const cancelRestore = async () => {
    if (!restoreJobId) return;
    setRestoreProgress("Cancelling restore...");
    try {
      await invoke("cancel_background_job", { jobId: restoreJobId });
    } catch (err) {
      setError(`${err}`);
    }
  };

  // Restoring with elevation reuses install_dependency_elevated for each
  // missing/different package — too noisy. Simpler: re-run the same
  // restore command with a separate elevated path. For v0.2 we surface a
  // toast pointing the user at the manual workaround until a dedicated
  // elevated restore command exists.
  const restoreElevatedHint = async () => {
    setRestoringElevated(true);
    setMessage(
      isWindows
        ? "Re-launch VOrchestra as Administrator and click Restore again."
        : `Run \`sudo ${venv.manager_type} install -r requirements.lock\` from a shell with the venv activated.`
    );
    setRestoringElevated(false);
  };

  return (
    <div className="space-y-8 text-slate-900 dark:text-slate-100">
      <header className="flex items-start justify-between gap-6">
        <div>
          <h3 className="font-black text-sm uppercase tracking-widest flex items-center gap-2 text-slate-900 dark:text-white">
            <Lock size={16} className="text-blue-600" /> Lockfile & Drift
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xl">
            Pin the exact set of installed packages to <code className="font-mono text-blue-600">requirements.lock</code>{" "}
            in the project root. Restore later for reproducible installs, or run a drift check to see what changed.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={generate}
            disabled={readOnlyManager || generating || restoring || checking}
            title={readOnlyManager ? `Use ${readOnlyManagerName}'s native lockfile workflow instead.` : undefined}
            className="vo-primary-action flex items-center gap-2 px-4 py-2 disabled:bg-slate-400 rounded-xl text-[10px] shadow-sm"
          >
            {generating ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            {generating ? "Freezing..." : "Freeze to Lockfile"}
          </button>
          <button
            onClick={runDrift}
            disabled={checking || generating || restoring}
            className="vo-secondary-action flex items-center gap-2 px-4 py-2 rounded-xl text-[10px]"
          >
            {checking ? <Loader2 size={12} className="animate-spin" /> : <GitCompare size={12} />}
            {checking ? "Comparing..." : "Check Drift"}
          </button>
          <button
            onClick={() => setConfirmRestoreOpen(true)}
            disabled={readOnlyManager || restoring || generating || checking}
            title={readOnlyManager ? `Use ${readOnlyManagerName}'s native tooling to restore dependencies.` : undefined}
            className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-400 text-white rounded-xl text-[10px] font-black uppercase tracking-wider transition-all shadow-sm"
          >
            {restoring ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
            {restoring ? "Restoring..." : "Restore"}
          </button>
          {restoring && (
            <button
              onClick={cancelRestore}
              className="flex items-center gap-2 px-4 py-2 bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-200 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all"
            >
              Stop Job
            </button>
          )}
        </div>
      </header>

      <div className={cn(
        "rounded-2xl border px-5 py-4",
        workflowGuidance.tone === "green"
          ? "bg-green-50 dark:bg-green-950/10 border-green-100 dark:border-green-900/30 text-green-700 dark:text-green-300"
          : workflowGuidance.tone === "amber"
            ? "bg-amber-50 dark:bg-amber-950/10 border-amber-100 dark:border-amber-900/30 text-amber-700 dark:text-amber-300"
            : "bg-blue-50 dark:bg-blue-950/10 border-blue-100 dark:border-blue-900/30 text-blue-700 dark:text-blue-300"
      )}>
        <p className="text-[10px] font-black uppercase tracking-widest">Lockfile workflow</p>
        <p className="mt-1 text-xs font-black">{workflowGuidance.title}</p>
        <p className="mt-1 text-[11px] font-bold opacity-80">{workflowGuidance.detail}</p>
      </div>

      {readOnlyManager && (
        <div className="rounded-2xl border border-blue-100 dark:border-blue-900/30 bg-blue-50 dark:bg-blue-950/10 px-5 py-4 text-blue-700 dark:text-blue-300">
          <p className="text-[10px] font-black uppercase tracking-widest">{readOnlyManagerName} read-only lockfile mode</p>
          <p className="mt-1 text-[11px] font-bold opacity-80">
            Drift checks can help compare Python packages against an existing requirements.lock, but VOrchestra will not generate pip-style lockfiles or restore packages into this environment. Use the native manager to lock or sync dependencies.
          </p>
        </div>
      )}

      {restoring && restoreProgress && (
        <div className="p-4 bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 rounded-2xl text-xs text-blue-700 dark:text-blue-300 flex items-center gap-3">
          <Loader2 size={16} className="shrink-0 animate-spin" />
          <span>{restoreProgress}</span>
        </div>
      )}

      {(generating || checking) && lockfileProgress && (
        <div className="p-4 bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 rounded-2xl text-xs text-blue-700 dark:text-blue-300 flex items-center gap-3">
          <Loader2 size={16} className="shrink-0 animate-spin" />
          <span>{lockfileProgress}</span>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-2xl text-xs text-red-700 dark:text-red-300 flex items-start gap-3">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <div className="flex-1">
            <p>{stripElevationPrefix(error)}</p>
            {pendingElevation && (
              <button
                onClick={restoreElevatedHint}
                disabled={restoringElevated}
                className="mt-2 px-3 py-1.5 rounded-lg bg-amber-500 text-white text-[10px] font-black uppercase tracking-wider"
              >
                {isWindows ? "How to retry as Administrator" : "How to retry with sudo"}
              </button>
            )}
          </div>
        </div>
      )}

      {report && (
        <div className="space-y-4">
          {(() => {
            const summary = driftSummary(report.entries);
            return !report.in_sync && (
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 rounded-2xl border border-amber-100 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/10 px-5 py-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-300">Recommended next action</p>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{summary.advice}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[9px] font-black uppercase tracking-wider">
                  <span className="vo-surface rounded-full px-2.5 py-1 text-amber-700 dark:text-amber-300">{summary.counts.different_version} version drift</span>
                  <span className="vo-surface rounded-full px-2.5 py-1 text-red-600 dark:text-red-300">{summary.counts.missing} missing</span>
                  <span className="vo-surface rounded-full px-2.5 py-1 text-blue-600 dark:text-blue-300">{summary.counts.extra} extra</span>
                </div>
              </div>
            );
          })()}
          <div className="vo-panel flex items-center justify-between border rounded-2xl px-5 py-3">
            <div className="flex items-center gap-3">
              {report.in_sync ? (
                <span className="flex items-center gap-2 text-green-600 font-black text-xs uppercase tracking-widest">
                  <Check size={14} /> In sync
                </span>
              ) : (
                <span className="flex items-center gap-2 text-amber-600 font-black text-xs uppercase tracking-widest">
                  <GitCompare size={14} /> {report.diff_count} package{report.diff_count === 1 ? "" : "s"} drifted
                </span>
              )}
            </div>
            <span className="text-[10px] font-mono text-slate-400 truncate max-w-[420px]">
              {report.lockfile_path}
            </span>
          </div>

          {report.entries.length > 0 && (
            <div className="vo-panel rounded-2xl border p-4 space-y-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                    Drift explorer
                  </p>
                  <p className="mt-1 text-[11px] font-bold text-slate-400">
                    Showing {visibleDriftEntries.length} of {report.entries.length} packages
                  </p>
                </div>
                <label className="vo-control flex min-w-[220px] items-center gap-2 rounded-xl border px-3 py-2 text-xs">
                  <Search size={14} className="text-slate-400" />
                  <input
                    value={driftQuery}
                    onChange={(event) => setDriftQuery(event.target.value)}
                    placeholder="Search drift..."
                    className="w-full bg-transparent outline-none placeholder:text-slate-400"
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                {DRIFT_FILTERS.map((filter) => (
                  <button
                    key={filter.key}
                    onClick={() => setDriftFilter(filter.key)}
                    className={cn(
                      "rounded-full px-3 py-1.5 text-[9px] font-black uppercase tracking-widest transition-colors",
                      driftFilter === filter.key
                        ? "bg-blue-600 text-white shadow-sm"
                        : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800"
                    )}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <ul className="space-y-1">
            {visibleDriftEntries.map((e: DriftEntry) => {
              const meta = KIND_META[e.kind];
              const Icon = meta.Icon;
              return (
                <li
                  key={e.name + e.kind}
                  className={cn(
                    "flex items-center justify-between px-4 py-2 rounded-xl border text-xs",
                    TONE_BG[meta.tone]
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Icon size={14} />
                    <span className="font-black">{e.name}</span>
                    <span className="text-[9px] font-bold uppercase tracking-widest opacity-70">
                      {meta.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] font-mono">
                    <span className="opacity-60">lock</span>
                    <span>{e.lock_version ?? "—"}</span>
                    <ArrowRight size={10} className="opacity-60" />
                    <span className="opacity-60">env</span>
                    <span>{e.installed_version ?? "—"}</span>
                  </div>
                </li>
              );
            })}
          </ul>

          {report.entries.length === 0 && (
            <p className="text-[11px] text-slate-400 italic px-4">Nothing to compare.</p>
          )}

          {report.entries.length > 0 && visibleDriftEntries.length === 0 && (
            <p className="text-[11px] text-slate-400 italic px-4">No drift entries match the current filters.</p>
          )}
        </div>
      )}

      {!report && !error && (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400 border-2 border-dashed border-slate-100 dark:border-slate-800 rounded-[2rem]">
          <Lock size={32} className="opacity-30 mb-3" />
          <p className="text-[11px] font-bold uppercase tracking-widest">No drift report yet</p>
          <p className="text-[10px] text-slate-500 mt-1">Click <strong>Freeze to Lockfile</strong> first, then revisit later to detect drift.</p>
        </div>
      )}

      {confirmRestoreOpen && (
        <div className="fixed inset-0 z-[90] bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="vo-surface w-full max-w-md rounded-[2rem] border border-amber-100 dark:border-amber-900/40 shadow-2xl overflow-hidden">
            <div className="p-6 bg-amber-50 dark:bg-amber-950/20 border-b border-amber-100 dark:border-amber-900/40">
              <h3 className="text-sm font-black uppercase tracking-widest text-amber-700 dark:text-amber-300">
                Restore from lockfile?
              </h3>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                This installs packages from <span className="font-mono font-black">requirements.lock</span> into this environment and may downgrade, upgrade or add packages.
              </p>
            </div>
            <div className="p-5 flex justify-end gap-2">
              <button
                onClick={() => setConfirmRestoreOpen(false)}
                className="vo-secondary-action px-4 py-2 rounded-xl text-[10px]"
              >
                Cancel
              </button>
              <button
                onClick={restore}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-[10px] font-black uppercase tracking-wider"
              >
                Restore
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
