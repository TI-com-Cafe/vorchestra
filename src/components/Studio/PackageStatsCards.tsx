import React from "react";
import { HardDrive, Layers, Loader2, Plus } from "lucide-react";

interface PackageStatsCardsProps {
  sizeMb: number;
  packageCount: number;
  loadingEnvSize: boolean;
  onAddPackage: () => void;
  readOnly?: boolean;
  readOnlyLabel?: string;
}

export const PackageStatsCards: React.FC<PackageStatsCardsProps> = ({
  sizeMb,
  packageCount,
  loadingEnvSize,
  onAddPackage,
  readOnly = false,
  readOnlyLabel = "read-only"
}) => {
  const sizeUnknown = !loadingEnvSize && packageCount > 0 && sizeMb <= 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="vo-surface p-6 border rounded-3xl shadow-sm flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Disk Allocation</p>
          <p className="text-3xl font-black text-blue-600 flex items-center gap-2">
            {sizeUnknown ? "Unknown" : `${sizeMb.toFixed(1)} MB`}
            {loadingEnvSize && <Loader2 size={18} className="animate-spin text-blue-500" />}
          </p>
          {sizeUnknown && (
            <p className="mt-1 text-[10px] font-bold text-amber-600 dark:text-amber-300">
              Size scan did not return data for this environment yet.
            </p>
          )}
        </div>
        <HardDrive size={32} className="text-slate-200 dark:text-slate-700" />
      </div>
      <div className="vo-surface p-6 border rounded-3xl shadow-sm flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Active Libraries</p>
          <div className="flex items-center gap-4">
            <p className="text-3xl font-black text-blue-600">{packageCount}</p>
            <button
              onClick={onAddPackage}
              disabled={readOnly}
              title={readOnly ? `${readOnlyLabel} environments are inventory-only in VOrchestra.` : "Add package"}
              className="vo-primary-action flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] tracking-tight shadow-lg shadow-blue-600/20 disabled:bg-slate-300 disabled:shadow-none disabled:cursor-not-allowed dark:disabled:bg-slate-700"
            >
              <Plus size={12} /> Add Package
            </button>
          </div>
          {readOnly && (
            <p className="mt-2 text-[10px] font-bold text-amber-600 dark:text-amber-300">
              {readOnlyLabel} inventory is read-only. Use the native manager to mutate packages.
            </p>
          )}
        </div>
        <Layers size={32} className="text-slate-200 dark:text-slate-700" />
      </div>
    </div>
  );
};
