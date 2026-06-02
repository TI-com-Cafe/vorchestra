import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  HardDrive, X, Loader2, Trash2, RefreshCcw, Database, Folder, AlertCircle, ChevronDown, ChevronRight, ExternalLink
} from "lucide-react";
import { CacheSummary, CacheLocation, CacheEntry, VenvCleanupCandidate, VenvInfo } from "../types";
import { waitForBackgroundJob } from "../services/backgroundJobs";
import { dbService } from "../services/db";

interface CacheOverlayProps {
  venvPaths: string[];
  venvs?: VenvInfo[];
  onOpenStudio?: (venv: VenvInfo) => void | Promise<void>;
  onClose: () => void;
  setMessage: (msg: string) => void;
}

type CleanupFilter = "all" | "candidates" | "large" | "stale" | "missing";

const CLEANUP_FILTERS: Array<{ id: CleanupFilter; label: string }> = [
  { id: "candidates", label: "Candidates" },
  { id: "large", label: "Large" },
  { id: "stale", label: "Stale" },
  { id: "missing", label: "Missing" },
  { id: "all", label: "All" }
];

const formatSize = (mb: number): string => {
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${(mb * 1024).toFixed(0)} KB`;
};

const largestExistingLocation = (summary: CacheSummary): CacheLocation | null =>
  summary.locations
    .filter(loc => loc.exists && loc.size_mb > 0)
    .sort((a, b) => b.size_mb - a.size_mb)[0] ?? null;

const perVenvCacheTotal = (summary: CacheSummary): number =>
  summary.locations
    .filter(loc => loc.kind === "uv_per_venv" && loc.exists)
    .reduce((sum, loc) => sum + loc.size_mb, 0);

const duplicateWheelTotal = (summary: CacheSummary): number =>
  summary.duplicate_wheels.reduce((sum, group) => sum + group.total_mb, 0);

const cleanupCandidateCount = (summary: CacheSummary): number =>
  summary.venvs.filter(v => !v.signals.includes("normal")).length;

const staleVenvCount = (summary: CacheSummary): number =>
  summary.venvs.filter(v => v.signals.includes("stale")).length;

const missingVenvCount = (summary: CacheSummary): number =>
  summary.venvs.filter(v => v.signals.includes("missing")).length;

const matchesCleanupFilter = (venv: VenvCleanupCandidate, filter: CleanupFilter): boolean => {
  if (filter === "all") return true;
  if (filter === "candidates") return !venv.signals.includes("normal");
  return venv.signals.includes(filter);
};

const cleanupFilterCount = (summary: CacheSummary, filter: CleanupFilter): number =>
  summary.venvs.filter(venv => matchesCleanupFilter(venv, filter)).length;

const cleanupPlan = (summary: CacheSummary): string[] => {
  const largest = largestExistingLocation(summary);
  const staleLarge = summary.venvs.filter(venv =>
    venv.signals.includes("large") && venv.signals.includes("stale")
  ).length;
  const missing = missingVenvCount(summary);
  const duplicates = summary.duplicate_wheels.length;
  const steps: string[] = [];

  if (largest && largest.size_mb >= 100) {
    steps.push(`Clear ${largest.label} first to reclaim ${formatSize(largest.size_mb)} of disposable cache.`);
  }
  if (staleLarge > 0) {
    steps.push(`Review ${staleLarge} large stale environment${staleLarge === 1 ? "" : "s"} before deleting anything manually.`);
  }
  if (missing > 0) {
    steps.push(`Remove ${missing} missing database entr${missing === 1 ? "y" : "ies"} to clean the inventory.`);
  }
  if (duplicates > 0) {
    steps.push(`${duplicates} duplicate wheel group${duplicates === 1 ? "" : "s"} can be reclaimed by clearing cache locations.`);
  }

  return steps.length > 0 ? steps.slice(0, 4) : ["No immediate cleanup action is needed. Keep caches unless disk pressure appears."];
};

const cleanupRecommendation = (venv: VenvCleanupCandidate): string => {
  const isMissing = venv.signals.includes("missing");
  const isLarge = venv.signals.includes("large");
  const isStale = venv.signals.includes("stale");

  if (isMissing) return "Safe cleanup: remove the stale database entry; the folder is already missing.";
  if (isLarge && isStale) return "Review in Studio before deleting; export a bundle if this environment might be reused.";
  if (isLarge) return "Inspect package sizes before deleting; large active environments may be valid.";
  if (isStale) return "Open terminal or Studio to confirm it is no longer used.";
  return "No cleanup action recommended.";
};

export const CacheOverlay: React.FC<CacheOverlayProps> = ({ venvPaths, venvs = [], onOpenStudio, onClose, setMessage }) => {
  const [summary, setSummary] = useState<CacheSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState<string | null>(null);
  const [loadingJobId, setLoadingJobId] = useState<string | null>(null);
  const [purging, setPurging] = useState<string | null>(null);
  const [purgeProgress, setPurgeProgress] = useState<string | null>(null);
  const [purgeJobId, setPurgeJobId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [cleanupFilter, setCleanupFilter] = useState<CleanupFilter>("candidates");
  const [pendingPurge, setPendingPurge] = useState<CacheLocation | null>(null);
  const [pendingMissingEntry, setPendingMissingEntry] = useState<VenvCleanupCandidate | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = async () => {
    setLoading(true);
    setLoadingProgress("Starting cache scan...");
    let activeJobId: string | null = null;
    try {
      const jobId = await invoke<string>("start_get_cache_summary_job", { venvPaths });
      activeJobId = jobId;
      if (mountedRef.current) setLoadingJobId(jobId);
      const r = await waitForBackgroundJob<CacheSummary>(jobId, (snapshot) => {
        if (!snapshot.message) return;
        const pct = typeof snapshot.progress === "number"
          ? ` ${Math.round(snapshot.progress * 100)}%`
          : "";
        setLoadingProgress(`${snapshot.message}${pct}`);
      });
      if (mountedRef.current) setSummary(r);
    } catch (err) {
      if (mountedRef.current) {
        const message = String(err).includes("Operation cancelled")
          ? "Cache scan cancelled."
          : `Failed to read cache info: ${err}`;
        setMessage(message);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
      if (mountedRef.current) setLoadingProgress(null);
      if (mountedRef.current) {
        setLoadingJobId(current => (current === activeJobId ? null : current));
      }
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestPurge = (loc: CacheLocation) => {
    setPendingMissingEntry(null);
    setPendingPurge(loc);
  };

  const purge = async (loc: CacheLocation) => {
    setPendingPurge(null);
    setPurging(loc.path);
    setPurgeProgress("Starting purge...");
    let activeJobId: string | null = null;
    try {
      const jobId = await invoke<string>("start_purge_cache_job", { path: loc.path });
      activeJobId = jobId;
      if (mountedRef.current) setPurgeJobId(jobId);
      const out = await waitForBackgroundJob<string>(jobId, (snapshot) => {
        if (!snapshot.message) return;
        const pct = typeof snapshot.progress === "number"
          ? ` ${Math.round(snapshot.progress * 100)}%`
          : "";
        setPurgeProgress(`${snapshot.message}${pct}`);
      });
      setMessage(out);
      await refresh();
    } catch (err) {
      const message = String(err).includes("Operation cancelled")
        ? "Cache purge cancelled."
        : `Purge failed: ${err}`;
      if (mountedRef.current) setMessage(message);
    } finally {
      if (mountedRef.current) {
        setPurging(null);
        setPurgeProgress(null);
        setPurgeJobId(current => (current === activeJobId ? null : current));
      }
    }
  };

  const cancelJob = async (jobId: string | null, label: string) => {
    if (!jobId) return;
    try {
      await invoke<boolean>("cancel_background_job", { jobId });
      setMessage(`${label} cancellation requested.`);
    } catch (err) {
      setMessage(`Failed to cancel ${label.toLowerCase()}: ${err}`);
    }
  };

  const toggle = (path: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const largest = summary ? largestExistingLocation(summary) : null;
  const perVenvTotal = summary ? perVenvCacheTotal(summary) : 0;
  const duplicatesTotal = summary ? duplicateWheelTotal(summary) : 0;
  const candidateCount = summary ? cleanupCandidateCount(summary) : 0;
  const staleCount = summary ? staleVenvCount(summary) : 0;
  const missingCount = summary ? missingVenvCount(summary) : 0;
  const plan = summary ? cleanupPlan(summary) : [];
  const venvByPath = new Map(venvs.map(venv => [venv.path, venv]));
  const filteredVenvs = summary
    ? summary.venvs.filter(venv => matchesCleanupFilter(venv, cleanupFilter))
    : [];

  const openVenvLocation = async (venv: VenvCleanupCandidate) => {
    if (!venv.exists) {
      setMessage(`${venv.name} is missing on disk. Use Hygiene to prune stale database entries.`);
      return;
    }
    try {
      await invoke("open_terminal", { path: venv.path });
      setMessage(`Opening ${venv.name} for review...`);
    } catch (err) {
      setMessage(`Failed to open ${venv.name}: ${err}`);
    }
  };

  const removeMissingVenvEntry = async (venv: VenvCleanupCandidate) => {
    setPendingPurge(null);
    setPendingMissingEntry(venv);
  };

  const confirmRemoveMissingVenvEntry = async (venv: VenvCleanupCandidate) => {
    setPendingMissingEntry(null);
    try {
      await dbService.removeVenvByPath(venv.path);
      setSummary(prev => prev
        ? { ...prev, venvs: prev.venvs.filter(item => item.path !== venv.path) }
        : prev
      );
      setMessage(`Removed stale entry for ${venv.name}.`);
    } catch (err) {
      setMessage(`Failed to remove stale entry for ${venv.name}: ${err}`);
    }
  };

  const openVenvStudio = async (candidate: VenvCleanupCandidate) => {
    const matched = venvByPath.get(candidate.path);
    if (!matched || !onOpenStudio) {
      await openVenvLocation(candidate);
      return;
    }

    try {
      await onOpenStudio(matched);
      setMessage(`Opening ${candidate.name} in Studio...`);
    } catch (err) {
      setMessage(`Failed to open ${candidate.name} in Studio: ${err}`);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-xl z-[60] flex items-center justify-center p-12 animate-in fade-in duration-200">
      <div className="vo-surface w-full max-w-3xl max-h-[85vh] rounded-[3rem] border shadow-2xl flex flex-col overflow-hidden">
        <div className="vo-panel p-7 border-b flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-600 text-white rounded-2xl shadow-lg shadow-blue-600/30"><HardDrive size={22} /></div>
            <div>
              <h2 className="text-base font-black uppercase tracking-widest">Cache Hygiene</h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">
                {summary
                  ? `Total ${formatSize(summary.total_mb)} across ${summary.locations.length} location${summary.locations.length === 1 ? "" : "s"}`
                  : "Inspecting cache directories..."}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={refresh}
              disabled={loading}
              className="vo-icon-button p-2"
              title="Re-scan"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : <RefreshCcw size={18} />}
            </button>
            {loadingJobId && (
              <button
                onClick={() => cancelJob(loadingJobId, "Cache scan")}
                className="px-3 py-1.5 rounded-xl bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-200 text-[9px] font-black uppercase tracking-wider hover:bg-amber-200 dark:hover:bg-amber-900/60 transition-all"
              >
                Stop scan
              </button>
            )}
            <button onClick={onClose} className="vo-icon-button p-2">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {loading && !summary ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
              <Loader2 size={28} className="animate-spin text-blue-600" />
              <p className="text-[10px] font-black uppercase tracking-widest">Computing cache sizes...</p>
              {loadingProgress && (
                <p className="text-[10px] font-bold text-slate-500">{loadingProgress}</p>
              )}
              {loadingJobId && (
                <button
                  onClick={() => cancelJob(loadingJobId, "Cache scan")}
                  className="mt-2 px-4 py-2 rounded-xl bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-200 text-[10px] font-black uppercase tracking-wider"
                >
                  Stop scan
                </button>
              )}
            </div>
          ) : summary && summary.locations.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">No known cache locations were found on this machine.</div>
          ) : (
            <>
              {summary && (
                <section className="rounded-3xl border border-blue-100 dark:border-blue-900/30 bg-blue-50/70 dark:bg-blue-950/10 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-[10px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300">
                        Cleanup opportunities
                      </h3>
                      <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                        Prioritized by reclaimable cache size. Clearing cache never deletes installed packages.
                      </p>
                    </div>
                    {largest && (
                      <button
                        onClick={() => requestPurge(largest)}
                        disabled={!!purging}
                        className="vo-primary-action shrink-0 px-3 py-1.5 rounded-xl disabled:bg-slate-400 text-[10px]"
                      >
                        Clear largest
                      </button>
                    )}
                    {purgeJobId && (
                      <button
                        onClick={() => cancelJob(purgeJobId, "Cache purge")}
                        className="shrink-0 px-3 py-1.5 rounded-xl bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-200 text-[10px] font-black uppercase tracking-wider hover:bg-amber-200 dark:hover:bg-amber-900/60 transition-all"
                      >
                        Stop purge
                      </button>
                    )}
                  </div>
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-2">
                    <CleanupMetric
                      label="Largest target"
                      value={largest ? formatSize(largest.size_mb) : "None"}
                      detail={largest?.label ?? "No cache to clear"}
                    />
                    <CleanupMetric
                      label="Per-venv uv caches"
                      value={formatSize(perVenvTotal)}
                      detail={`${summary.locations.filter(loc => loc.kind === "uv_per_venv" && loc.exists).length} location(s)`}
                    />
                    <CleanupMetric
                      label="Duplicate wheels"
                      value={formatSize(duplicatesTotal)}
                      detail={`${summary.duplicate_wheels.length} duplicate group(s)`}
                    />
                  </div>
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2">
                    <CleanupMetric
                      label="Environment disk"
                      value={formatSize(summary.total_venv_mb)}
                      detail={`${summary.venvs.length} environment(s) tracked`}
                    />
                    <CleanupMetric
                      label="Cleanup candidates"
                      value={`${candidateCount}`}
                      detail={`${staleCount} stale, ${missingCount} missing`}
                    />
                    <CleanupMetric
                      label="Stale threshold"
                      value="30 days"
                      detail="No auto-delete; review first"
                    />
                  </div>
                  <div className="vo-subpanel mt-4 rounded-2xl border border-blue-100/80 dark:border-blue-900/30 p-4">
                    <h4 className="text-[9px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300">
                      Cleanup plan
                    </h4>
                    <ol className="mt-2 space-y-1.5">
                      {plan.map((step, index) => (
                        <li key={step} className="flex gap-2 text-[10px] font-bold text-slate-600 dark:text-slate-300">
                          <span className="shrink-0 text-blue-600 dark:text-blue-300">{index + 1}.</span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </section>
              )}

              {summary && summary.venvs.length > 0 && (
                <section className="vo-surface rounded-2xl border overflow-hidden">
                  <div className="vo-panel px-5 py-3 border-b flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-4">
                    <div>
                      <h3 className="text-[10px] font-black uppercase tracking-widest">Environment cleanup</h3>
                      <p className="text-[10px] text-slate-400">Largest, stale, or missing environments. Review before deleting.</p>
                    </div>
                    <span className="text-[10px] font-black text-blue-600 tabular-nums">{formatSize(summary.total_venv_mb)}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {CLEANUP_FILTERS.map(filter => {
                        const count = cleanupFilterCount(summary, filter.id);
                        const active = cleanupFilter === filter.id;
                        return (
                          <button
                            key={filter.id}
                            onClick={() => setCleanupFilter(filter.id)}
                            className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider transition-colors ${
                              active
                                ? "bg-blue-600 text-white"
                                : "vo-secondary-action"
                            }`}
                          >
                            {filter.label} · {count}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredVenvs.length === 0 ? (
                      <p className="px-5 py-5 text-[10px] text-slate-400 italic">
                        No environments match this cleanup filter.
                      </p>
                    ) : (
                      filteredVenvs.slice(0, 12).map(venv => (
                        <VenvCleanupRow
                          key={venv.path}
                          venv={venv}
                          studioVenv={venvByPath.get(venv.path)}
                          onOpenStudio={() => openVenvStudio(venv)}
                          onOpenTerminal={() => openVenvLocation(venv)}
                          onRemoveMissing={() => removeMissingVenvEntry(venv)}
                        />
                      ))
                    )}
                  </div>
                </section>
              )}

              {summary?.locations.map(loc => {
                const isOpen = expanded.has(loc.path);
                const isPurging = purging === loc.path;
                return (
                  <div key={loc.path} className="vo-surface border rounded-2xl overflow-hidden">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => toggle(loc.path)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggle(loc.path);
                        }
                      }}
                      className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50/80 dark:hover:bg-slate-800/30 transition-colors"
                    >
                      <div className="flex items-center gap-3 text-left">
                        <div className="p-2 bg-blue-50 dark:bg-blue-900/20 text-blue-600 rounded-lg">
                          {loc.kind === "uv_per_venv" ? <Folder size={14} /> : <Database size={14} />}
                        </div>
                        <div>
                          <p className="text-xs font-black">{loc.label}</p>
                          <p className="text-[10px] font-mono text-slate-400 truncate max-w-[420px]">{loc.path}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-black text-blue-600 tabular-nums">
                          {loc.exists ? formatSize(loc.size_mb) : "—"}
                        </span>
                        {loc.exists && (
                          <button
                            onClick={(e) => { e.stopPropagation(); requestPurge(loc); }}
                            disabled={isPurging}
                            className="flex items-center gap-1 px-2 py-1 bg-red-50 dark:bg-red-900/20 hover:bg-red-500 hover:text-white text-red-600 rounded-lg text-[9px] font-black uppercase tracking-wider disabled:opacity-50"
                          >
                            {isPurging ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
                            {isPurging ? "Clearing..." : "Clear"}
                          </button>
                        )}
                        {isOpen ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                      </div>
                    </div>

                    {isOpen && loc.exists && (
                      <div className="vo-panel px-5 py-3 border-t">
                        {isPurging && purgeProgress && (
                          <div className="mb-3 flex items-center gap-2 text-[10px] font-bold text-blue-600">
                            <Loader2 size={11} className="animate-spin" />
                            <span>{purgeProgress}</span>
                          </div>
                        )}
                        {loc.top_entries.length === 0 ? (
                          <p className="text-[10px] italic text-slate-400">Cache directory is empty.</p>
                        ) : (
                          <ul className="space-y-1">
                            <li className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Top entries</li>
                            {loc.top_entries.map((e: CacheEntry) => (
                              <li key={e.path} className="flex items-center justify-between text-[11px] font-mono">
                                <span className="truncate">{e.name}</span>
                                <span className="font-black text-slate-500 tabular-nums">{formatSize(e.size_mb)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}

                    {!loc.exists && (
                      <div className="vo-panel px-5 py-3 border-t text-[10px] italic text-slate-400 flex items-center gap-2">
                        <AlertCircle size={11} /> Directory does not exist yet — will be created on first install.
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {summary && summary.duplicate_wheels.length > 0 && (
            <section className="mt-5 rounded-2xl border border-amber-200 dark:border-amber-900/40 bg-amber-50/60 dark:bg-amber-950/10 p-4">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-300 mb-3">
                Duplicate wheels detected
              </h3>
              <ul className="space-y-2">
                {summary.duplicate_wheels.map(group => (
                  <li key={group.file_name} className="rounded-xl bg-white/70 dark:bg-slate-950/50 border border-amber-100 dark:border-amber-900/30 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-black font-mono truncate">{group.file_name}</span>
                      <span className="text-[10px] font-black text-amber-700 dark:text-amber-300">
                        {group.copies} copies · {formatSize(group.total_mb)}
                      </span>
                    </div>
                    <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                      These are safe cache duplicates, not installed packages. Clearing one of the caches above reclaims space.
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {(pendingPurge || pendingMissingEntry) && (
          <div className="mx-6 mb-4 rounded-2xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/20 p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-300">
                Confirm cleanup action
              </p>
              {pendingPurge && (
                <p className="mt-1 text-[11px] font-bold text-slate-600 dark:text-slate-300">
                  Clear {pendingPurge.label} and reclaim {formatSize(pendingPurge.size_mb)}. This only removes cached downloads; future installs may re-download packages.
                </p>
              )}
              {pendingMissingEntry && (
                <p className="mt-1 text-[11px] font-bold text-slate-600 dark:text-slate-300">
                  Remove stale database entry for {pendingMissingEntry.name}. The folder is already missing on disk.
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => { setPendingPurge(null); setPendingMissingEntry(null); }}
                  className="vo-secondary-action px-4 py-2 rounded-xl text-[10px]"
                >
                Cancel
              </button>
              {pendingPurge && (
                <button
                  onClick={() => purge(pendingPurge)}
                  className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[10px] font-black uppercase tracking-wider"
                >
                  Confirm clear cache
                </button>
              )}
              {pendingMissingEntry && (
                <button
                  onClick={() => confirmRemoveMissingVenvEntry(pendingMissingEntry)}
                  className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[10px] font-black uppercase tracking-wider"
                >
                  Confirm remove entry
                </button>
              )}
            </div>
          </div>
        )}

        <div className="vo-panel p-4 border-t text-center text-[9px] font-bold text-slate-400 uppercase tracking-[0.2em]">
          Clearing a cache only forces re-downloads on the next install. It never touches your venvs.
        </div>
      </div>
    </div>
  );
};

const CleanupMetric: React.FC<{ label: string; value: string; detail: string }> = ({ label, value, detail }) => (
  <div className="vo-subpanel rounded-2xl border border-blue-100/80 dark:border-blue-900/20 px-4 py-3">
    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</p>
    <p className="mt-1 text-sm font-black text-slate-900 dark:text-white tabular-nums">{value}</p>
    <p className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400 truncate">{detail}</p>
  </div>
);

const VenvCleanupRow: React.FC<{
  venv: VenvCleanupCandidate;
  studioVenv?: VenvInfo;
  onOpenStudio: () => void;
  onOpenTerminal: () => void;
  onRemoveMissing: () => void;
}> = ({ venv, studioVenv, onOpenStudio, onOpenTerminal, onRemoveMissing }) => {
  const isMissing = venv.signals.includes("missing");
  const isLarge = venv.signals.includes("large");
  const isStale = venv.signals.includes("stale");
  const signalLabel = isMissing
    ? "Missing"
    : isLarge && isStale
      ? "Large + stale"
      : isLarge
        ? "Large"
        : isStale
          ? "Stale"
          : "Normal";

  return (
    <div className="px-5 py-3 flex items-center justify-between gap-4">
      <div className="min-w-0 flex items-center gap-3">
        <div className={`p-2 rounded-lg ${isMissing ? "bg-red-50 dark:bg-red-900/20 text-red-600" : "vo-subpanel text-blue-600"}`}>
          <Folder size={14} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-xs font-black truncate">{venv.name}</p>
            <span className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${isMissing ? "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-200" : isLarge || isStale ? "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-200" : "bg-slate-100 dark:bg-slate-800 text-slate-500"}`}>
              {signalLabel}
            </span>
          </div>
          <p className="text-[10px] font-mono text-slate-400 truncate max-w-[420px]">{venv.path}</p>
          <p className="text-[10px] text-slate-400">
            {venv.days_since_modified == null ? "Modification age unknown" : `${venv.days_since_modified} day(s) since modified`}
          </p>
          <p className="mt-0.5 text-[10px] font-bold text-slate-500 dark:text-slate-400">
            {cleanupRecommendation(venv)}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-xs font-black text-blue-600 tabular-nums">{formatSize(venv.size_mb)}</span>
        {isMissing ? (
          <div className="flex items-center gap-2">
            <button
              onClick={onRemoveMissing}
              aria-label={`Remove stale entry for ${venv.name}`}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-red-50 dark:bg-red-950/40 hover:bg-red-600 hover:text-white text-red-600 dark:text-red-300 text-[9px] font-black uppercase tracking-wider"
            >
              <Trash2 size={10} />
              Remove entry
            </button>
            <button
              onClick={onOpenTerminal}
              aria-label={`Show prune hint for ${venv.name}`}
              className="vo-secondary-action flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] hover:bg-blue-600 hover:text-white"
            >
              <ExternalLink size={10} />
              Hint
            </button>
          </div>
        ) : (
          <>
            {studioVenv && (
              <button
                onClick={onOpenStudio}
                aria-label={`Open ${venv.name} in Studio`}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-600 hover:text-white text-blue-600 dark:text-blue-300 text-[9px] font-black uppercase tracking-wider transition-all"
              >
                <ExternalLink size={10} />
                Studio
              </button>
            )}
            <button
              onClick={onOpenTerminal}
              aria-label={`Open ${venv.name} terminal`}
              className="vo-secondary-action flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] hover:bg-blue-600 hover:text-white"
            >
              <ExternalLink size={10} />
              Terminal
            </button>
          </>
        )}
      </div>
    </div>
  );
};
