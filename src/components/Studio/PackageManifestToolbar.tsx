import React from "react";
import { FolderSync, List, Loader2, Network, Share2, Sparkles, Upload, X } from "lucide-react";
import { cn } from "../../utils/cn";

export type PackageViewMode = "list" | "tree" | "graph";

interface PackageManifestToolbarProps {
  viewMode: PackageViewMode;
  setViewMode: (mode: PackageViewMode) => void;
  loadingSizes: boolean;
  loadingEnvSize: boolean;
  packageActionActive: boolean;
  syncingProject: boolean;
  analyzingHygiene: boolean;
  readOnly?: boolean;
  readOnlyLabel?: string;
  onStopScans: () => void;
  onExport: () => void;
  onSyncProject: () => void;
  onHygiene: () => void;
}

export const PackageManifestToolbar: React.FC<PackageManifestToolbarProps> = ({
  viewMode,
  setViewMode,
  loadingSizes,
  loadingEnvSize,
  packageActionActive,
  syncingProject,
  analyzingHygiene,
  readOnly = false,
  readOnlyLabel = "read-only",
  onStopScans,
  onExport,
  onSyncProject,
  onHygiene
}) => {
  const viewHint = {
    list: "Flat view is fastest for sorting, package sizes and cleanup decisions.",
    tree: "Tree view explains why packages are installed and may require pipdeptree or uv tree support.",
    graph: "Graph view is best for visual dependency exploration after the package catalog is loaded."
  }[viewMode];

  return (
    <div className="vo-surface space-y-3 select-none rounded-[1.5rem] border p-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-4">
          <h4 className="font-black text-sm uppercase tracking-widest">Library Manifest</h4>
          <div className="vo-subpanel flex p-1 rounded-xl border shadow-inner">
            <ViewButton active={viewMode === "list"} onClick={() => setViewMode("list")} Icon={List} label="Flat" />
            <ViewButton active={viewMode === "tree"} onClick={() => setViewMode("tree")} Icon={Network} label="Tree" />
            <ViewButton active={viewMode === "graph"} onClick={() => setViewMode("graph")} Icon={Share2} label="Graph" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {loadingSizes && viewMode === "list" && (
            <span className="flex items-center gap-2 text-[10px] font-bold text-blue-500 animate-pulse">
              <Loader2 size={12} className="animate-spin" /> Analyzing Sizes
            </span>
          )}
          {(loadingEnvSize || loadingSizes) && (
            <button onClick={onStopScans} className="vo-secondary-action px-3 py-1.5 rounded-xl text-[10px] font-black uppercase text-red-600 hover:underline flex items-center gap-2">
              <X size={14} /> Stop scans
            </button>
          )}
          <button onClick={onExport} disabled={packageActionActive} className="vo-secondary-action px-3 py-1.5 rounded-xl text-[10px] font-black uppercase text-blue-600 hover:underline flex items-center gap-2 disabled:opacity-50">
            <Upload size={14} /> Export
          </button>
          <button
            onClick={onSyncProject}
            disabled={readOnly}
            title={readOnly ? `${readOnlyLabel} environments cannot be synced by pip/uv.` : "Install project dependencies into this environment"}
            className={cn(
              "vo-secondary-action px-3 py-1.5 rounded-xl text-[10px] font-black uppercase hover:underline flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed",
              syncingProject ? "text-red-500" : "text-emerald-600"
            )}
          >
            {syncingProject ? <Loader2 size={14} className="animate-spin" /> : <FolderSync size={14} />}
            {syncingProject ? "Stop Sync" : "Sync Project"}
          </button>
          <button
            onClick={onHygiene}
            className={cn("vo-secondary-action px-3 py-1.5 rounded-xl text-[10px] font-black uppercase hover:underline flex items-center gap-2", analyzingHygiene ? "text-red-500" : "text-amber-600")}
          >
            {analyzingHygiene ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {analyzingHygiene ? "Stop Hygiene" : "Hygiene"}
          </button>
        </div>
      </div>
      <p className="text-[10px] font-bold text-slate-400">{viewHint}</p>
      {readOnly && (
        <p className="rounded-2xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-300">
          {readOnlyLabel} environment detected. Package changes and project sync are read-only in VOrchestra; use the native manager for mutations.
        </p>
      )}
    </div>
  );
};

interface ViewButtonProps {
  active: boolean;
  onClick: () => void;
  Icon: React.ComponentType<{ size?: number }>;
  label: string;
}

const ViewButton: React.FC<ViewButtonProps> = ({ active, onClick, Icon, label }) => (
  <button
    onClick={onClick}
    className={cn(
      "flex items-center gap-1.5 px-3 py-1 rounded-lg text-[9px] font-black uppercase transition-all",
      active ? "bg-white dark:bg-slate-700 text-blue-600 shadow-sm" : "text-slate-400"
    )}
  >
    <Icon size={12} /> {label}
  </button>
);
