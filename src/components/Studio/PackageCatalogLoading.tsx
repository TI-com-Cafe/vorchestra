import React from "react";
import { Loader2, Package, X } from "lucide-react";

interface PackageCatalogLoadingProps {
  onCancel: () => void;
}

export const PackageCatalogLoading: React.FC<PackageCatalogLoadingProps> = ({ onCancel }) => (
  <div className="vo-surface mx-auto flex max-w-xl flex-col items-center justify-center rounded-[2rem] border px-8 py-16 gap-6 text-slate-400 animate-in fade-in duration-500 shadow-sm">
    <div className="relative">
      <Loader2 size={64} className="animate-spin text-blue-600 opacity-20" />
      <div className="absolute inset-0 flex items-center justify-center">
        <Package size={24} className="text-blue-600 animate-pulse" />
      </div>
    </div>
    <div className="text-center space-y-2">
      <p className="font-black uppercase tracking-[0.2em] text-xs text-slate-600 dark:text-slate-300">Cataloging Environment</p>
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest animate-pulse">Reading site-packages...</p>
      <p className="max-w-sm text-[10px] font-bold leading-relaxed text-slate-500 dark:text-slate-400">
        Package cataloging runs as a cancellable background job. Cancel if you need to delete or recreate this environment now.
      </p>
    </div>
    <button
      onClick={onCancel}
      aria-label="Cancel cataloging"
      className="vo-secondary-action flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest text-red-600 hover:border-red-200"
    >
      <X size={12} /> Stop cataloging
    </button>
  </div>
);
