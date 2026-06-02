import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { invoke } from "@tauri-apps/api/core";

import { VenvInfo, VenvDetails, ProjectDetection, PackageHygieneReport } from "../../types";
import { packageService } from "../../services/packageManager";
import { waitForBackgroundJob } from "../../services/backgroundJobs";
import { PackageViewMode } from "../../components/Studio/PackageManifestToolbar";
import { isReadOnlyManager, readOnlyManagerLabel } from "../../utils/venvManagers";

interface UseStudioPackagesControllerParams {
  venv: VenvInfo;
  initialDetails: VenvDetails | null;
  refresh: () => void;
  setMessage: (msg: string) => void;
  onDetailsChange?: (details: VenvDetails) => void;
}

export function useStudioPackagesController({
  venv,
  initialDetails,
  refresh,
  setMessage,
  onDetailsChange
}: UseStudioPackagesControllerParams) {
  const [localDetails, setLocalDetails] = useState<VenvDetails | null>(initialDetails);
  const [packageSizes, setPackageSizes] = useState<Record<string, number>>({});
  const [packageSizesKey, setPackageSizesKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(!initialDetails);
  const [loadingEnvSize, setLoadingEnvSize] = useState(false);
  const [loadingSizes, setLoadingSizes] = useState(false);
  const [viewMode, setViewMode] = useState<PackageViewMode>("list");
  const [isExplorerOpen, setIsExplorerOpen] = useState(false);
  const [upgradePreview, setUpgradePreview] = useState<{ name: string; output: string } | null>(null);
  const [whyReport, setWhyReport] = useState<{ name: string; parents: string[] } | null>(null);
  const [syncingProject, setSyncingProject] = useState(false);
  const [hygieneReport, setHygieneReport] = useState<PackageHygieneReport | null>(null);
  const [analyzingHygiene, setAnalyzingHygiene] = useState(false);
  const [packageAction, setPackageAction] = useState<{ jobId: string; label: string; logs?: string[] } | null>(null);
  const [insightAction, setInsightAction] = useState<{ jobId: string; label: string } | null>(null);
  const [pendingUninstall, setPendingUninstall] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const packageJobRef = useRef<string | null>(null);
  const envSizeJobRef = useRef<string | null>(null);
  const packageSizesJobRef = useRef<string | null>(null);
  const projectSyncJobRef = useRef<string | null>(null);
  const hygieneJobRef = useRef<string | null>(null);
  const exportJobRef = useRef<string | null>(null);
  const insightJobRef = useRef<string | null>(null);
  const projectSyncCancelledRef = useRef(false);
  const initialDetailsRef = useRef<VenvDetails | null>(initialDetails);
  const readOnlyManager = isReadOnlyManager(venv.manager_type);
  const readOnlyLabel = readOnlyManagerLabel(venv.manager_type);

  const cancelJob = useCallback(async (jobRef: MutableRefObject<string | null>) => {
    const jobId = jobRef.current;
    if (!jobId) return;
    jobRef.current = null;
    try {
      await invoke<boolean>("cancel_background_job", { jobId });
    } catch (err) {
      console.warn("Failed to cancel background job:", err);
    }
  }, []);

  const cancelCataloging = useCallback(async () => {
    await Promise.all([
      cancelJob(packageJobRef),
      cancelJob(envSizeJobRef),
      cancelJob(packageSizesJobRef)
    ]);
    if (mountedRef.current) {
      setLoading(false);
      setLoadingEnvSize(false);
      setLoadingSizes(false);
      setMessage("Package cataloging cancelled.");
    }
  }, [cancelJob, setMessage]);

  const updatePackageActionFromSnapshot = useCallback((snapshot: { message?: string | null; logs?: string[] }) => {
    const logs = snapshot.logs ?? [];
    setPackageAction((prev) => prev ? { ...prev, logs } : prev);
    const lastLog = logs[logs.length - 1];
    if (lastLog) setMessage(lastLog);
    else if (snapshot.message) setMessage(snapshot.message);
  }, [setMessage]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    initialDetailsRef.current = initialDetails;
  }, [initialDetails]);

  useEffect(() => {
    setLocalDetails(initialDetails);
    setPackageSizes({});
    setPackageSizesKey(null);
    // Details loaded by this controller are fed back to the Studio header.
    // Do not restart cataloging when that parent copy changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venv.path]);

  useEffect(() => {
    if (localDetails) onDetailsChange?.(localDetails);
  }, [localDetails, onDetailsChange]);

  useEffect(() => {
    let cancelled = false;

    const fetchPackages = async () => {
      setLoading(true);
      try {
        const jobId = await invoke<string>("start_get_venv_packages_job", { path: venv.path });
        packageJobRef.current = jobId;
        const packages = await waitForBackgroundJob<string[]>(jobId);
        if (mountedRef.current && !cancelled) {
          setLocalDetails((prev) => ({
            size_mb: prev?.size_mb ?? initialDetailsRef.current?.size_mb ?? 0,
            packages
          }));
        }
      } catch (err) {
        if (!String(err).toLowerCase().includes("cancel")) {
          console.error("Error fetching venv packages:", err);
        }
      } finally {
        packageJobRef.current = null;
        if (mountedRef.current && !cancelled) setLoading(false);
      }
    };
    fetchPackages();

    return () => {
      cancelled = true;
      void cancelJob(packageJobRef);
    };
  }, [venv.path, cancelJob]);

  useEffect(() => {
    let cancelled = false;
    const fetchEnvSize = async () => {
      setLoadingEnvSize(true);
      try {
        const jobId = await invoke<string>("start_get_venv_size_job", { path: venv.path });
        envSizeJobRef.current = jobId;
        const sizeMb = await waitForBackgroundJob<number>(jobId);
        if (mountedRef.current && !cancelled) {
          setLocalDetails((prev) => ({
            size_mb: sizeMb,
            packages: prev?.packages ?? initialDetailsRef.current?.packages ?? []
          }));
        }
      } catch (err) {
        if (!String(err).toLowerCase().includes("cancel")) {
          console.error("Error fetching venv size:", err);
        }
      } finally {
        envSizeJobRef.current = null;
        if (mountedRef.current && !cancelled) setLoadingEnvSize(false);
      }
    };
    fetchEnvSize();

    return () => {
      cancelled = true;
      void cancelJob(envSizeJobRef);
    };
  }, [venv.path, cancelJob]);

  useEffect(() => {
    if (!localDetails || viewMode !== "list") return;
    const currentKey = `${venv.path}:${localDetails.packages.length}`;
    if (packageSizesKey === currentKey) return;
    let cancelled = false;
    const fetchSizes = async () => {
      setLoadingSizes(true);
      try {
        const jobId = await invoke<string>("start_get_package_sizes_job", { venvPath: venv.path });
        packageSizesJobRef.current = jobId;
        const sizes = await waitForBackgroundJob<Record<string, number>>(jobId);
        if (mountedRef.current && !cancelled) {
          setPackageSizes(sizes);
          setPackageSizesKey(currentKey);
        }
      } catch (err) {
        if (!String(err).toLowerCase().includes("cancel")) {
          console.error("Error fetching package sizes:", err);
        }
      } finally {
        packageSizesJobRef.current = null;
        if (mountedRef.current && !cancelled) setLoadingSizes(false);
      }
    };
    fetchSizes();
    return () => {
      cancelled = true;
      void cancelJob(packageSizesJobRef);
    };
  }, [venv.path, localDetails, viewMode, packageSizesKey, cancelJob]);

  const uninstallPkg = async (pkgName: string) => {
    if (readOnlyManager) {
      setMessage(`${readOnlyLabel} environments are read-only in VOrchestra. Use the native manager to uninstall packages.`);
      return;
    }
    try {
      setPendingUninstall(null);
      await packageService.uninstall(venv, pkgName, {
        onJobStarted: (jobId) => setPackageAction({ jobId, label: `Uninstalling ${pkgName}` }),
        onUpdate: updatePackageActionFromSnapshot
      });
      setMessage(`Uninstalled ${pkgName}`);
      refresh();
    } catch (err) {
      setMessage(`Error: ${err}`);
    } finally {
      setPackageAction(null);
    }
  };

  const updatePkg = async (pkgName: string) => {
    if (readOnlyManager) {
      setMessage(`${readOnlyLabel} environments are read-only in VOrchestra. Use the native manager to update packages.`);
      return;
    }
    try {
      await packageService.update(venv, pkgName, {
        onJobStarted: (jobId) => setPackageAction({ jobId, label: `Updating ${pkgName}` }),
        onUpdate: updatePackageActionFromSnapshot
      });
      setMessage(`Updated ${pkgName}`);
      refresh();
    } catch (err) {
      setMessage(`Error: ${err}`);
    } finally {
      setPackageAction(null);
    }
  };

  const cancelPackageAction = async () => {
    if (!packageAction) return;
    try {
      await packageService.cancelJob(packageAction.jobId);
      setMessage(`${packageAction.label} cancelled.`);
    } catch (err) {
      setMessage(`Cancel failed: ${err}`);
    } finally {
      setPackageAction(null);
    }
  };

  const exportRequirements = async () => {
    try {
      const jobId = await invoke<string>("start_export_requirements_job", { venvPath: venv.path });
      exportJobRef.current = jobId;
      setPackageAction({ jobId, label: "Exporting requirements.txt" });
      const out = await waitForBackgroundJob<string>(jobId);
      setMessage(out);
    } catch (err) {
      setMessage(`Error: ${err}`);
    } finally {
      exportJobRef.current = null;
      setPackageAction(null);
    }
  };

  const previewUpgrade = async (pkgName: string) => {
    if (readOnlyManager) {
      setMessage(`${readOnlyLabel} environments are read-only in VOrchestra. Upgrade previews are limited to pip/uv environments.`);
      return;
    }
    try {
      const jobId = await invoke<string>("start_preview_upgrade_job", {
        venvPath: venv.path, package: pkgName, engine: venv.manager_type
      });
      insightJobRef.current = jobId;
      setInsightAction({ jobId, label: `Previewing upgrade for ${pkgName}` });
      const out = await waitForBackgroundJob<string>(jobId);
      setUpgradePreview({ name: pkgName, output: out });
    } catch (err) {
      setMessage(`Error: ${err}`);
    } finally {
      insightJobRef.current = null;
      setInsightAction(null);
    }
  };

  const inspectWhyInstalled = async (pkgName: string) => {
    try {
      const jobId = await invoke<string>("start_why_is_installed_job", {
        venvPath: venv.path, package: pkgName
      });
      insightJobRef.current = jobId;
      setInsightAction({ jobId, label: `Inspecting ${pkgName}` });
      const parents = await waitForBackgroundJob<string[]>(jobId);
      setWhyReport({ name: pkgName, parents });
    } catch (err) {
      setMessage(`Error: ${err}`);
    } finally {
      insightJobRef.current = null;
      setInsightAction(null);
    }
  };

  const cancelInsightAction = async () => {
    if (!insightAction) return;
    try {
      await packageService.cancelJob(insightAction.jobId);
      setMessage(`${insightAction.label} cancelled.`);
    } catch (err) {
      setMessage(`Cancel failed: ${err}`);
    } finally {
      insightJobRef.current = null;
      setInsightAction(null);
    }
  };

  const projectRoot = () => {
    const normalized = venv.path.replace(/[/\\]+$/, "");
    const parts = normalized.split(/[/\\]/);
    parts.pop();
    return parts.join(venv.path.includes("\\") ? "\\" : "/");
  };

  const syncProjectDeps = async () => {
    if (readOnlyManager) {
      setMessage(`${readOnlyLabel} environments are read-only in VOrchestra. Use the native manager to sync project dependencies.`);
      return;
    }
    const root = projectRoot();
    if (!root) return;
    setSyncingProject(true);
    projectSyncCancelledRef.current = false;
    try {
      setMessage("Detecting project manifests...");
      const scanJobId = await invoke<string>("start_detect_project_manifests_job", { path: root });
      projectSyncJobRef.current = scanJobId;
      const detection = await waitForBackgroundJob<ProjectDetection>(scanJobId);
      projectSyncJobRef.current = null;
      if (detection.merged_packages.length === 0) {
        setMessage("No project dependencies found to sync.");
        return;
      }
      for (const [idx, pkg] of detection.merged_packages.entries()) {
        if (projectSyncCancelledRef.current) break;
        setMessage(`Installing project dependency ${idx + 1}/${detection.merged_packages.length}: ${pkg}`);
        await packageService.install(venv, pkg, undefined, {
          onJobStarted: (jobId) => { projectSyncJobRef.current = jobId; }
        });
        projectSyncJobRef.current = null;
      }
      if (projectSyncCancelledRef.current) {
        setMessage("Project sync cancelled.");
        return;
      }
      setMessage(`Synced ${detection.merged_packages.length} project dependencies.`);
      refresh();
    } catch (err) {
      setMessage(`Project sync failed: ${err}`);
    } finally {
      projectSyncJobRef.current = null;
      setSyncingProject(false);
    }
  };

  const cancelProjectSync = async () => {
    projectSyncCancelledRef.current = true;
    await cancelJob(projectSyncJobRef);
    setSyncingProject(false);
    setMessage("Project sync cancelled.");
  };

  const analyzeHygiene = async () => {
    setAnalyzingHygiene(true);
    try {
      const jobId = await invoke<string>("start_analyze_package_hygiene_job", { venvPath: venv.path });
      hygieneJobRef.current = jobId;
      const report = await waitForBackgroundJob<PackageHygieneReport>(jobId);
      setHygieneReport(report);
    } catch (err) {
      setMessage(`Package hygiene failed: ${err}`);
    } finally {
      hygieneJobRef.current = null;
      setAnalyzingHygiene(false);
    }
  };

  const cancelHygiene = async () => {
    await cancelJob(hygieneJobRef);
    setAnalyzingHygiene(false);
    setMessage("Package hygiene analysis cancelled.");
  };

  return {
    localDetails,
    packageSizes,
    loading,
    loadingEnvSize,
    loadingSizes,
    viewMode,
    setViewMode,
    isExplorerOpen,
    setIsExplorerOpen,
    upgradePreview,
    setUpgradePreview,
    whyReport,
    setWhyReport,
    syncingProject,
    hygieneReport,
    setHygieneReport,
    analyzingHygiene,
    packageAction,
    insightAction,
    pendingUninstall,
    setPendingUninstall,
    cancelCataloging,
    uninstallPkg,
    updatePkg,
    cancelPackageAction,
    exportRequirements,
    previewUpgrade,
    inspectWhyInstalled,
    cancelInsightAction,
    syncProjectDeps,
    cancelProjectSync,
    analyzeHygiene,
    cancelHygiene
  };
}
