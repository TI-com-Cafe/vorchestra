import { useCallback, useState, useEffect, type SetStateAction } from "react";

import { VenvInfo, VenvDetails, Script, ThemeMode, StatusFilter, StudioTabId, Template } from "./types";
import { PYTHON_TEMPLATES } from "./constants/templates";
import {
  useAppActions,
  useAppInitialization,
  useGlobalSearchShortcut,
  useStudioLoader,
  useThemeAndZoom,
  useSaveTemplate,
  useVenvCreation,
  useVenvDeletion,
  useWorkspaceCrudActions,
  useWorkspaceOperations
} from "./hooks/useAppController";
import { useToastMessages } from "./hooks/useToastMessages";
import { AppShell } from "./components/AppShell";

export default function App() {
  const [workspaces, setWorkspaces] = useState<{ path: string, is_default: boolean }[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState("");
  const [venvCache, setVenvCache] = useState<Record<string, VenvInfo[]>>({});
  const [loading, setLoading] = useState(false);
  const [buildJobId, setBuildJobId] = useState<string | null>(null);
  const [syncingVenv, setSyncingVenv] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeMode>("system");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [zoomLevel, setZoomLevel] = useState(100);
  const [isInitialLoading, setIsInitialLoading] = useState(true);

  const [selectedVenv, setSelectedVenv] = useState<VenvInfo | null>(null);
  const [venvDetails, setVenvDetails] = useState<VenvDetails | null>(null);
  const [studioTab, setStudioTab] = useState<StudioTabId | "deploy">("packages");
  const [pyvenvCfg, setPyvenvCfg] = useState("");
  const [scripts, setScripts] = useState<Script[]>([]);
  const [envContent, setEnvContent] = useState("");
  const [newVenvName, setNewVenvName] = useState("");
  const [customTemplates, setCustomTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<Template>(PYTHON_TEMPLATES[0]);
  const [systemPythons, setSystemPythons] = useState<string[]>([]);
  const [selectedPython, setSelectedPython] = useState("");
  const [availableManagers, setAvailableManagers] = useState({ uv: false, poetry: false, pdm: false, conda: false, pixi: false });
  const [selectedEngine, setSelectedEngine] = useState<"pip" | "uv">("pip");
  const [isHygieneOpen, setIsHygieneOpen] = useState(false);
  const [isCacheOpen, setIsCacheOpen] = useState(false);
  const [isImportBundleOpen, setIsImportBundleOpen] = useState(false);
  const [wizardDismissed, setWizardDismissed] = useState(() => {
    try {
      return localStorage.getItem("vorchestra:first-run-dismissed") === "true";
    } catch {
      return false;
    }
  });
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isUvInstallOpen, setIsUvInstallOpen] = useState(false);
  const [installingUv, setInstallingUv] = useState(false);
  const [uvInstallCmd, setUvInstallCmd] = useState("");
  const [isPythonInstallOpen, setIsPythonInstallOpen] = useState(false);
  const [isProjectDetectOpen, setIsProjectDetectOpen] = useState(false);
  const [cloneSource, setCloneSource] = useState<VenvInfo | null>(null);
  const [compareSource, setCompareSource] = useState<VenvInfo | null>(null);
  const [isSaveTemplateOpen, setIsSaveTemplateOpen] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);

  const { statusText, toasts, pushMessage: setMessage, mountedRef } = useToastMessages();
  const setWizardDismissedPersisted = useCallback((value: SetStateAction<boolean>) => {
    setWizardDismissed((prev) => {
      const next = typeof value === "function" ? value(prev) : value;
      try {
        localStorage.setItem("vorchestra:first-run-dismissed", next ? "true" : "false");
      } catch {
        // localStorage can be unavailable in restricted webviews; state still updates.
      }
      return next;
    });
  }, []);

  useGlobalSearchShortcut(setIsSearchOpen);
  useThemeAndZoom(theme, zoomLevel);
  useAppInitialization({
    setWorkspaces,
    setActiveWorkspace,
    setVenvCache,
    setSystemPythons,
    setSelectedPython,
    setCustomTemplates,
    setAvailableManagers,
    setSelectedEngine,
    setIsInitialLoading
  });
  const { scanWorkspace, syncSingleVenv, checkSyncStatus, cancelWorkspaceScan } = useWorkspaceOperations({
    setLoading,
    setSyncingVenv,
    setMessage,
    setVenvCache
  });
  const { addWorkspace, removeWorkspace, setDefaultWorkspace } = useWorkspaceCrudActions({
    workspaces,
    setWorkspaces,
    setActiveWorkspace,
    setVenvCache,
    setMessage,
    scanWorkspace,
    cancelWorkspaceScan
  });
  const handleCreateVenv = useVenvCreation({
    activeWorkspace,
    newVenvName,
    selectedPython,
    selectedEngine,
    selectedTemplate,
    setLoading,
    setBuildJobId,
    setNewVenvName,
    setMessage,
    setVenvCache,
    scanWorkspace
  });
  const handleDeleteVenv = useVenvDeletion({
    activeWorkspace,
    cancelWorkspaceScan,
    setMessage,
    setVenvCache
  });
  const handleSaveTemplate = useSaveTemplate({
    selectedVenv,
    venvDetails,
    setVenvDetails,
    setCustomTemplates,
    setMessage
  });
  const openStudio = useStudioLoader({
    mountedRef,
    setSelectedVenv,
    setStudioTab,
    setVenvDetails,
    setScripts,
    setEnvContent,
    setPyvenvCfg
  });
  const {
    onCancelProjectBuild,
    onProjectBuild,
    requestUvInstall,
    onPythonInstalled,
    onUvInstall,
    onUvInstallElevated,
    onFirstRunPickWorkspace,
    onHygieneRefresh
  } = useAppActions({
    workspaces,
    setWorkspaces,
    setActiveWorkspace,
    setVenvCache,
    setSystemPythons,
    setSelectedPython,
    setAvailableManagers,
    setSelectedEngine,
    setWizardDismissed: setWizardDismissedPersisted,
    setIsUvInstallOpen,
    setInstallingUv,
    setUvInstallCmd,
    setMessage,
    scanWorkspace
  });

  useEffect(() => {
    // Intentionally narrow deps: re-running on every venvCache change would
    // cause an infinite loop (checkSyncStatus mutates the cache). We sweep
    // once per workspace switch / boot.
    let cancelled = false;
    const runSync = async () => {
      if (!isInitialLoading && activeWorkspace && venvCache[activeWorkspace]) {
        for (const v of venvCache[activeWorkspace]) {
          if (cancelled) break;
          await checkSyncStatus(v.path);
          await new Promise(r => setTimeout(r, 100));
        }
      }
    };
    runSync();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspace, isInitialLoading]);

  const filteredVenvs = (venvCache[activeWorkspace] || []).filter(v =>
    v.name.toLowerCase().includes(searchQuery.toLowerCase()) && (statusFilter === "All" || v.status === statusFilter)
  );

  const stats = {
    total: (venvCache[activeWorkspace] || []).length,
    healthy: (venvCache[activeWorkspace] || []).filter(v => v.status === "Healthy").length,
    broken: (venvCache[activeWorkspace] || []).filter(v => v.status === "Broken").length
  };

  return (
    <AppShell
      workspaces={workspaces}
      activeWorkspace={activeWorkspace}
      setActiveWorkspace={setActiveWorkspace}
      venvCache={venvCache}
      loading={loading}
      buildJobId={buildJobId}
      syncingVenv={syncingVenv}
      theme={theme}
      setTheme={setTheme}
      searchQuery={searchQuery}
      setSearchQuery={setSearchQuery}
      statusFilter={statusFilter}
      setStatusFilter={setStatusFilter}
      zoomLevel={zoomLevel}
      setZoomLevel={setZoomLevel}
      isInitialLoading={isInitialLoading}
      selectedVenv={selectedVenv}
      setSelectedVenv={setSelectedVenv}
      venvDetails={venvDetails}
      studioTab={studioTab}
      setStudioTab={setStudioTab}
      scripts={scripts}
      envContent={envContent}
      setEnvContent={setEnvContent}
      pyvenvCfg={pyvenvCfg}
      newVenvName={newVenvName}
      setNewVenvName={setNewVenvName}
      customTemplates={customTemplates}
      selectedTemplate={selectedTemplate}
      setSelectedTemplate={setSelectedTemplate}
      systemPythons={systemPythons}
      selectedPython={selectedPython}
      setSelectedPython={setSelectedPython}
      availableManagers={availableManagers}
      selectedEngine={selectedEngine}
      setSelectedEngine={setSelectedEngine}
      isHygieneOpen={isHygieneOpen}
      setIsHygieneOpen={setIsHygieneOpen}
      isCacheOpen={isCacheOpen}
      setIsCacheOpen={setIsCacheOpen}
      isImportBundleOpen={isImportBundleOpen}
      setIsImportBundleOpen={setIsImportBundleOpen}
      wizardDismissed={wizardDismissed}
      setWizardDismissed={setWizardDismissedPersisted}
      isSearchOpen={isSearchOpen}
      setIsSearchOpen={setIsSearchOpen}
      isUvInstallOpen={isUvInstallOpen}
      setIsUvInstallOpen={setIsUvInstallOpen}
      installingUv={installingUv}
      uvInstallCmd={uvInstallCmd}
      setUvInstallCmd={setUvInstallCmd}
      isPythonInstallOpen={isPythonInstallOpen}
      setIsPythonInstallOpen={setIsPythonInstallOpen}
      isProjectDetectOpen={isProjectDetectOpen}
      setIsProjectDetectOpen={setIsProjectDetectOpen}
      cloneSource={cloneSource}
      setCloneSource={setCloneSource}
      compareSource={compareSource}
      setCompareSource={setCompareSource}
      isSaveTemplateOpen={isSaveTemplateOpen}
      setIsSaveTemplateOpen={setIsSaveTemplateOpen}
      savingTemplate={savingTemplate}
      setSavingTemplate={setSavingTemplate}
      statusText={statusText}
      toasts={toasts}
      filteredVenvs={filteredVenvs}
      stats={stats}
      setMessage={setMessage}
      scanWorkspace={scanWorkspace}
      syncSingleVenv={syncSingleVenv}
      addWorkspace={addWorkspace}
      removeWorkspace={removeWorkspace}
      setDefaultWorkspace={setDefaultWorkspace}
      handleCreateVenv={handleCreateVenv}
      handleDeleteVenv={handleDeleteVenv}
      handleSaveTemplate={handleSaveTemplate}
      openStudio={openStudio}
      onProjectBuild={onProjectBuild}
      onCancelProjectBuild={onCancelProjectBuild}
      onRequestUvInstall={requestUvInstall}
      onPythonInstalled={onPythonInstalled}
      onUvInstall={onUvInstall}
      onUvInstallElevated={onUvInstallElevated}
      onImportBundleImported={async (ws) => {
        await scanWorkspace(ws);
        setMessage("Bundle imported successfully.");
      }}
      onFirstRunPickWorkspace={onFirstRunPickWorkspace}
      onHygieneRefresh={onHygieneRefresh}
    />
  );
}
