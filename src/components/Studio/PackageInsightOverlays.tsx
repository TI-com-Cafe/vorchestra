import React from "react";
import { FileQuestion, Info, Sparkles } from "lucide-react";
import { PackageHygieneReport } from "../../types";
import { PackageInsightModal } from "./PackageInsightModal";

interface PackageInsightOverlaysProps {
  upgradePreview: { name: string; output: string } | null;
  whyReport: { name: string; parents: string[] } | null;
  hygieneReport: PackageHygieneReport | null;
  onCloseUpgrade: () => void;
  onCloseWhy: () => void;
  onCloseHygiene: () => void;
  onUninstallRootPackage: (name: string) => void;
}

const upgradeGuidance = (output: string): { title: string; detail: string; tone: string } => {
  const lower = output.toLowerCase();
  if (!output.trim()) {
    return {
      title: "No resolver changes",
      detail: "The package may already be current. Re-run diagnostics if you expected a version change.",
      tone: "slate"
    };
  }
  if (lower.includes("error") || lower.includes("conflict") || lower.includes("incompatible")) {
    return {
      title: "Review before applying",
      detail: "The dry-run includes resolver errors or conflicts. Prefer lockfile/project sync before forcing an upgrade.",
      tone: "amber"
    };
  }
  if (lower.includes("would install") || lower.includes("would uninstall") || lower.includes("would upgrade")) {
    return {
      title: "Resolver has a concrete plan",
      detail: "Review added, removed, downgraded, or upgraded packages before running the real update.",
      tone: "blue"
    };
  }
  return {
    title: "Read the resolver output",
    detail: "The dry-run completed. Confirm the package plan matches the project before applying changes.",
    tone: "slate"
  };
};

const guidanceToneClass = (tone: string): string => {
  if (tone === "amber") return "border-amber-100 dark:border-amber-900/30 bg-amber-50 dark:bg-amber-950/10 text-amber-700 dark:text-amber-300";
  if (tone === "blue") return "border-blue-100 dark:border-blue-900/30 bg-blue-50 dark:bg-blue-950/10 text-blue-700 dark:text-blue-300";
  return "vo-subpanel text-slate-600 dark:text-slate-300";
};

export const PackageInsightOverlays: React.FC<PackageInsightOverlaysProps> = ({
  upgradePreview,
  whyReport,
  hygieneReport,
  onCloseUpgrade,
  onCloseWhy,
  onCloseHygiene,
  onUninstallRootPackage
}) => (
  <>
    {upgradePreview && (
      <PackageInsightModal
        title={`Upgrade preview: ${upgradePreview.name}`}
        subtitle="Dry-run plan from the resolver — nothing was installed yet."
        Icon={FileQuestion}
        onClose={onCloseUpgrade}
      >
        {(() => {
          const guidance = upgradeGuidance(upgradePreview.output);
          return (
            <div className={`mb-3 rounded-2xl border p-3 ${guidanceToneClass(guidance.tone)}`}>
              <p className="text-[10px] font-black uppercase tracking-widest">Upgrade guidance</p>
              <p className="mt-1 text-sm font-black">{guidance.title}</p>
              <p className="mt-1 text-[10px] font-bold opacity-80">{guidance.detail}</p>
            </div>
          );
        })()}
        <pre className="vo-subpanel text-[11px] font-mono p-4 rounded-xl border max-h-96 overflow-auto whitespace-pre-wrap">
          {upgradePreview.output.trim() || "No output. The resolver returned nothing — package may already be at latest."}
        </pre>
      </PackageInsightModal>
    )}

    {whyReport && (
      <PackageInsightModal
        title={`Why is ${whyReport.name} installed?`}
        subtitle={
          whyReport.parents.length === 0
            ? "Nothing else depends on it — this is a root install."
            : `Brought in by ${whyReport.parents.length} package${whyReport.parents.length === 1 ? "" : "s"}.`
        }
        Icon={Info}
        onClose={onCloseWhy}
      >
        <div className="mb-3 rounded-2xl border border-blue-100 dark:border-blue-900/30 bg-blue-50 dark:bg-blue-950/10 p-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300">
            Removal guidance
          </p>
          <p className="mt-1 text-xs font-bold text-slate-600 dark:text-slate-300">
            {whyReport.parents.length === 0
              ? "This looks like a root package. Uninstalling it is lower risk than removing a transitive dependency."
              : "This is a transitive dependency. Remove or upgrade the parent package instead of deleting it directly."}
          </p>
        </div>
        {whyReport.parents.length === 0 ? (
          <p className="text-xs text-slate-500 italic">
            You can uninstall this package without breaking other installed code.
          </p>
        ) : (
          <ul className="space-y-1">
            {whyReport.parents.map(p => (
              <li key={p} className="vo-subpanel px-3 py-2 border rounded-lg text-xs font-mono">
                {p}
              </li>
            ))}
          </ul>
        )}
      </PackageInsightModal>
    )}

    {hygieneReport && (
      <PackageInsightModal
        title="Package hygiene"
        subtitle={`${hygieneReport.root_packages.length} root package${hygieneReport.root_packages.length === 1 ? "" : "s"} among ${hygieneReport.total_packages} installed packages.`}
        Icon={Sparkles}
        onClose={onCloseHygiene}
      >
        <div className="mb-3 rounded-2xl border border-amber-100 dark:border-amber-900/30 bg-amber-50 dark:bg-amber-950/10 p-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-300">
            Hygiene guidance
          </p>
          <p className="mt-1 text-xs font-bold text-slate-600 dark:text-slate-300">
            Review root packages first. They are not required by another installed distribution and are safer uninstall candidates than transitive dependencies.
          </p>
          <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
            {hygieneReport.dependency_packages.length} transitive package{hygieneReport.dependency_packages.length === 1 ? "" : "s"} should usually be left alone unless their root package is removed.
          </p>
        </div>
        <ul className="space-y-1 max-h-80 overflow-y-auto">
          {hygieneReport.root_packages.map(p => (
            <li key={p} className="vo-subpanel flex items-center justify-between px-3 py-2 border rounded-lg text-xs font-mono">
              <span>{p}</span>
              <button
                onClick={() => onUninstallRootPackage(p)}
                className="text-[10px] font-black uppercase text-red-500 hover:underline"
              >
                Uninstall
              </button>
            </li>
          ))}
        </ul>
      </PackageInsightModal>
    )}
  </>
);
