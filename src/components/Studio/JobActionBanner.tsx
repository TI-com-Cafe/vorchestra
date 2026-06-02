import React from "react";
import { Loader2, X } from "lucide-react";
import { cn } from "../../utils/cn";

interface JobActionBannerProps {
  label: string;
  logs?: string[];
  tone?: "blue" | "amber";
  onCancel: () => void;
}

export const JobActionBanner: React.FC<JobActionBannerProps> = ({
  label,
  logs = [],
  tone = "blue",
  onCancel
}) => (
  <div
    className={cn(
      "flex flex-col gap-3 px-5 py-3 border rounded-2xl shadow-sm",
      tone === "amber"
        ? "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/50"
        : "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900/50"
    )}
  >
    <div className="flex items-center justify-between gap-3">
      <span
        className={cn(
          "flex items-center gap-2 text-xs font-black uppercase tracking-widest",
          tone === "amber" ? "text-amber-600" : "text-blue-600"
        )}
      >
        <Loader2 size={14} className="animate-spin" /> {label}
        <span className="hidden sm:inline text-[9px] font-bold normal-case tracking-normal opacity-70">
          Running in background. You can keep using this tab.
        </span>
      </span>
      <button
        onClick={onCancel}
        aria-label="Cancel job"
        className="vo-secondary-action flex items-center gap-1 rounded-xl px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-red-600 hover:underline"
      >
        <X size={12} /> Stop job
      </button>
    </div>
    {logs.length > 0 && (
      <pre className="vo-subpanel rounded-xl border p-2 text-[10px] font-mono max-h-24 overflow-auto whitespace-pre-wrap">
        {logs.slice(-6).join("\n")}
      </pre>
    )}
  </div>
);
