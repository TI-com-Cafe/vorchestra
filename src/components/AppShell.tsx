import { Dispatch, SetStateAction, useState } from "react";
import { FolderPlus, RefreshCcw, SearchX } from "lucide-react";

import { VenvInfo, VenvDetails, Script, ThemeMode, StatusFilter, StudioTabId, Template, ToastMessage } from "../types";
import { STATUS_FILTERS } from "../constants/ui";
import { cn } from "../utils/cn";
import { Sidebar } from "./Sidebar";
import { VenvCard } from "./VenvCard";
import { NewEnvironmentBar } from "./NewEnvironmentBar";
import { StudioModal } from "./StudioModal";
import { AppOverlays } from "./AppOverlays";
import { assessEnvironmentHealth } from "../utils/envHealth";
import { ProjectBoard } from "./ProjectBoard";

type Workspace = { path: string; is_default: boolean };
type ManagerStatus = { uv: boolean; poetry: boolean; pdm: boolean; conda: boolean; pixi: boolean };
type Engine = "pip" | "uv";

interface AppShellProps {
  workspaces: Workspace[];
  activeWorkspace: string;
  setActiveWorkspace: (path: string) => void;
  venvCache: Record<string, VenvInfo[]>;
  loading: boolean;
  buildJobId: string | null;
  syncingVenv: string | null;
  theme: ThemeMode;
  setTheme: Dispatch<SetStateAction<ThemeMode>>;
  searchQuery: string;
  setSearchQuery: Dispatch<SetStateAction<string>>;
  statusFilter: StatusFilter;
  setStatusFilter: Dispatch<SetStateAction<StatusFilter>>;
  zoomLevel: number;
  setZoomLevel: Dispatch<SetStateAction<number>>;
  isInitialLoading: boolean;
  selectedVenv: VenvInfo | null;
  setSelectedVenv: Dispatch<SetStateAction<VenvInfo | null>>;
  venvDetails: VenvDetails | null;
  studioTab: StudioTabId | "deploy";
  setStudioTab: Dispatch<SetStateAction<StudioTabId | "deploy">>;
  scripts: Script[];
  envContent: string;
  setEnvContent: Dispatch<SetStateAction<string>>;
  pyvenvCfg: string;
  newVenvName: string;
  setNewVenvName: Dispatch<SetStateAction<string>>;
  customTemplates: Template[];
  selectedTemplate: Template;
  setSelectedTemplate: Dispatch<SetStateAction<Template>>;
  systemPythons: string[];
  selectedPython: string;
  setSelectedPython: Dispatch<SetStateAction<string>>;
  availableManagers: ManagerStatus;
  selectedEngine: Engine;
  setSelectedEngine: Dispatch<SetStateAction<Engine>>;
  isHygieneOpen: boolean;
  setIsHygieneOpen: Dispatch<SetStateAction<boolean>>;
  isCacheOpen: boolean;
  setIsCacheOpen: Dispatch<SetStateAction<boolean>>;
  isImportBundleOpen: boolean;
  setIsImportBundleOpen: Dispatch<SetStateAction<boolean>>;
  wizardDismissed: boolean;
  setWizardDismissed: Dispatch<SetStateAction<boolean>>;
  isSearchOpen: boolean;
  setIsSearchOpen: Dispatch<SetStateAction<boolean>>;
  isUvInstallOpen: boolean;
  setIsUvInstallOpen: Dispatch<SetStateAction<boolean>>;
  installingUv: boolean;
  uvInstallCmd: string;
  setUvInstallCmd: Dispatch<SetStateAction<string>>;
  isPythonInstallOpen: boolean;
  setIsPythonInstallOpen: Dispatch<SetStateAction<boolean>>;
  isProjectDetectOpen: boolean;
  setIsProjectDetectOpen: Dispatch<SetStateAction<boolean>>;
  cloneSource: VenvInfo | null;
  setCloneSource: Dispatch<SetStateAction<VenvInfo | null>>;
  compareSource: VenvInfo | null;
  setCompareSource: Dispatch<SetStateAction<VenvInfo | null>>;
  isSaveTemplateOpen: boolean;
  setIsSaveTemplateOpen: Dispatch<SetStateAction<boolean>>;
  savingTemplate: boolean;
  setSavingTemplate: Dispatch<SetStateAction<boolean>>;
  statusText: string;
  toasts: ToastMessage[];
  filteredVenvs: VenvInfo[];
  stats: { total: number; healthy: number; broken: number };
  setMessage: (message: string) => void;
  scanWorkspace: (path: string) => Promise<void>;
  syncSingleVenv: (path: string) => Promise<void>;
  addWorkspace: () => Promise<void>;
  removeWorkspace: (path: string) => Promise<void>;
  setDefaultWorkspace: (path: string) => Promise<void>;
  handleCreateVenv: () => Promise<void>;
  handleDeleteVenv: (path: string) => Promise<void>;
  handleSaveTemplate: (templateName: string) => Promise<void>;
  openStudio: (venv: VenvInfo, tab?: StudioTabId | "deploy") => Promise<void>;
  onProjectBuild: ProjectDetectBuildHandler;
  onCancelProjectBuild: (jobId: string) => Promise<void>;
  onRequestUvInstall: () => Promise<void>;
  onPythonInstalled: () => Promise<void>;
  onUvInstall: () => Promise<void>;
  onUvInstallElevated: () => Promise<void>;
  onImportBundleImported: (workspace: string) => Promise<void>;
  onFirstRunPickWorkspace: (path: string) => Promise<void>;
  onHygieneRefresh: () => Promise<void>;
}

type ProjectDetectBuildHandler = (args: {
  projectRoot: string;
  pythonBin: string;
  engine: Engine;
  venvName: string;
  packages: string[];
  onProgress?: (message: string) => void;
  onJobStart?: (jobId: string) => void;
}) => Promise<void>;

export const AppShell = (props: AppShellProps) => {
  const [mainView, setMainView] = useState<"environments" | "projects">("environments");

  if (props.isInitialLoading) {
    return <InitialLoadingScreen />;
  }
  const attentionCount = props.filteredVenvs.filter(v => assessEnvironmentHealth(v).tone !== "green").length;

  return (
    <div id="root-container" className="vo-app-bg flex h-screen text-slate-800 dark:text-slate-50 font-sans overflow-hidden transition-colors duration-200 origin-top-left">
      <Sidebar
        theme={props.theme} setTheme={props.setTheme} workspaces={props.workspaces} activeWorkspace={props.activeWorkspace}
        availableManagers={props.availableManagers}
        setActiveWorkspace={props.setActiveWorkspace} scanWorkspace={props.scanWorkspace}
        openHygiene={() => props.setIsHygieneOpen(true)}
        openCache={() => props.setIsCacheOpen(true)}
        openImportBundle={() => props.setIsImportBundleOpen(true)}
        addWorkspace={props.addWorkspace}
        removeWorkspace={props.removeWorkspace}
        setDefaultWorkspace={props.setDefaultWorkspace}
      />

      <main className="flex-1 flex flex-col relative overflow-hidden">
        <header className="vo-surface h-14 border-b flex items-center justify-between px-8 shrink-0 select-none">
          <div className="flex items-center gap-4">
            <input value={props.searchQuery} onChange={(e) => props.setSearchQuery(e.target.value)} className="vo-control border rounded-lg py-1.5 px-4 text-xs w-64 outline-none focus:border-blue-500" placeholder="Search..." />
            <div className="vo-subpanel flex items-center rounded-lg border p-0.5">
              <button onClick={() => props.setZoomLevel(prev => Math.max(70, prev - 5))} className="px-2 py-1 text-[10px] font-black hover:text-blue-600 transition-colors" title="Decrease Font Size">A-</button>
              <div className="w-px h-3 bg-slate-300 dark:bg-slate-700 mx-1"></div>
              <button onClick={() => props.setZoomLevel(prev => Math.min(150, prev + 5))} className="px-2 py-1 text-[10px] font-black hover:text-blue-600 transition-colors" title="Increase Font Size">A+</button>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase">
            <span>{props.stats.total} Total</span> <span className="text-green-600">{props.stats.healthy} OK</span> <span className="text-amber-600">{attentionCount} Attention</span> <span className="text-red-600">{props.stats.broken} Broken</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="vo-subpanel flex p-0.5 rounded-lg border">
              {(["environments", "projects"] as const).map(view => (
                <button
                  key={view}
                  onClick={() => setMainView(view)}
                  className={cn("px-3 py-1 rounded-md text-[10px] font-bold transition-all capitalize", mainView === view ? "bg-white dark:bg-slate-700 text-blue-600 shadow-sm" : "text-slate-500")}
                >
                  {view}
                </button>
              ))}
            </div>
            <div className="vo-subpanel flex p-0.5 rounded-lg border">
              {STATUS_FILTERS.map(s => (<button key={s} onClick={() => props.setStatusFilter(s)} className={cn("px-3 py-1 rounded-md text-[10px] font-bold transition-all", props.statusFilter === s ? "bg-white dark:bg-slate-700 text-blue-600 shadow-sm" : "text-slate-500")}>{s}</button>))}
            </div>
          </div>
        </header>

        <NewEnvironmentBar
          newVenvName={props.newVenvName}
          setNewVenvName={props.setNewVenvName}
          selectedEngine={props.selectedEngine}
          setSelectedEngine={props.setSelectedEngine}
          availableManagers={props.availableManagers}
          selectedPython={props.selectedPython}
          setSelectedPython={props.setSelectedPython}
          systemPythons={props.systemPythons}
          selectedTemplate={props.selectedTemplate}
          setSelectedTemplate={props.setSelectedTemplate}
          customTemplates={props.customTemplates}
          loading={props.loading}
          buildJobId={props.buildJobId}
          statusText={props.statusText}
          onBuild={props.handleCreateVenv}
          onFromProject={() => props.setIsProjectDetectOpen(true)}
          setUvInstallCmd={props.setUvInstallCmd}
          openUvInstall={() => props.setIsUvInstallOpen(true)}
          openPythonInstall={() => props.setIsPythonInstallOpen(true)}
          setMessage={props.setMessage}
        />

        {mainView === "projects" ? (
          <ProjectBoard
            venvs={props.filteredVenvs}
            onOpenStudio={props.openStudio}
            onSync={props.syncSingleVenv}
            setMessage={props.setMessage}
          />
        ) : props.filteredVenvs.length === 0 ? (
          <EmptyEnvironmentState
            hasWorkspaces={props.workspaces.length > 0}
            activeWorkspace={props.activeWorkspace}
            hasCachedEnvironments={(props.venvCache[props.activeWorkspace] ?? []).length > 0}
            onAddWorkspace={props.addWorkspace}
            onScanWorkspace={() => props.activeWorkspace ? props.scanWorkspace(props.activeWorkspace) : Promise.resolve()}
            onClearFilters={() => {
              props.setSearchQuery("");
              props.setStatusFilter("All");
            }}
          />
        ) : (
          <div className="flex-1 overflow-y-auto p-8 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 items-start content-start auto-rows-max pb-20">
            {props.filteredVenvs.map((v) => (
              <VenvCard
                key={v.path}
                venv={v}
                syncing={props.syncingVenv === v.path}
                onSync={props.syncSingleVenv}
                onClone={props.setCloneSource}
                onOpenStudio={props.openStudio}
                onDelete={props.handleDeleteVenv}
                setMessage={props.setMessage}
              />
            ))}
          </div>
        )}

        {props.selectedVenv && (
          <StudioModal
            selectedVenv={props.selectedVenv}
            venvDetails={props.venvDetails}
            studioTab={props.studioTab}
            setStudioTab={props.setStudioTab}
            scripts={props.scripts}
            envContent={props.envContent}
            setEnvContent={props.setEnvContent}
            pyvenvCfg={props.pyvenvCfg}
            onClose={() => props.setSelectedVenv(null)}
            onCompare={props.setCompareSource}
            onSaveTemplate={() => props.setIsSaveTemplateOpen(true)}
            reloadStudio={props.openStudio}
            onSync={props.syncSingleVenv}
            setMessage={props.setMessage}
          />
        )}
      </main>

      <AppOverlays
        workspaces={props.workspaces}
        activeWorkspace={props.activeWorkspace}
        venvCache={props.venvCache}
        selectedVenv={props.selectedVenv}
        selectedEngine={props.selectedEngine}
        availableManagers={props.availableManagers}
        systemPythons={props.systemPythons}
        cloneSource={props.cloneSource}
        setCloneSource={props.setCloneSource}
        compareSource={props.compareSource}
        setCompareSource={props.setCompareSource}
        isSaveTemplateOpen={props.isSaveTemplateOpen}
        setIsSaveTemplateOpen={props.setIsSaveTemplateOpen}
        savingTemplate={props.savingTemplate}
        setSavingTemplate={props.setSavingTemplate}
        isProjectDetectOpen={props.isProjectDetectOpen}
        setIsProjectDetectOpen={props.setIsProjectDetectOpen}
        isPythonInstallOpen={props.isPythonInstallOpen}
        setIsPythonInstallOpen={props.setIsPythonInstallOpen}
        isUvInstallOpen={props.isUvInstallOpen}
        setIsUvInstallOpen={props.setIsUvInstallOpen}
        installingUv={props.installingUv}
        uvInstallCmd={props.uvInstallCmd}
        isImportBundleOpen={props.isImportBundleOpen}
        setIsImportBundleOpen={props.setIsImportBundleOpen}
        wizardDismissed={props.wizardDismissed}
        setWizardDismissed={props.setWizardDismissed}
        isInitialLoading={props.isInitialLoading}
        isCacheOpen={props.isCacheOpen}
        setIsCacheOpen={props.setIsCacheOpen}
        isHygieneOpen={props.isHygieneOpen}
        setIsHygieneOpen={props.setIsHygieneOpen}
        isSearchOpen={props.isSearchOpen}
        setIsSearchOpen={props.setIsSearchOpen}
        scanWorkspace={props.scanWorkspace}
        setMessage={props.setMessage}
        handleSaveTemplate={props.handleSaveTemplate}
        onProjectBuild={props.onProjectBuild}
        onCancelProjectBuild={props.onCancelProjectBuild}
        onRequestUvInstall={props.onRequestUvInstall}
        onPythonInstalled={props.onPythonInstalled}
        onUvInstall={props.onUvInstall}
        onUvInstallElevated={props.onUvInstallElevated}
        onImportBundleImported={props.onImportBundleImported}
        onFirstRunPickWorkspace={props.onFirstRunPickWorkspace}
        onHygieneRefresh={props.onHygieneRefresh}
        openStudio={props.openStudio}
      />

      <div className="fixed right-5 bottom-5 z-[120] flex flex-col gap-2 pointer-events-none">
        {props.toasts.map(t => (
          <div
            key={t.id}
            className={cn(
              "min-w-[260px] max-w-[420px] text-[11px] font-bold px-4 py-3 rounded-xl border shadow-lg",
              t.tone === "error"
                ? "bg-red-50 border-red-200 text-red-700"
                : t.tone === "success"
                  ? "bg-green-50 border-green-200 text-green-700"
                  : "bg-slate-50 border-slate-200 text-slate-700"
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
};

const InitialLoadingScreen = () => (
  <div className="h-screen w-screen bg-slate-100 dark:bg-slate-950 flex flex-col items-center justify-center transition-colors duration-500">
    <div className="relative">
      <img
        src="/vorchestra-icon.png"
        alt="VOrchestra"
        className="w-32 h-32 animate-bounce dark:invert dark:opacity-95 drop-shadow-xl"
      />
      <div className="absolute inset-0 bg-blue-400 rounded-[2rem] animate-ping opacity-10"></div>
    </div>
    <div className="mt-10 flex flex-col items-center gap-2">
      <h2 className="text-xl font-black uppercase tracking-[0.3em] text-slate-800 dark:text-white animate-pulse">VOrchestra</h2>
      <div className="flex items-center gap-3">
        <div className="w-12 h-1 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
          <div className="w-full h-full bg-blue-600 origin-left animate-[loading_1.5s_ease-in-out_infinite]"></div>
        </div>
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Initializing Engine</span>
      </div>
    </div>
    <style dangerouslySetInnerHTML={{ __html: `
      @keyframes loading {
        0% { transform: scaleX(0); }
        50% { transform: scaleX(1); }
        100% { transform: scaleX(0); transform-origin: right; }
      }
    `}} />
  </div>
);

const EmptyEnvironmentState: React.FC<{
  hasWorkspaces: boolean;
  activeWorkspace: string;
  hasCachedEnvironments: boolean;
  onAddWorkspace: () => Promise<void>;
  onScanWorkspace: () => Promise<void>;
  onClearFilters: () => void;
}> = ({ hasWorkspaces, activeWorkspace, hasCachedEnvironments, onAddWorkspace, onScanWorkspace, onClearFilters }) => {
  const state = !hasWorkspaces
    ? {
      icon: FolderPlus,
      title: "No workspace selected",
      detail: "Add a project folder so VOrchestra can inventory local Python environments.",
      action: "Add workspace",
      onAction: onAddWorkspace
    }
    : hasCachedEnvironments
      ? {
        icon: SearchX,
        title: "No environments match this view",
        detail: "Your workspace has environments, but the current search or status filter hides them.",
        action: "Clear filters",
        onAction: async () => onClearFilters()
      }
      : {
        icon: RefreshCcw,
        title: "No environments found yet",
        detail: `Scan ${activeWorkspace || "this workspace"} to discover .venv, virtualenv, conda and pixi environments.`,
        action: "Scan workspace",
        onAction: onScanWorkspace
      };
  const Icon = state.icon;

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="vo-surface mx-auto mt-16 flex max-w-xl flex-col items-center rounded-[2rem] border px-8 py-12 text-center shadow-sm">
        <div className="vo-subpanel flex h-16 w-16 items-center justify-center rounded-2xl border">
          <Icon size={28} className="text-blue-600" />
        </div>
        <h2 className="mt-5 text-sm font-black uppercase tracking-widest text-slate-800 dark:text-white">{state.title}</h2>
        <p className="mt-2 max-w-md text-xs font-bold leading-relaxed text-slate-500 dark:text-slate-400">{state.detail}</p>
        <button
          onClick={() => void state.onAction()}
          className="vo-primary-action mt-6 rounded-xl px-5 py-2 text-[10px] font-black uppercase tracking-widest transition-all"
        >
          {state.action}
        </button>
      </div>
    </div>
  );
};
