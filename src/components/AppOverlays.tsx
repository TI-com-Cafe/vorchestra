import { Dispatch, SetStateAction, Suspense, lazy } from "react";
import { Loader2 } from "lucide-react";

import { VenvInfo } from "../types";

const HygieneOverlay = lazy(() => import("./HygieneOverlay").then((m) => ({ default: m.HygieneOverlay })));
const CommandPalette = lazy(() => import("./CommandPalette").then((m) => ({ default: m.CommandPalette })));
const UvInstallModal = lazy(() => import("./UvInstallModal").then((m) => ({ default: m.UvInstallModal })));
const PythonInstallModal = lazy(() => import("./PythonInstallModal").then((m) => ({ default: m.PythonInstallModal })));
const ProjectDetectModal = lazy(() => import("./ProjectDetectModal").then((m) => ({ default: m.ProjectDetectModal })));
const CloneVenvModal = lazy(() => import("./CloneVenvModal").then((m) => ({ default: m.CloneVenvModal })));
const CompareVenvModal = lazy(() => import("./CompareVenvModal").then((m) => ({ default: m.CompareVenvModal })));
const CacheOverlay = lazy(() => import("./CacheOverlay").then((m) => ({ default: m.CacheOverlay })));
const ImportBundleModal = lazy(() => import("./ImportBundleModal").then((m) => ({ default: m.ImportBundleModal })));
const FirstRunWizard = lazy(() => import("./FirstRunWizard").then((m) => ({ default: m.FirstRunWizard })));
const SaveTemplateModal = lazy(() => import("./SaveTemplateModal").then((m) => ({ default: m.SaveTemplateModal })));

type Workspace = { path: string; is_default: boolean };
type Engine = "pip" | "uv";
type ProjectDetectBuildHandler = (args: {
  projectRoot: string;
  pythonBin: string;
  engine: Engine;
  venvName: string;
  packages: string[];
  onProgress?: (message: string) => void;
  onJobStart?: (jobId: string) => void;
}) => Promise<void>;

interface AppOverlaysProps {
  workspaces: Workspace[];
  activeWorkspace: string;
  venvCache: Record<string, VenvInfo[]>;
  selectedVenv: VenvInfo | null;
  selectedEngine: Engine;
  availableManagers: { uv: boolean; poetry: boolean; pdm: boolean; conda: boolean; pixi: boolean };
  systemPythons: string[];
  cloneSource: VenvInfo | null;
  setCloneSource: Dispatch<SetStateAction<VenvInfo | null>>;
  compareSource: VenvInfo | null;
  setCompareSource: Dispatch<SetStateAction<VenvInfo | null>>;
  isSaveTemplateOpen: boolean;
  setIsSaveTemplateOpen: Dispatch<SetStateAction<boolean>>;
  savingTemplate: boolean;
  setSavingTemplate: Dispatch<SetStateAction<boolean>>;
  isProjectDetectOpen: boolean;
  setIsProjectDetectOpen: Dispatch<SetStateAction<boolean>>;
  isPythonInstallOpen: boolean;
  setIsPythonInstallOpen: Dispatch<SetStateAction<boolean>>;
  isUvInstallOpen: boolean;
  setIsUvInstallOpen: Dispatch<SetStateAction<boolean>>;
  installingUv: boolean;
  uvInstallCmd: string;
  isImportBundleOpen: boolean;
  setIsImportBundleOpen: Dispatch<SetStateAction<boolean>>;
  wizardDismissed: boolean;
  setWizardDismissed: Dispatch<SetStateAction<boolean>>;
  isInitialLoading: boolean;
  isCacheOpen: boolean;
  setIsCacheOpen: Dispatch<SetStateAction<boolean>>;
  isHygieneOpen: boolean;
  setIsHygieneOpen: Dispatch<SetStateAction<boolean>>;
  isSearchOpen: boolean;
  setIsSearchOpen: Dispatch<SetStateAction<boolean>>;
  scanWorkspace: (path: string) => Promise<void>;
  setMessage: (message: string) => void;
  handleSaveTemplate: (templateName: string) => Promise<void>;
  onProjectBuild: ProjectDetectBuildHandler;
  onCancelProjectBuild: (jobId: string) => Promise<void>;
  onRequestUvInstall: () => Promise<void>;
  onPythonInstalled: () => Promise<void>;
  onUvInstall: () => Promise<void>;
  onUvInstallElevated: () => Promise<void>;
  onImportBundleImported: (workspace: string) => Promise<void>;
  onFirstRunPickWorkspace: (path: string) => Promise<void>;
  onHygieneRefresh: () => Promise<void>;
  openStudio: (venv: VenvInfo, tab?: "packages" | "automation" | "config" | "diagnostics" | "lock" | "repair" | "deploy") => Promise<void>;
}

export const AppOverlays = (props: AppOverlaysProps) => {
  const allVenvs = Object.values(props.venvCache).flat();

  return (
    <Suspense fallback={<LazyOverlayFallback />}>
      {props.cloneSource && (
        <CloneVenvModal
          source={props.cloneSource}
          workspaces={props.workspaces}
          defaultWorkspace={props.activeWorkspace}
          onClose={() => props.setCloneSource(null)}
          onCloned={async (_msg, ws) => {
            await props.scanWorkspace(ws);
            props.setMessage(`Cloned ${props.cloneSource?.name ?? "environment"}.`);
          }}
        />
      )}

      {props.selectedVenv && props.isSaveTemplateOpen && (
        <SaveTemplateModal
          venvName={props.selectedVenv.name}
          saving={props.savingTemplate}
          onClose={() => {
            if (!props.savingTemplate) props.setIsSaveTemplateOpen(false);
          }}
          onSave={async (templateName) => {
            props.setSavingTemplate(true);
            try {
              await props.handleSaveTemplate(templateName);
              props.setIsSaveTemplateOpen(false);
            } finally {
              props.setSavingTemplate(false);
            }
          }}
        />
      )}

      {props.compareSource && (
        <CompareVenvModal
          source={props.compareSource}
          candidates={allVenvs.filter(v => v.path !== props.compareSource?.path)}
          onClose={() => props.setCompareSource(null)}
        />
      )}

      {props.isProjectDetectOpen && (
        <ProjectDetectModal
          defaultEngine={props.selectedEngine}
          uvAvailable={props.availableManagers.uv}
          systemPythons={props.systemPythons}
          onClose={() => props.setIsProjectDetectOpen(false)}
          onCancelBuild={props.onCancelProjectBuild}
          onBuild={props.onProjectBuild}
        />
      )}

      {props.isPythonInstallOpen && (
        <PythonInstallModal
          uvAvailable={props.availableManagers.uv}
          onClose={() => props.setIsPythonInstallOpen(false)}
          onRequestUvInstall={props.onRequestUvInstall}
          onInstalled={props.onPythonInstalled}
        />
      )}

      {props.isUvInstallOpen && (
        <UvInstallModal
          command={props.uvInstallCmd}
          installing={props.installingUv}
          onClose={() => props.setIsUvInstallOpen(false)}
          onInstall={props.onUvInstall}
          onInstallElevated={props.onUvInstallElevated}
        />
      )}

      {props.isImportBundleOpen && (
        <ImportBundleModal
          workspaces={props.workspaces}
          defaultWorkspace={props.activeWorkspace}
          systemPythons={props.systemPythons}
          onClose={() => props.setIsImportBundleOpen(false)}
          onImported={props.onImportBundleImported}
        />
      )}

      {!props.wizardDismissed && !props.isInitialLoading && props.workspaces.length === 0 && (
        <FirstRunWizard
          uvAvailable={props.availableManagers.uv}
          systemPythonsCount={props.systemPythons.length}
          onPickWorkspace={props.onFirstRunPickWorkspace}
          onInstallUv={props.onRequestUvInstall}
          onSkip={() => props.setWizardDismissed(true)}
        />
      )}

      {props.isCacheOpen && (
        <CacheOverlay
          venvPaths={allVenvs.map(v => v.path)}
          venvs={allVenvs}
          onOpenStudio={(venv) => props.openStudio(venv)}
          onClose={() => props.setIsCacheOpen(false)}
          setMessage={props.setMessage}
        />
      )}

      {props.isHygieneOpen && (
        <HygieneOverlay
          workspaces={props.workspaces.map(w => w.path)}
          onClose={() => props.setIsHygieneOpen(false)}
          onRefresh={props.onHygieneRefresh}
          setMessage={props.setMessage}
        />
      )}

      <CommandPalette
        isOpen={props.isSearchOpen}
        onClose={() => props.setIsSearchOpen(false)}
        venvCache={props.venvCache}
        onSelectVenv={props.openStudio}
      />
    </Suspense>
  );
};

const LazyOverlayFallback = () => (
  <div className="fixed inset-0 z-[120] pointer-events-none flex items-center justify-center">
    <div className="vo-surface flex items-center gap-3 px-4 py-3 rounded-2xl border shadow-xl text-slate-500">
      <Loader2 size={16} className="animate-spin text-blue-600" />
      <span className="text-[10px] font-black uppercase tracking-widest">Loading...</span>
    </div>
  </div>
);
