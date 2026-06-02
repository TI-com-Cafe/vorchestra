import React, { Suspense, lazy } from "react";
import { VenvInfo, VenvDetails } from "../../types";
import { StudioDependencyTree } from "./StudioDependencyTree";
import { PyPIExplorer } from "./PyPIExplorer";
import { StudioPanelLoading } from "./StudioPanelLoading";
import { JobActionBanner } from "./JobActionBanner";
import { PackageCatalogLoading } from "./PackageCatalogLoading";
import { PackageStatsCards } from "./PackageStatsCards";
import { PackageManifestToolbar } from "./PackageManifestToolbar";
import { PackageList } from "./PackageList";
import { PackageInsightOverlays } from "./PackageInsightOverlays";
import { useStudioPackagesController } from "../../hooks/studio/useStudioPackagesController";
import { isReadOnlyManager, readOnlyManagerLabel } from "../../utils/venvManagers";

const StudioDependencyGraph = lazy(() =>
  import("./StudioDependencyGraph").then((mod) => ({ default: mod.StudioDependencyGraph }))
);

interface StudioPackagesProps {
  venv: VenvInfo;
  details: VenvDetails | null;
  refresh: () => void;
  setMessage: (msg: string) => void;
  onDetailsChange?: (details: VenvDetails) => void;
}

export const StudioPackages: React.FC<StudioPackagesProps> = ({ venv, details: initialDetails, refresh, setMessage, onDetailsChange }) => {
  const controller = useStudioPackagesController({ venv, initialDetails, refresh, setMessage, onDetailsChange });
  const readOnly = isReadOnlyManager(venv.manager_type);
  const readOnlyLabel = readOnlyManagerLabel(venv.manager_type);

  if (controller.loading) {
    return <PackageCatalogLoading onCancel={controller.cancelCataloging} />;
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-300 text-slate-900 dark:text-slate-100">
      <PackageStatsCards
        sizeMb={controller.localDetails?.size_mb ?? 0}
        packageCount={controller.localDetails?.packages?.length ?? 0}
        loadingEnvSize={controller.loadingEnvSize}
        onAddPackage={() => controller.setIsExplorerOpen(true)}
        readOnly={readOnly}
        readOnlyLabel={readOnlyLabel}
      />

      <div className="space-y-4 relative">
        {controller.isExplorerOpen && (
          <div className="absolute inset-0 z-20">
            <PyPIExplorer
              venv={venv}
              onClose={() => controller.setIsExplorerOpen(false)}
              onInstalled={() => { controller.setIsExplorerOpen(false); refresh(); }}
              setMessage={setMessage}
            />
          </div>
        )}

        {controller.packageAction && (
          <JobActionBanner
            label={controller.packageAction.label}
            logs={controller.packageAction.logs}
            onCancel={controller.cancelPackageAction}
          />
        )}

        {controller.insightAction && (
          <JobActionBanner label={controller.insightAction.label} tone="amber" onCancel={controller.cancelInsightAction} />
        )}

        <PackageManifestToolbar
          viewMode={controller.viewMode}
          setViewMode={controller.setViewMode}
          loadingSizes={controller.loadingSizes}
          loadingEnvSize={controller.loadingEnvSize}
          packageActionActive={!!controller.packageAction}
          syncingProject={controller.syncingProject}
          analyzingHygiene={controller.analyzingHygiene}
          readOnly={readOnly}
          readOnlyLabel={readOnlyLabel}
          onStopScans={controller.cancelCataloging}
          onExport={controller.exportRequirements}
          onSyncProject={controller.syncingProject ? controller.cancelProjectSync : controller.syncProjectDeps}
          onHygiene={controller.analyzingHygiene ? controller.cancelHygiene : controller.analyzeHygiene}
        />

        {controller.viewMode === "list" && (
          <PackageList
            packages={controller.localDetails?.packages ?? []}
            packageSizes={controller.packageSizes}
            packageActionActive={!!controller.packageAction}
            insightActionActive={!!controller.insightAction}
            readOnly={readOnly}
            onPreviewUpgrade={controller.previewUpgrade}
            onWhyInstalled={controller.inspectWhyInstalled}
            onUpdate={controller.updatePkg}
            onUninstall={controller.setPendingUninstall}
          />
        )}

        {controller.viewMode === "tree" && <StudioDependencyTree venv={venv} />}
        {controller.viewMode === "graph" && (
          <Suspense fallback={<StudioPanelLoading label="Loading graph renderer..." />}>
            <StudioDependencyGraph venv={venv} />
          </Suspense>
        )}
      </div>

      <PackageInsightOverlays
        upgradePreview={controller.upgradePreview}
        whyReport={controller.whyReport}
        hygieneReport={controller.hygieneReport}
        onCloseUpgrade={() => controller.setUpgradePreview(null)}
        onCloseWhy={() => controller.setWhyReport(null)}
        onCloseHygiene={() => controller.setHygieneReport(null)}
        onUninstallRootPackage={controller.uninstallPkg}
      />

      {controller.pendingUninstall && (
        <div className="fixed inset-0 z-[90] bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="vo-surface w-full max-w-md rounded-[2rem] border border-red-100 dark:border-red-900/40 shadow-2xl overflow-hidden">
            <div className="p-6 bg-red-50 dark:bg-red-950/20 border-b border-red-100 dark:border-red-900/40">
              <h3 className="text-sm font-black uppercase tracking-widest text-red-700 dark:text-red-300">
                Uninstall package?
              </h3>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                This removes <span className="font-mono font-black text-slate-800 dark:text-slate-100">{controller.pendingUninstall}</span> from this environment. Dependencies installed only for this package may remain.
              </p>
            </div>
            <div className="p-5 flex justify-end gap-2">
              <button
                onClick={() => controller.setPendingUninstall(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-200 text-[10px] font-black uppercase tracking-wider"
              >
                Cancel
              </button>
              <button
                onClick={() => controller.uninstallPkg(controller.pendingUninstall!)}
                disabled={!!controller.packageAction}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-slate-400 text-white text-[10px] font-black uppercase tracking-wider"
              >
                Uninstall
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
