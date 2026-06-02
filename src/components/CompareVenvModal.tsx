import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  X, GitCompare, Loader2, ArrowRight, Check, Plus, Minus, AlertCircle, Search
} from "lucide-react";
import { VenvInfo, VenvDiffReport, VenvDiffEntry, DriftKind } from "../types";
import { waitForBackgroundJob } from "../services/backgroundJobs";
import { cn } from "../utils/cn";

interface CompareVenvModalProps {
  source: VenvInfo;
  candidates: VenvInfo[];
  onClose: () => void;
}

const KIND_META: Record<DriftKind, { label: string; tone: string; Icon: React.ComponentType<{ size?: number; className?: string }> }> = {
  different_version: { label: "Differs",        tone: "amber", Icon: ArrowRight },
  missing:           { label: "Only in source", tone: "blue",  Icon: Minus },
  extra:             { label: "Only in target", tone: "green", Icon: Plus },
  in_sync:           { label: "Same",           tone: "slate", Icon: Check }
};

const TONE_BG: Record<string, string> = {
  amber: "bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/30 text-amber-700 dark:text-amber-300",
  blue:  "bg-blue-50 dark:bg-blue-900/10 border-blue-100 dark:border-blue-900/30 text-blue-700 dark:text-blue-300",
  green: "bg-green-50 dark:bg-green-900/10 border-green-100 dark:border-green-900/30 text-green-700 dark:text-green-300",
  slate: "vo-subpanel text-slate-600 dark:text-slate-300"
};

const DIFF_FILTERS: Array<{ key: DriftKind | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "different_version", label: "Differs" },
  { key: "missing", label: "Only source" },
  { key: "extra", label: "Only target" },
  { key: "in_sync", label: "Same" }
];

const diffRecommendation = (report: VenvDiffReport): { title: string; detail: string; tone: "green" | "amber" | "blue" } => {
  if (report.differing === 0 && report.only_in_source === 0 && report.only_in_target === 0) {
    return {
      title: "Environments are aligned",
      detail: "No package drift was detected between source and target.",
      tone: "green"
    };
  }

  if (report.only_in_source > 0 && report.only_in_target === 0 && report.differing === 0) {
    return {
      title: "Target is missing source packages",
      detail: "Target can be brought closer to source by installing the source-only packages.",
      tone: "blue"
    };
  }

  if (report.only_in_target > 0 && report.only_in_source === 0 && report.differing === 0) {
    return {
      title: "Target has extra packages",
      detail: "Review whether the extra target packages are intentional before pruning.",
      tone: "blue"
    };
  }

  return {
    title: "Dependency drift needs review",
    detail: "Version differences or package asymmetry were found. Prefer lockfile/project sync before manual changes.",
    tone: "amber"
  };
};

export const diffActionPlan = (report: VenvDiffReport): string[] => {
  const steps: string[] = [];
  if (report.differing > 0) {
    steps.push(`Resolve ${report.differing} version difference${report.differing === 1 ? "" : "s"} through lockfile or project sync first.`);
  }
  if (report.only_in_source > 0) {
    steps.push(`Install or document ${report.only_in_source} source-only package${report.only_in_source === 1 ? "" : "s"} on the target if parity is required.`);
  }
  if (report.only_in_target > 0) {
    steps.push(`Review ${report.only_in_target} target-only package${report.only_in_target === 1 ? "" : "s"} before pruning; they may be intentional tooling.`);
  }
  if (steps.length === 0) {
    steps.push("No reconciliation is needed; both environments expose the same package set and versions.");
  } else {
    steps.push("After changes, rerun Compare to confirm drift is gone.");
  }
  return steps;
};

export const CompareVenvModal: React.FC<CompareVenvModalProps> = ({
  source, candidates, onClose
}) => {
  const [target, setTarget] = useState<string>(candidates[0]?.path ?? "");
  const [comparing, setComparing] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const [report, setReport] = useState<VenvDiffReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diffFilter, setDiffFilter] = useState<DriftKind | "all">("all");
  const [diffQuery, setDiffQuery] = useState("");

  const compare = async () => {
    if (!target) return;
    setComparing(true);
    setProgress("Preparing comparison...");
    setError(null);
    try {
      const startedJobId = await invoke<string>("start_diff_venvs_job", {
        sourcePath: source.path,
        targetPath: target
      });
      setJobId(startedJobId);
      const r = await waitForBackgroundJob<VenvDiffReport>(startedJobId, (snapshot) => {
        if (!snapshot.message) return;
        const pct = typeof snapshot.progress === "number"
          ? ` ${Math.round(snapshot.progress * 100)}%`
          : "";
        setProgress(`${snapshot.message}${pct}`);
      });
      setReport(r);
      setDiffFilter("all");
      setDiffQuery("");
      setProgress("");
    } catch (err) {
      setError(`${err}`);
    } finally {
      setJobId(null);
      setComparing(false);
    }
  };

  const filteredEntries = report?.entries.filter((entry) => {
    const matchesKind = diffFilter === "all" || entry.kind === diffFilter;
    const query = diffQuery.trim().toLowerCase();
    const matchesQuery = query.length === 0 || entry.name.toLowerCase().includes(query);
    return matchesKind && matchesQuery;
  }) ?? [];

  const cancelCompare = async () => {
    if (!jobId) return;
    setProgress("Cancelling comparison...");
    await invoke<boolean>("cancel_background_job", { jobId });
  };

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-md z-[80] flex items-center justify-center p-8 animate-in fade-in duration-200">
      <div className="vo-surface w-full max-w-3xl max-h-[88vh] rounded-[2rem] border shadow-2xl overflow-hidden flex flex-col">
        <div className="vo-panel p-6 border-b flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 vo-primary-action rounded-2xl shadow-lg shadow-blue-600/30"><GitCompare size={18} /></div>
            <div>
              <h2 className="text-base font-black uppercase tracking-widest">Compare Venvs</h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Side-by-side package diff</p>
            </div>
          </div>
          <button onClick={onClose} className="vo-icon-button text-slate-400">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4 flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Source</label>
              <div className="mt-1 px-3 py-2 vo-control border rounded-lg text-xs font-mono truncate">
                {source.name}
              </div>
            </div>
            <div>
              <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Target</label>
              <select
                value={target}
                onChange={(e) => { setTarget(e.target.value); setReport(null); }}
                className="mt-1 w-full px-3 py-2 vo-control border rounded-lg text-xs"
              >
                {candidates.length === 0 && <option value="">No other venvs</option>}
                {candidates.map(v => (
                  <option key={v.path} value={v.path}>{v.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={compare}
              disabled={comparing || !target || target === source.path}
              className="flex items-center gap-2 px-5 py-2 vo-primary-action disabled:bg-slate-400 rounded-lg text-[10px] font-black uppercase tracking-wider"
            >
              {comparing ? <Loader2 size={12} className="animate-spin" /> : <GitCompare size={12} />}
              {comparing ? "Comparing..." : "Compare"}
            </button>
            {comparing && jobId && (
              <button
                onClick={cancelCompare}
                className="px-4 py-2 bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-200 rounded-lg text-[10px] font-black uppercase tracking-wider"
              >
                Cancel
              </button>
            )}
            {progress && <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{progress}</span>}
          </div>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-lg flex items-start gap-2 text-[11px] text-red-700 dark:text-red-300">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {report && (
            <>
              <section className={cn("rounded-2xl border p-4", TONE_BG[diffRecommendation(report).tone])}>
                <h3 className="text-[10px] font-black uppercase tracking-widest">Comparison guidance</h3>
                <p className="mt-1 text-sm font-black">{diffRecommendation(report).title}</p>
                <p className="mt-1 text-[10px] font-bold opacity-80">{diffRecommendation(report).detail}</p>
              </section>

              <section className="rounded-2xl border border-blue-100 dark:border-blue-900/30 bg-blue-50/70 dark:bg-blue-950/10 p-4">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300">Reconciliation plan</h3>
                <ol className="mt-2 space-y-1.5">
                  {diffActionPlan(report).map((step, index) => (
                    <li key={step} className="flex gap-2 text-[10px] font-bold text-slate-600 dark:text-slate-300">
                      <span className="shrink-0 text-blue-600 dark:text-blue-300">{index + 1}.</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </section>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Metric label="Same"           value={report.matching}        tone="slate" />
                <Metric label="Differs"        value={report.differing}       tone="amber" />
                <Metric label="Only in source" value={report.only_in_source}  tone="blue" />
                <Metric label="Only in target" value={report.only_in_target}  tone="green" />
              </div>

              <section className="vo-subpanel rounded-2xl border p-3 space-y-3">
                <div className="flex flex-col md:flex-row gap-2 md:items-center md:justify-between">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Diff explorer</p>
                    <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                      Showing {filteredEntries.length} of {report.entries.length} packages
                    </p>
                  </div>
                  <div className="relative w-full md:w-64">
                    <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      value={diffQuery}
                      onChange={(e) => setDiffQuery(e.target.value)}
                      placeholder="Search package..."
                      className="w-full pl-8 pr-3 py-2 vo-control border rounded-xl text-xs outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {DIFF_FILTERS.map((filter) => (
                    <button
                      key={filter.key}
                      onClick={() => setDiffFilter(filter.key)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider border transition-colors",
                        diffFilter === filter.key
                          ? "bg-blue-600 border-blue-600 text-white"
                          : "vo-control border text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                      )}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
              </section>

              <ul className="space-y-1">
                {filteredEntries.map((e: VenvDiffEntry) => {
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
                        <span className="opacity-60">src</span>
                        <span>{e.source_version ?? "—"}</span>
                        <ArrowRight size={10} className="opacity-60" />
                        <span className="opacity-60">tgt</span>
                        <span>{e.target_version ?? "—"}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {filteredEntries.length === 0 && (
                <div className="vo-panel p-6 rounded-2xl border border-dashed text-center text-[11px] font-bold text-slate-400">
                  No packages match the current diff filters.
                </div>
              )}
            </>
          )}
        </div>

        <div className="vo-panel p-4 border-t flex justify-end">
          <button onClick={onClose} className="px-4 py-1.5 vo-secondary-action rounded-lg text-[10px] font-black uppercase">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

const Metric: React.FC<{ label: string; value: number; tone: string }> = ({ label, value, tone }) => (
  <div className={cn("rounded-xl border px-3 py-2", TONE_BG[tone])}>
    <p className="text-2xl font-black leading-none">{value}</p>
    <p className="text-[9px] font-bold uppercase tracking-widest opacity-70 mt-1">{label}</p>
  </div>
);
