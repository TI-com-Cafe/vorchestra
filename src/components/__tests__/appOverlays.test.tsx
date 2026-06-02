import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppOverlays } from "../AppOverlays";
import { VenvInfo } from "../../types";

vi.mock("../CommandPalette", () => ({
  CommandPalette: ({ isOpen }: { isOpen: boolean }) => isOpen ? <div>Command palette open</div> : null
}));
vi.mock("../FirstRunWizard", () => ({
  FirstRunWizard: () => <div>First run wizard</div>
}));
vi.mock("../CacheOverlay", () => ({
  CacheOverlay: ({ venvPaths, venvs }: { venvPaths: string[]; venvs?: VenvInfo[] }) => (
    <div>Cache overlay {venvPaths.length} / {venvs?.length ?? 0}</div>
  )
}));
vi.mock("../HygieneOverlay", () => ({
  HygieneOverlay: ({ workspaces }: { workspaces: string[] }) => <div>Hygiene overlay {workspaces.join(",")}</div>
}));
vi.mock("../CompareVenvModal", () => ({
  CompareVenvModal: ({ candidates }: { candidates: VenvInfo[] }) => <div>Compare modal {candidates.length}</div>
}));
vi.mock("../CloneVenvModal", () => ({
  CloneVenvModal: ({ source }: { source: VenvInfo }) => <div>Clone modal {source.name}</div>
}));
vi.mock("../SaveTemplateModal", () => ({
  SaveTemplateModal: ({ venvName }: { venvName: string }) => <div>Save template {venvName}</div>
}));
vi.mock("../ProjectDetectModal", () => ({
  ProjectDetectModal: () => <div>Project detect modal</div>
}));
vi.mock("../PythonInstallModal", () => ({
  PythonInstallModal: () => <div>Python install modal</div>
}));
vi.mock("../UvInstallModal", () => ({
  UvInstallModal: ({ command }: { command: string }) => <div>UV install modal {command}</div>
}));
vi.mock("../ImportBundleModal", () => ({
  ImportBundleModal: () => <div>Import bundle modal</div>
}));

const venv: VenvInfo = {
  name: "api",
  path: "/workspace/api/.venv",
  version: "Python 3.12",
  status: "Healthy",
  issue: undefined,
  last_modified: 1,
  manager_type: "uv"
};

const otherVenv: VenvInfo = {
  ...venv,
  name: "worker",
  path: "/workspace/worker/.venv"
};

const noopAsync = vi.fn(async () => undefined);
const noopSetter = vi.fn();

function renderOverlays(overrides: Partial<React.ComponentProps<typeof AppOverlays>> = {}) {
  return render(
    <AppOverlays
      workspaces={[{ path: "/workspace", is_default: true }]}
      activeWorkspace="/workspace"
      venvCache={{ "/workspace": [venv, otherVenv] }}
      selectedVenv={null}
      selectedEngine="uv"
      availableManagers={{ uv: true, poetry: false, pdm: false, conda: false, pixi: false }}
      systemPythons={["/usr/bin/python3|Python 3.12"]}
      cloneSource={null}
      setCloneSource={noopSetter}
      compareSource={null}
      setCompareSource={noopSetter}
      isSaveTemplateOpen={false}
      setIsSaveTemplateOpen={noopSetter}
      savingTemplate={false}
      setSavingTemplate={noopSetter}
      isProjectDetectOpen={false}
      setIsProjectDetectOpen={noopSetter}
      isPythonInstallOpen={false}
      setIsPythonInstallOpen={noopSetter}
      isUvInstallOpen={false}
      setIsUvInstallOpen={noopSetter}
      installingUv={false}
      uvInstallCmd="install uv"
      isImportBundleOpen={false}
      setIsImportBundleOpen={noopSetter}
      wizardDismissed={true}
      setWizardDismissed={noopSetter}
      isInitialLoading={false}
      isCacheOpen={false}
      setIsCacheOpen={noopSetter}
      isHygieneOpen={false}
      setIsHygieneOpen={noopSetter}
      isSearchOpen={false}
      setIsSearchOpen={noopSetter}
      scanWorkspace={noopAsync}
      setMessage={vi.fn()}
      handleSaveTemplate={noopAsync}
      onProjectBuild={noopAsync}
      onCancelProjectBuild={noopAsync}
      onRequestUvInstall={noopAsync}
      onPythonInstalled={noopAsync}
      onUvInstall={noopAsync}
      onUvInstallElevated={noopAsync}
      onImportBundleImported={noopAsync}
      onFirstRunPickWorkspace={noopAsync}
      onHygieneRefresh={noopAsync}
      openStudio={noopAsync}
      {...overrides}
    />
  );
}

describe("AppOverlays", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders command palette only when search overlay is open", async () => {
    renderOverlays({ isSearchOpen: true });
    expect(await screen.findByText("Command palette open")).toBeInTheDocument();
  });

  it("renders first-run wizard when no workspace exists and wizard was not dismissed", async () => {
    renderOverlays({ workspaces: [], venvCache: {}, wizardDismissed: false });
    expect(await screen.findByText("First run wizard")).toBeInTheDocument();
  });

  it("passes all other venvs as compare candidates", async () => {
    renderOverlays({ compareSource: venv });
    expect(await screen.findByText("Compare modal 1")).toBeInTheDocument();
  });

  it("renders cache and hygiene overlays with workspace-derived inputs", async () => {
    renderOverlays({ isCacheOpen: true, isHygieneOpen: true });
    expect(await screen.findByText("Cache overlay 2 / 2")).toBeInTheDocument();
    expect(screen.getByText("Hygiene overlay /workspace")).toBeInTheDocument();
  });
});
