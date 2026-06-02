import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { NewEnvironmentBar } from "../NewEnvironmentBar";
import { CacheOverlay } from "../CacheOverlay";
import { ProjectBoard, parseProjectCommandArgs } from "../ProjectBoard";
import { VenvCard } from "../VenvCard";
import { StudioConfig } from "../Studio/StudioConfig";
import { StudioDependencyTree } from "../Studio/StudioDependencyTree";
import { summarizeDependencyGraph } from "../Studio/StudioDependencyGraph";
import { StudioDiagnostics } from "../Studio/StudioDiagnostics";
import { StudioLockfile } from "../Studio/StudioLockfile";
import { StudioAutomation, parseAutomationArgs } from "../Studio/StudioAutomation";
import { StudioRepair } from "../Studio/StudioRepair";
import { StudioDeploy } from "../Studio/StudioDeploy";
import { PackageManifestToolbar } from "../Studio/PackageManifestToolbar";
import { PyPIExplorer } from "../Studio/PyPIExplorer";
import { PackageInsightOverlays } from "../Studio/PackageInsightOverlays";
import { StudioModal } from "../StudioModal";
import { CommandPalette } from "../CommandPalette";
import { FirstRunWizard } from "../FirstRunWizard";
import { ImportBundleModal } from "../ImportBundleModal";
import { SaveTemplateModal } from "../SaveTemplateModal";
import { PYTHON_TEMPLATES } from "../../constants/templates";
import { Script, VenvInfo } from "../../types";

const invokeMock = vi.fn();
const saveDialogMock = vi.fn();
const askDialogMock = vi.fn();
const openDialogMock = vi.fn();
const waitForBackgroundJobMock = vi.fn();
const packageInstallMock = vi.fn();
const packageInstallElevatedMock = vi.fn();
const dependencyPrereqMock = vi.fn();
const dependencyTreeMock = vi.fn();
const cancelDependencyTreeMock = vi.fn();
const addScriptMock = vi.fn();
const deleteScriptMock = vi.fn();
const addSingleVenvMock = vi.fn();
const updateSingleVenvMock = vi.fn();
const removeVenvByPathMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args)
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: (...args: unknown[]) => saveDialogMock(...args),
  ask: (...args: unknown[]) => askDialogMock(...args),
  open: (...args: unknown[]) => openDialogMock(...args)
}));

vi.mock("../../services/backgroundJobs", () => ({
  waitForBackgroundJob: (...args: unknown[]) => waitForBackgroundJobMock(...args)
}));

vi.mock("../../services/packageManager", () => ({
  packageService: {
    install: (...args: unknown[]) => packageInstallMock(...args),
    installElevated: (...args: unknown[]) => packageInstallElevatedMock(...args),
    checkDependencyTreePrereq: (...args: unknown[]) => dependencyPrereqMock(...args),
    getDependencyTree: (...args: unknown[]) => dependencyTreeMock(...args),
    cancelDependencyTree: (...args: unknown[]) => cancelDependencyTreeMock(...args)
  },
  needsElevation: (err: unknown) => String(err).includes("NEEDS_ELEVATION:"),
  stripElevationPrefix: (err: unknown) => String(err).replace("NEEDS_ELEVATION:", "").trim()
}));

vi.mock("../../services/db", () => ({
  dbService: {
    addScript: (...args: unknown[]) => addScriptMock(...args),
    deleteScript: (...args: unknown[]) => deleteScriptMock(...args),
    addSingleVenv: (...args: unknown[]) => addSingleVenvMock(...args),
    updateSingleVenv: (...args: unknown[]) => updateSingleVenvMock(...args),
    removeVenvByPath: (...args: unknown[]) => removeVenvByPathMock(...args)
  }
}));

const venv: VenvInfo = {
  name: "api",
  path: "/workspace/api/.venv",
  version: "Python 3.12.4",
  status: "Healthy",
  issue: undefined,
  last_modified: 1,
  manager_type: "uv"
};

const pipVenv: VenvInfo = {
  ...venv,
  manager_type: "pip"
};

describe("product harness coverage", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    saveDialogMock.mockReset();
    askDialogMock.mockReset();
    openDialogMock.mockReset();
    waitForBackgroundJobMock.mockReset();
    packageInstallMock.mockReset();
    packageInstallElevatedMock.mockReset();
    dependencyPrereqMock.mockReset();
    dependencyTreeMock.mockReset();
    cancelDependencyTreeMock.mockReset();
    addScriptMock.mockReset();
    deleteScriptMock.mockReset();
    addSingleVenvMock.mockReset();
    updateSingleVenvMock.mockReset();
    removeVenvByPathMock.mockReset();
  });

  it("parses uv project command arguments with quotes", () => {
    expect(parseProjectCommandArgs('pytest -k "not slow" --maxfail=1')).toEqual([
      "pytest",
      "-k",
      "not slow",
      "--maxfail=1"
    ]);
    expect(parseProjectCommandArgs("python -m pytest 'tests/unit suite'")).toEqual([
      "python",
      "-m",
      "pytest",
      "tests/unit suite"
    ]);
    expect(parseProjectCommandArgs('"django[argon2]>=5" "python-dotenv; python_version >= \\"3.10\\""')).toEqual([
      "django[argon2]>=5",
      'python-dotenv; python_version >= "3.10"'
    ]);
  });

  it("parses automation quick-tool arguments with quotes", () => {
    expect(parseAutomationArgs('pytest -k "not slow" --maxfail=1')).toEqual([
      "pytest",
      "-k",
      "not slow",
      "--maxfail=1"
    ]);
  });

  it("summarizes cache cleanup opportunities and clears the largest cache", async () => {
    const setMessage = vi.fn();
    const openStudio = vi.fn(async () => undefined);
    askDialogMock.mockResolvedValue(true);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "start_get_cache_summary_job") return "job-cache";
      if (command === "start_purge_cache_job") return "job-purge";
      if (command === "open_terminal") return null;
      return null;
    });
    waitForBackgroundJobMock.mockImplementation(async (jobId: string) => {
      if (jobId === "job-cache") {
        return {
          total_mb: 900,
          locations: [
            {
              kind: "pip",
              label: "pip cache",
              path: "/cache/pip",
              size_mb: 700,
              exists: true,
              top_entries: [{ name: "http", path: "/cache/pip/http", size_mb: 400 }]
            },
            {
              kind: "uv_per_venv",
              label: "api (per-venv uv cache)",
              path: "/workspace/api/.venv/.uv-cache",
              size_mb: 200,
              exists: true,
              top_entries: []
            }
          ],
          duplicate_wheels: [
            {
              file_name: "demo-1.0.0-py3-none-any.whl",
              copies: 2,
              total_mb: 40,
              paths: ["/cache/pip/demo.whl", "/cache/uv/demo.whl"]
            }
          ],
          venvs: [
            {
              name: "api",
              path: "/workspace/api/.venv",
              size_mb: 1536,
              exists: true,
              last_modified: 1,
              days_since_modified: 45,
              signals: ["large", "stale"]
            },
            {
              name: "missing",
              path: "/workspace/missing/.venv",
              size_mb: 0,
              exists: false,
              last_modified: 0,
              days_since_modified: null,
              signals: ["missing"]
            }
          ],
          total_venv_mb: 1536
        };
      }
      if (jobId === "job-purge") return "Cleared cache.";
      return null;
    });

    render(
      <CacheOverlay
        venvPaths={[venv.path]}
        venvs={[venv]}
        onOpenStudio={openStudio}
        onClose={vi.fn()}
        setMessage={setMessage}
      />
    );

    expect(await screen.findByText("Cleanup opportunities")).toBeInTheDocument();
    expect(screen.getByText("Largest target")).toBeInTheDocument();
    expect(screen.getAllByText("700.0 MB").length).toBeGreaterThan(0);
    expect(screen.getByText("Cleanup plan")).toBeInTheDocument();
    expect(screen.getByText(/Clear pip cache first/i)).toBeInTheDocument();
    expect(screen.getByText(/Review 1 large stale environment/i)).toBeInTheDocument();
    expect(screen.getByText(/Remove 1 missing database entry/i)).toBeInTheDocument();
    expect(screen.getByText("Duplicate wheels")).toBeInTheDocument();
    expect(screen.getByText("Environment cleanup")).toBeInTheDocument();
    expect(screen.getByText("Large + stale")).toBeInTheDocument();
    expect(screen.getByText("Missing")).toBeInTheDocument();
    expect(screen.getByText(/Review in Studio before deleting/i)).toBeInTheDocument();
    expect(screen.getByText(/remove the stale database entry/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /candidates · 2/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /open api in studio/i }));
    expect(openStudio).toHaveBeenCalledWith(venv);
    expect(setMessage).toHaveBeenCalledWith("Opening api in Studio...");

    await userEvent.click(screen.getByRole("button", { name: /open api terminal/i }));
    expect(invokeMock).toHaveBeenCalledWith("open_terminal", { path: "/workspace/api/.venv" });

    await userEvent.click(screen.getByRole("button", { name: /remove stale entry for missing/i }));
    expect(screen.getByText("Confirm cleanup action")).toBeInTheDocument();
    expect(removeVenvByPathMock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /confirm remove entry/i }));
    expect(removeVenvByPathMock).toHaveBeenCalledWith("/workspace/missing/.venv");
    expect(setMessage).toHaveBeenCalledWith("Removed stale entry for missing.");

    await userEvent.click(screen.getByRole("button", { name: /clear largest/i }));
    expect(screen.getByText(/Clear pip cache and reclaim 700.0 MB/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /confirm clear cache/i }));
    expect(askDialogMock).not.toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledWith("start_purge_cache_job", { path: "/cache/pip" });
    await waitFor(() => expect(setMessage).toHaveBeenCalledWith("Cleared cache."));
  });

  it("cancels an active cache scan from the overlay", async () => {
    const setMessage = vi.fn();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "start_get_cache_summary_job") return "job-cache";
      if (command === "cancel_background_job") return true;
      return null;
    });
    waitForBackgroundJobMock.mockImplementation((_jobId: string, onUpdate?: (snapshot: { message?: string; progress?: number }) => void) => {
      onUpdate?.({ message: "Scanning cache", progress: 0.4 });
      return new Promise(() => undefined);
    });

    const { unmount } = render(<CacheOverlay venvPaths={[venv.path]} onClose={vi.fn()} setMessage={setMessage} />);

    const stopButtons = await screen.findAllByRole("button", { name: /stop scan/i });
    await userEvent.click(stopButtons[0]);
    expect(invokeMock).toHaveBeenCalledWith("cancel_background_job", { jobId: "job-cache" });
    expect(setMessage).toHaveBeenCalledWith("Cache scan cancellation requested.");
    unmount();
  });

  it("groups environments by project and scans manifests from project view", async () => {
    const setMessage = vi.fn();
    const onOpenStudio = vi.fn();
    const onSync = vi.fn();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "start_detect_project_manifests_job") return "job-project";
      if (command === "start_run_uv_project_job") return "job-uv";
      if (command === "open_terminal") return null;
      return null;
    });
    waitForBackgroundJobMock.mockImplementation(async (jobId: string, onUpdate?: (snapshot: { message?: string }) => void) => {
      if (jobId === "job-project") {
        onUpdate?.({ message: "Reading pyproject.toml..." });
        return {
          project_root: "/workspace/api",
          manifests: [
            { kind: "pyproject", path: "/workspace/api/pyproject.toml", packages: ["fastapi"], note: null },
            { kind: "conda_environment", path: "/workspace/api/environment.yml", packages: ["numpy"], note: "Conda dependencies are read-only." },
            { kind: "pixi_toml", path: "/workspace/api/pixi.toml", packages: ["polars"], note: "pixi.toml detected as read-only inventory." }
          ],
          merged_packages: ["fastapi"],
          workspace: {
            manager: "uv",
            members: ["packages/*", "apps/api"],
            excludes: ["packages/legacy"]
          }
        };
      }
      if (jobId === "job-uv") {
        onUpdate?.({ message: "Running uv sync..." });
        return {
          stdout: "Resolved 12 packages",
          stderr: "",
          exit_code: 0,
          success: true,
          tool_missing: false
        };
      }
      return null;
    });

    render(
      <ProjectBoard
        venvs={[
          venv,
          { ...venv, name: "api-test", path: "/workspace/api/.venv-test", manager_type: "pip" },
          { ...venv, name: "worker", path: "/workspace/worker/.venv", is_outdated: true }
        ]}
        onOpenStudio={onOpenStudio}
        onSync={onSync}
        setMessage={setMessage}
      />
    );

    expect(screen.getAllByText("api").length).toBeGreaterThan(0);
    expect(screen.getByText("worker")).toBeInTheDocument();
    expect(screen.getAllByText("Next best action")).toHaveLength(2);
    expect(screen.getByText("Scan dependency sources")).toBeInTheDocument();
    expect(screen.getByText("Refresh project inventory")).toBeInTheDocument();
    expect(screen.getAllByText("Best env health")).toHaveLength(2);
    expect(screen.getAllByText("Inventory issues")).toHaveLength(2);
    expect(screen.getAllByText("Manifest scan")).toHaveLength(2);
    expect(screen.getAllByText("Installable inputs")).toHaveLength(2);
    expect(screen.getAllByText("Not scanned")).toHaveLength(2);
    expect(screen.getAllByText("Project posture")).toHaveLength(2);
    expect(screen.getAllByText("Project command center")).toHaveLength(2);
    expect(screen.getByText("Manifest sources not scanned yet")).toBeInTheDocument();
    expect(screen.getByText("1 environment need attention")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /scan now/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sync now/i })).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole("button", { name: /repair/i })[0]);
    expect(onOpenStudio).toHaveBeenCalledWith(expect.objectContaining({ name: "worker" }), "repair");

    const apiInitialCard = screen.getAllByText("api")[0].closest("article");
    expect(apiInitialCard).not.toBeNull();
    expect(within(apiInitialCard!).getByText("Project environments")).toBeInTheDocument();
    expect(within(apiInitialCard!).getByText(/Pick the exact venv before changing packages/i)).toBeInTheDocument();
    expect(within(apiInitialCard!).getByText("2 total")).toBeInTheDocument();
    expect(within(apiInitialCard!).getByText("api-test")).toBeInTheDocument();
    await userEvent.click(within(apiInitialCard!).getAllByRole("button", { name: /^packages$/i })[0]);
    expect(onOpenStudio).toHaveBeenCalledWith(expect.objectContaining({ name: "api" }), "packages");
    await userEvent.click(within(apiInitialCard!).getByRole("button", { name: /lockfile/i }));
    await userEvent.click(within(apiInitialCard!).getByRole("button", { name: /config/i }));
    await userEvent.click(within(apiInitialCard!).getByRole("button", { name: /automation/i }));
    await userEvent.click(within(apiInitialCard!).getByRole("button", { name: /diagnostics/i }));
    await userEvent.click(within(apiInitialCard!).getByRole("button", { name: /terminal/i }));
    expect(onOpenStudio).toHaveBeenCalledWith(expect.objectContaining({ name: "api" }), "lock");
    expect(onOpenStudio).toHaveBeenCalledWith(expect.objectContaining({ name: "api" }), "config");
    expect(onOpenStudio).toHaveBeenCalledWith(expect.objectContaining({ name: "api" }), "automation");
    expect(onOpenStudio).toHaveBeenCalledWith(expect.objectContaining({ name: "api" }), "diagnostics");
    expect(invokeMock).toHaveBeenCalledWith("open_terminal", { path: "/workspace/api" });
    expect(setMessage).toHaveBeenCalledWith("Opening api project terminal...");

    await userEvent.click(screen.getAllByRole("button", { name: /scan/i })[1]);
    expect(invokeMock).toHaveBeenCalledWith("start_detect_project_manifests_job", { path: "/workspace/api" });
    expect(await screen.findByText("pyproject.toml")).toBeInTheDocument();
    expect(setMessage).toHaveBeenCalledWith("Detected 3 manifest(s) in api.");
    expect(screen.getByText("environment.yml")).toBeInTheDocument();
    expect(screen.getByText("pixi.toml")).toBeInTheDocument();
    expect(screen.getAllByText("Read-only")).toHaveLength(2);
    expect(screen.getByText("Installable dependency inputs")).toBeInTheDocument();
    expect(screen.getByText("1 ready")).toBeInTheDocument();
    expect(screen.getByText("3 scanned")).toBeInTheDocument();
    expect(screen.getByText("fastapi")).toBeInTheDocument();
    expect(screen.getByText("2 read-only manifests detected")).toBeInTheDocument();
    expect(screen.getByText("uv workspace")).toBeInTheDocument();
    expect(screen.getByText(/may affect all configured workspace members/i)).toBeInTheDocument();
    expect(screen.getByText("packages/*")).toBeInTheDocument();
    expect(screen.getByText("apps/api")).toBeInTheDocument();
    expect(screen.getByText("packages/legacy")).toBeInTheDocument();
    expect(screen.getAllByText("Run uv sync").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /^run uv sync$/i })).toBeInTheDocument();
    const scannedApiCard = screen.getAllByText("api")[0].closest("article");
    expect(scannedApiCard).not.toBeNull();
    expect(within(scannedApiCard!).getByText("uv sync scope")).toBeInTheDocument();
    await userEvent.click(within(scannedApiCard!).getByLabelText(/include all dependency groups/i));
    await userEvent.click(within(scannedApiCard!).getByLabelText(/include all extras/i));

    await userEvent.click(within(scannedApiCard!).getAllByRole("button", { name: /uv sync/i })[1]);
    expect(invokeMock).toHaveBeenCalledWith("start_run_uv_project_job", {
      venvPath: "/workspace/api/.venv",
      action: "sync",
      runArgs: ["--all-groups", "--all-extras"],
      timeoutSecs: 600
    });
    expect(await screen.findByText(/Resolved 12 packages/i)).toBeInTheDocument();

    invokeMock.mockClear();
    const apiCard = screen.getAllByText("api")[0].closest("article");
    expect(apiCard).not.toBeNull();
    expect(within(apiCard!).getByText(/Group is passed as/)).toBeInTheDocument();
    expect(within(apiCard!).getByText(/Empty runs/)).toBeInTheDocument();

    await userEvent.type(within(apiCard!).getByPlaceholderText("pytest -q"), "pytest -q");
    await userEvent.click(within(apiCard!).getByRole("button", { name: /^uv run py$/i }));
    expect(invokeMock).toHaveBeenCalledWith("start_run_uv_project_job", {
      venvPath: "/workspace/api/.venv",
      action: "run",
      runArgs: ["pytest", "-q"],
      timeoutSecs: 600
    });

    invokeMock.mockClear();
    fireEvent.change(within(apiCard!).getByPlaceholderText("httpx fastapi[standard]"), {
      target: { value: '"httpx[http2]" "python-dotenv; python_version >= \\"3.10\\""' }
    });
    await userEvent.type(within(apiCard!).getByPlaceholderText(/optional group/i), "dev");
    await userEvent.click(within(apiCard!).getByRole("button", { name: /^uv add$/i }));
    expect(invokeMock).toHaveBeenCalledWith("start_run_uv_project_job", {
      venvPath: "/workspace/api/.venv",
      action: "add",
      runArgs: ["--group", "dev", "httpx[http2]", 'python-dotenv; python_version >= "3.10"'],
      timeoutSecs: 600
    });
  });

  it("routes native project next action to diagnostics", async () => {
    const onOpenStudio = vi.fn();
    const condaVenv = {
      ...venv,
      manager_type: "conda" as const,
      path: "/workspace/native/conda-env",
      name: "conda-env"
    };
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "start_detect_project_manifests_job") return "job-native-detect";
      return null;
    });
    waitForBackgroundJobMock.mockImplementation(async (jobId: string) => {
      if (jobId === "job-native-detect") {
        return {
          root: "/workspace/native",
          workspace: null,
          manifests: [
            { kind: "conda_environment", path: "/workspace/native/environment.yml", packages: ["numpy"], note: "Conda read-only inventory." }
          ],
          merged_packages: []
        };
      }
      return null;
    });

    render(
      <ProjectBoard
        venvs={[condaVenv]}
        onOpenStudio={onOpenStudio}
        onSync={vi.fn()}
        setMessage={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /^scan now$/i }));
    expect(await screen.findByText("Review Conda native inventory")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /open diagnostics/i }));
    expect(onOpenStudio).toHaveBeenCalledWith(condaVenv, "diagnostics");
  });

  it("cancels project scans and uv project actions from project view", async () => {
    const setMessage = vi.fn();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "start_detect_project_manifests_job") return "job-project";
      if (command === "start_run_uv_project_job") return "job-uv";
      if (command === "cancel_background_job") return true;
      return null;
    });
    waitForBackgroundJobMock.mockImplementation((jobId: string) => {
      if (jobId === "job-project") return new Promise(() => undefined);
      if (jobId === "job-uv") return new Promise(() => undefined);
      return null;
    });

    const { unmount } = render(
      <ProjectBoard
        venvs={[venv]}
        onOpenStudio={vi.fn()}
        onSync={vi.fn()}
        setMessage={setMessage}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /^scan$/i }));
    expect(await screen.findByRole("button", { name: /stop scan/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /stop scan/i }));
    expect(invokeMock).toHaveBeenCalledWith("cancel_background_job", { jobId: "job-project" });
    expect(setMessage).toHaveBeenCalledWith("api project scan cancellation requested.");
    unmount();

    invokeMock.mockClear();
    setMessage.mockClear();
    waitForBackgroundJobMock.mockImplementation((jobId: string) => {
      if (jobId === "job-project") {
        return Promise.resolve({
          project_root: "/workspace/api",
          manifests: [
            { kind: "pyproject", path: "/workspace/api/pyproject.toml", packages: ["fastapi"], note: null }
          ],
          merged_packages: ["fastapi"]
        });
      }
      if (jobId === "job-uv") return new Promise(() => undefined);
      return null;
    });

    const view = render(
      <ProjectBoard
        venvs={[venv]}
        onOpenStudio={vi.fn()}
        onSync={vi.fn()}
        setMessage={setMessage}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /^scan$/i }));
    expect(await screen.findByText("pyproject.toml")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^uv sync$/i }));
    expect(await screen.findByRole("button", { name: /stop uv sync/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /stop uv sync/i }));
    expect(invokeMock).toHaveBeenCalledWith("cancel_background_job", { jobId: "job-uv" });
    expect(setMessage).toHaveBeenCalledWith("api uv sync cancellation requested.");
    view.unmount();
  });

  it("finds environments by operational status in command palette and opens repair directly", async () => {
    const onClose = vi.fn();
    const onSelectVenv = vi.fn();
    render(
      <CommandPalette
        isOpen
        onClose={onClose}
        venvCache={{
          "/workspace": [
            venv,
            {
              ...venv,
              name: "broken-api",
              path: "/workspace/broken-api/.venv",
              status: "Broken",
              issue: "Python binary not found",
              manager_type: "pip"
            }
          ]
        }}
        onSelectVenv={onSelectVenv}
      />
    );

    const search = screen.getByPlaceholderText(/search environments/i);
    await userEvent.type(search, "stale remove");
    expect(screen.getByText("broken-api")).toBeInTheDocument();

    await userEvent.clear(search);
    await userEvent.type(search, "broken");
    expect(screen.getByText("broken-api")).toBeInTheDocument();
    expect(screen.getByText(/pip · broken/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /suggested/i }));
    expect(onSelectVenv).toHaveBeenCalledWith(expect.objectContaining({ name: "broken-api" }), "repair");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("opens command palette results directly on intent tabs", async () => {
    const onClose = vi.fn();
    const onSelectVenv = vi.fn();
    const user = userEvent.setup();
    render(
      <CommandPalette
        isOpen
        onClose={onClose}
        venvCache={{ "/workspace": [venv] }}
        onSelectVenv={onSelectVenv}
      />
    );

    const search = screen.getByPlaceholderText(/search environments/i);
    await user.type(search, "security audit");
    await user.keyboard("{Enter}");

    expect(onSelectVenv).toHaveBeenCalledWith(expect.objectContaining({ name: "api" }), "diagnostics");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("explains searchable operational terms when command palette has no matches", async () => {
    render(
      <CommandPalette
        isOpen
        onClose={vi.fn()}
        venvCache={{ "/workspace": [venv] }}
        onSelectVenv={vi.fn()}
      />
    );

    await userEvent.type(screen.getByPlaceholderText(/search environments/i), "does not match");
    expect(screen.getByText("No environments found")).toBeInTheDocument();
    expect(screen.getByText(/repair, sync, remove stale/i)).toBeInTheDocument();
  });

  it("drives the new-environment bar engine, installer and build controls", async () => {
    const setEngine = vi.fn();
    const setName = vi.fn();
    const setTemplate = vi.fn();
    const setUvInstallCmd = vi.fn();
    const setMessage = vi.fn();
    const onBuild = vi.fn();
    const onFromProject = vi.fn();
    const openUvInstall = vi.fn();
    const openPythonInstall = vi.fn();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "uv_install_command") return "curl -LsSf https://astral.sh/uv/install.sh | sh";
      if (command === "cancel_background_job") return true;
      return null;
    });

    render(
      <NewEnvironmentBar
        newVenvName="api"
        setNewVenvName={setName}
        selectedEngine="pip"
        setSelectedEngine={setEngine}
        availableManagers={{ uv: false, poetry: false, pdm: false, conda: true, pixi: true }}
        selectedPython="/usr/bin/python3"
        setSelectedPython={vi.fn()}
        systemPythons={["/usr/bin/python3|Python 3.12"]}
        selectedTemplate={PYTHON_TEMPLATES[0]}
        setSelectedTemplate={setTemplate}
        customTemplates={[{ id: "custom", name: "Custom Stack", pkgs: ["fastapi"] }]}
        loading={false}
        buildJobId="job-build"
        statusText="Building api..."
        onBuild={onBuild}
        onFromProject={onFromProject}
        setUvInstallCmd={setUvInstallCmd}
        openUvInstall={openUvInstall}
        openPythonInstall={openPythonInstall}
        setMessage={setMessage}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /\+ uv/i }));
    expect(setUvInstallCmd).toHaveBeenCalledWith(expect.stringContaining("uv/install.sh"));
    expect(openUvInstall).toHaveBeenCalledOnce();
    expect(screen.getByText(/Build plan:/i)).toHaveTextContent("PIP");
    expect(screen.getByText(/Conda \/ Pixi detected read-only/i)).toBeInTheDocument();

    await userEvent.selectOptions(screen.getAllByRole("combobox")[1], "custom");
    expect(setTemplate).toHaveBeenCalledWith(expect.objectContaining({ id: "custom" }));

    await userEvent.click(screen.getByRole("button", { name: /^build$/i }));
    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    await userEvent.click(screen.getByRole("button", { name: /from project/i }));

    expect(onBuild).toHaveBeenCalledOnce();
    expect(onFromProject).toHaveBeenCalledOnce();
    expect(invokeMock).toHaveBeenCalledWith("cancel_background_job", { jobId: "job-build" });
    expect(setMessage).toHaveBeenCalledWith("Cancelling build...");
  });

  it("guides first-run onboarding through the product value path", async () => {
    const onPickWorkspace = vi.fn();
    const onInstallUv = vi.fn();
    const onSkip = vi.fn();
    openDialogMock.mockResolvedValue("/workspace");

    render(
      <FirstRunWizard
        uvAvailable={false}
        systemPythonsCount={2}
        onPickWorkspace={onPickWorkspace}
        onInstallUv={onInstallUv}
        onSkip={onSkip}
      />
    );

    expect(screen.getByText("Create or import")).toBeInTheDocument();
    expect(screen.getByText("Setup readiness")).toBeInTheDocument();
    expect(screen.getByText("Workspace pending")).toBeInTheDocument();
    expect(screen.getByText("45")).toBeInTheDocument();
    expect(screen.getByText(/Install uv for faster workflows/i)).toBeInTheDocument();
    expect(screen.getByText("Python")).toBeInTheDocument();
    expect(screen.getByText("2 found")).toBeInTheDocument();
    expect(screen.getByText("pick next")).toBeInTheDocument();
    expect(screen.getByText("Repair first")).toBeInTheDocument();
    expect(screen.getByText("Check health")).toBeInTheDocument();
    expect(screen.getByText("2-minute golden path")).toBeInTheDocument();
    expect(screen.getByText("Pick workspace")).toBeInTheDocument();
    expect(screen.getByText(/immediately scans it/i)).toBeInTheDocument();
    expect(screen.getByText("Review inventory")).toBeInTheDocument();
    expect(screen.getByText("Open Studio")).toBeInTheDocument();
    expect(screen.getByText("Lock or audit")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /install uv now/i }));
    expect(onInstallUv).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole("button", { name: /browse for folder/i }));
    expect(openDialogMock).toHaveBeenCalledWith({ directory: true, multiple: false });
    expect(onPickWorkspace).toHaveBeenCalledWith("/workspace");

    await userEvent.click(screen.getByRole("button", { name: /skip for now/i }));
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it("exports a venv bundle and blocks broken-environment actions", async () => {
    const setMessage = vi.fn();
    const onClone = vi.fn();
    const onOpenStudio = vi.fn();
    const onSync = vi.fn();
    const onDelete = vi.fn();
    saveDialogMock.mockResolvedValue("/tmp/api.zip");
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "start_export_venv_bundle_job") return "job-export";
      if (command === "cancel_background_job") return true;
      return null;
    });
    waitForBackgroundJobMock.mockImplementation(async (_jobId: string, onUpdate?: (snapshot: { message?: string; progress?: number }) => void) => {
      onUpdate?.({ message: "Packing bundle", progress: 0.5 });
      return "Exported bundle.";
    });

    const { rerender } = render(
      <VenvCard
        venv={{ ...venv, is_outdated: true, template_name: "API: FastAPI Service" }}
        syncing={false}
        onSync={onSync}
        onClone={onClone}
        onOpenStudio={onOpenStudio}
        onDelete={onDelete}
        setMessage={setMessage}
      />
    );

    expect(screen.getByText("Needs Sync")).toBeInTheDocument();
    expect(screen.getByText("80")).toBeInTheDocument();
    expect(screen.getByText("API: FastAPI Service")).toBeInTheDocument();
    expect(screen.getByText(/Refresh metadata before making dependency decisions/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^sync now$/i }));
    expect(onSync).toHaveBeenCalledWith(venv.path);

    await userEvent.click(screen.getByTitle("Export bundle"));
    await waitFor(() => expect(setMessage).toHaveBeenCalledWith("Exported bundle."));
    expect(invokeMock).toHaveBeenCalledWith("start_export_venv_bundle_job", {
      venvPath: venv.path,
      outputPath: "/tmp/api.zip"
    });

    rerender(
      <VenvCard
        venv={{ ...venv, status: "Broken", issue: "Path does not exist" }}
        syncing={false}
        onSync={onSync}
        onClone={onClone}
        onOpenStudio={onOpenStudio}
        onDelete={onDelete}
        setMessage={setMessage}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /remove stale entry/i }));
    expect(screen.getByText(/Path is missing/i)).toBeInTheDocument();
    expect(onDelete).toHaveBeenCalledWith(venv.path);
    await userEvent.click(screen.getByTitle("Cannot clone broken environment"));
    await userEvent.click(screen.getByTitle("Cannot inspect broken environment"));
    expect(onClone).not.toHaveBeenCalled();
    expect(onOpenStudio).not.toHaveBeenCalled();
    expect(setMessage).toHaveBeenCalledWith(expect.stringContaining("Cannot open Studio for api"));
  });

  it("shows import bundle readiness before restoring", async () => {
    const onImported = vi.fn();
    openDialogMock.mockResolvedValue("/tmp/api.zip");
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "read_bundle_manifest") {
        return {
          format_version: 1,
          venv_name: "api",
          python_version: "Python 3.12.4",
          engine: "uv",
          created_at_unix: 1,
          package_count: 12,
          note: null
        };
      }
      if (command === "start_import_venv_bundle_job") return "job-import";
      return null;
    });
    waitForBackgroundJobMock.mockResolvedValue("Imported bundle.");

    render(
      <ImportBundleModal
        workspaces={[{ path: "/workspace", is_default: true }]}
        defaultWorkspace="/workspace"
        systemPythons={["/usr/bin/python3|Python 3.12"]}
        onClose={vi.fn()}
        onImported={onImported}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /pick bundle/i }));
    expect(await screen.findByText("Import readiness")).toBeInTheDocument();
    expect(screen.getByText("12 packages ready to restore")).toBeInTheDocument();
    expect(screen.getByText(/Original engine: uv/i)).toBeInTheDocument();
    expect(screen.getByText("Import plan")).toBeInTheDocument();
    expect(screen.getByText(/Existing source environments are not modified/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^import$/i }));
    expect(invokeMock).toHaveBeenCalledWith("start_import_venv_bundle_job", {
      bundlePath: "/tmp/api.zip",
      targetWorkspace: "/workspace",
      newName: "api",
      pythonBin: "/usr/bin/python3"
    });
    await waitFor(() => expect(onImported).toHaveBeenCalledWith("/workspace"));
  });

  it("explains saved template scope and submits the chosen baseline name", async () => {
    const onSave = vi.fn(async () => undefined);
    render(
      <SaveTemplateModal
        venvName="api"
        saving={false}
        onClose={vi.fn()}
        onSave={onSave}
      />
    );

    expect(screen.getByText("Template scope")).toBeInTheDocument();
    expect(screen.getByText(/does not replace project lockfiles/i)).toBeInTheDocument();

    const input = screen.getByPlaceholderText(/FastAPI service baseline/i);
    await userEvent.clear(input);
    await userEvent.type(input, "Backend baseline");
    await userEvent.click(screen.getByRole("button", { name: /save template/i }));

    expect(onSave).toHaveBeenCalledWith("Backend baseline");
  });

  it("loads, edits and saves structured and raw env config", async () => {
    const setEnvContent = vi.fn();
    const setMessage = vi.fn();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "read_env_entries") {
        return [
          { key: "API_TOKEN", value: "secret", from_example: false },
          { key: "DATABASE_URL", value: "", from_example: true }
        ];
      }
      if (command === "read_env_file") return "API_TOKEN=secret\n";
      if (command === "save_env_entries" || command === "save_env_file") return null;
      return null;
    });

    render(
      <StudioConfig
        venv={venv}
        envContent="API_TOKEN=secret\n"
        setEnvContent={setEnvContent}
        pyvenvCfg="home = /usr/bin"
        setMessage={setMessage}
      />
    );

    await screen.findByDisplayValue("API_TOKEN");
    expect(screen.getByText(/1 variable declared in .env.example is not set yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Fill first: DATABASE_URL/i)).toBeInTheDocument();

    await userEvent.click(screen.getByTitle("Reveal"));
    expect(screen.getByDisplayValue("secret")).toHaveAttribute("type", "text");

    await userEvent.click(screen.getByRole("button", { name: /add variable/i }));
    const keyInputs = screen.getAllByPlaceholderText("KEY");
    const valueInputs = screen.getAllByPlaceholderText(/value|set me/i);
    await userEvent.type(keyInputs[keyInputs.length - 1], "DEBUG");
    await userEvent.type(valueInputs[valueInputs.length - 1], "true");
    await userEvent.click(screen.getByRole("button", { name: /^save .env$/i }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("save_env_entries", expect.objectContaining({
      venvPath: venv.path,
      entries: expect.arrayContaining([expect.objectContaining({ key: "DEBUG", value: "true" })])
    })));

    await userEvent.click(screen.getByRole("button", { name: /raw mode/i }));
    await userEvent.click(screen.getByRole("button", { name: /update project env/i }));
    expect(invokeMock).toHaveBeenCalledWith("save_env_file", {
      venvPath: venv.path,
      content: expect.stringContaining("API_TOKEN=secret")
    });
  });

  it("explains the selected environment in Studio before tab content", async () => {
    const setStudioTab = vi.fn();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "start_get_venv_packages_job") return "job-packages";
      if (command === "start_get_venv_size_job") return "job-size";
      if (command === "start_get_package_sizes_job") return "job-package-sizes";
      return null;
    });
    waitForBackgroundJobMock.mockImplementation(async (jobId: string) => {
      if (jobId === "job-packages") return ["fastapi", "uvicorn", "pytest"];
      if (jobId === "job-size") return 512;
      if (jobId === "job-package-sizes") return {};
      return null;
    });

    render(
      <StudioModal
        selectedVenv={{ ...venv, is_outdated: true }}
        venvDetails={{ packages: ["fastapi", "uvicorn", "pytest"], size_mb: 512 }}
        studioTab="packages"
        setStudioTab={setStudioTab}
        scripts={[]}
        envContent=""
        setEnvContent={vi.fn()}
        pyvenvCfg=""
        onClose={vi.fn()}
        onCompare={vi.fn()}
        onSaveTemplate={vi.fn()}
        reloadStudio={vi.fn()}
        onSync={vi.fn()}
        setMessage={vi.fn()}
      />
    );

    const brief = screen.getByText("Environment Brief").closest("section");
    expect(brief).not.toBeNull();
    expect(within(brief!).getByText("80")).toBeInTheDocument();
    expect(within(brief!).getByText("Needs Sync")).toBeInTheDocument();
    expect(within(brief!).getByText(/External filesystem changes were detected/i)).toBeInTheDocument();
    expect(within(brief!).getByText(/sync the environment metadata/i)).toBeInTheDocument();
    expect(within(brief!).getByText("Maintenance needed")).toBeInTheDocument();
    expect(within(brief!).getByText(/Metadata is stale/i)).toBeInTheDocument();
    expect(within(brief!).getByText("3")).toBeInTheDocument();
    expect(within(brief!).getByText("512.0 MB")).toBeInTheDocument();

    await userEvent.click(within(brief!).getByRole("button", { name: /sync in repair/i }));
    await userEvent.click(within(brief!).getByRole("button", { name: /^diagnose$/i }));
    await userEvent.click(within(brief!).getByRole("button", { name: /^lock$/i }));

    expect(setStudioTab).toHaveBeenCalledWith("repair");
    expect(setStudioTab).toHaveBeenCalledWith("diagnostics");
    expect(setStudioTab).toHaveBeenCalledWith("lock");
  });

  it("explains empty environments as setup or repair candidates", async () => {
    const setStudioTab = vi.fn();
    render(
      <StudioModal
        selectedVenv={{ ...venv, manager_type: "uv" }}
        venvDetails={{ packages: [], size_mb: 0 }}
        studioTab="packages"
        setStudioTab={setStudioTab}
        scripts={[]}
        envContent=""
        setEnvContent={vi.fn()}
        pyvenvCfg=""
        onClose={vi.fn()}
        onCompare={vi.fn()}
        onSaveTemplate={vi.fn()}
        reloadStudio={vi.fn()}
        onSync={vi.fn()}
        setMessage={vi.fn()}
      />
    );

    const brief = screen.getByText("Environment Brief").closest("section");
    expect(brief).not.toBeNull();
    expect(within(brief!).getByText(/No installed packages were detected/i)).toBeInTheDocument();
    expect(within(brief!).getByText(/install dependencies or Repair/i)).toBeInTheDocument();
    expect(within(brief!).getByText("Bootstrap candidate")).toBeInTheDocument();
    await userEvent.click(within(brief!).getByRole("button", { name: /open packages/i }));
    expect(setStudioTab).toHaveBeenCalledWith("packages");
  });

  it("updates the environment explanation after package catalog loads", async () => {
    const packages = Array.from({ length: 33 }, (_, index) => `pkg-${index + 1}==1.0.0`);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "start_get_venv_packages_job") return "job-packages";
      if (command === "start_get_venv_size_job") return "job-size";
      if (command === "start_get_package_sizes_job") return "job-package-sizes";
      return null;
    });
    waitForBackgroundJobMock.mockImplementation(async (jobId: string) => {
      if (jobId === "job-packages") return packages;
      if (jobId === "job-size") return 128;
      if (jobId === "job-package-sizes") return {};
      return null;
    });

    render(
      <StudioModal
        selectedVenv={{ ...venv, manager_type: "uv" }}
        venvDetails={null}
        studioTab="packages"
        setStudioTab={vi.fn()}
        scripts={[]}
        envContent=""
        setEnvContent={vi.fn()}
        pyvenvCfg=""
        onClose={vi.fn()}
        onCompare={vi.fn()}
        onSaveTemplate={vi.fn()}
        reloadStudio={vi.fn()}
        onSync={vi.fn()}
        setMessage={vi.fn()}
      />
    );

    const brief = screen.getByText("Environment Brief").closest("section");
    expect(brief).not.toBeNull();
    expect(await within(brief!).findByText("33")).toBeInTheDocument();
    expect(within(brief!).queryByText(/No installed packages were detected/i)).not.toBeInTheDocument();
    expect(await screen.findByText("pkg-1")).toBeInTheDocument();
    expect(invokeMock.mock.calls.filter(([command]) => command === "start_get_venv_packages_job")).toHaveLength(1);
  });

  it("shows the environment brief only on the packages tab", async () => {
    render(
      <StudioModal
        selectedVenv={venv}
        venvDetails={{ packages: ["fastapi"], size_mb: 128 }}
        studioTab="diagnostics"
        setStudioTab={vi.fn()}
        scripts={[]}
        envContent=""
        setEnvContent={vi.fn()}
        pyvenvCfg=""
        onClose={vi.fn()}
        onCompare={vi.fn()}
        onSaveTemplate={vi.fn()}
        reloadStudio={vi.fn()}
        onSync={vi.fn()}
        setMessage={vi.fn()}
      />
    );

    expect(screen.queryByText("Environment Brief")).not.toBeInTheDocument();
    expect(screen.queryByText("Explain this environment")).not.toBeInTheDocument();
    expect(await screen.findByText("Diagnostics scope")).toBeInTheDocument();
  });

  it("treats Conda and Pixi environments as read-only inventory", async () => {
    const setStudioTab = vi.fn();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "start_get_venv_packages_job") return "job-packages";
      if (command === "start_get_venv_size_job") return "job-size";
      if (command === "start_get_package_sizes_job") return "job-sizes";
      if (command === "cancel_background_job") return true;
      return null;
    });
    waitForBackgroundJobMock.mockImplementation(async (jobId: string) => {
      if (jobId === "job-packages") return ["numpy==2.0.0"];
      if (jobId === "job-size") return 256;
      if (jobId === "job-sizes") return { numpy: 42 };
      return null;
    });
    render(
      <StudioModal
        selectedVenv={{ ...venv, manager_type: "conda" }}
        venvDetails={{ packages: ["numpy==2.0.0"], size_mb: 256 }}
        studioTab="packages"
        setStudioTab={setStudioTab}
        scripts={[]}
        envContent=""
        setEnvContent={vi.fn()}
        pyvenvCfg=""
        onClose={vi.fn()}
        onCompare={vi.fn()}
        onSaveTemplate={vi.fn()}
        reloadStudio={vi.fn()}
        onSync={vi.fn()}
        setMessage={vi.fn()}
      />
    );

    const brief = screen.getByText("Environment Brief").closest("section");
    expect(brief).not.toBeNull();
    expect(within(brief!).getAllByText(/Conda environment detected/i).length).toBeGreaterThan(0);
    expect(within(brief!).getByText("Conda read-only inventory")).toBeInTheDocument();
    expect(await screen.findByText(/Package changes and project sync are read-only/i)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /add package/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /sync project/i })).toBeDisabled();
    expect(screen.getByTitle(/Use the native manager to upgrade packages/i)).toBeDisabled();

    await userEvent.click(within(brief!).getByRole("button", { name: /open packages/i }));
    expect(setStudioTab).toHaveBeenCalledWith("packages");
  });

  it("guides package source selection in the PyPI explorer", async () => {
    render(
      <PyPIExplorer
        venv={venv}
        onClose={vi.fn()}
        onInstalled={vi.fn()}
        setMessage={vi.fn()}
      />
    );

    expect(screen.getByText("Source guidance")).toBeInTheDocument();
    expect(screen.getByText("Best for published packages")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /git/i }));
    expect(screen.getByText("Best for unreleased code")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /local project/i }));
    expect(screen.getByText("Best for local development")).toBeInTheDocument();
  });

  it("explains package hygiene root package decisions", () => {
    render(
      <PackageInsightOverlays
        upgradePreview={null}
        whyReport={null}
        hygieneReport={{
          root_packages: ["django"],
          dependency_packages: ["asgiref", "sqlparse"],
          total_packages: 3
        }}
        onCloseUpgrade={vi.fn()}
        onCloseWhy={vi.fn()}
        onCloseHygiene={vi.fn()}
        onUninstallRootPackage={vi.fn()}
      />
    );

    expect(screen.getByText("Hygiene guidance")).toBeInTheDocument();
    expect(screen.getByText(/Review root packages first/i)).toBeInTheDocument();
    expect(screen.getByText(/2 transitive packages/i)).toBeInTheDocument();
  });

  it("guides upgrade preview and why-installed decisions", () => {
    const { rerender } = render(
      <PackageInsightOverlays
        upgradePreview={{ name: "django", output: "Would install django-5.0\nWould upgrade sqlparse" }}
        whyReport={null}
        hygieneReport={null}
        onCloseUpgrade={vi.fn()}
        onCloseWhy={vi.fn()}
        onCloseHygiene={vi.fn()}
        onUninstallRootPackage={vi.fn()}
      />
    );

    expect(screen.getByText("Upgrade guidance")).toBeInTheDocument();
    expect(screen.getByText("Resolver has a concrete plan")).toBeInTheDocument();
    expect(screen.getByText(/Review added, removed, downgraded, or upgraded packages/i)).toBeInTheDocument();

    rerender(
      <PackageInsightOverlays
        upgradePreview={null}
        whyReport={{ name: "starlette", parents: ["fastapi"] }}
        hygieneReport={null}
        onCloseUpgrade={vi.fn()}
        onCloseWhy={vi.fn()}
        onCloseHygiene={vi.fn()}
        onUninstallRootPackage={vi.fn()}
      />
    );

    expect(screen.getByText("Removal guidance")).toBeInTheDocument();
    expect(screen.getByText(/This is a transitive dependency/i)).toBeInTheDocument();
    expect(screen.getByText("fastapi")).toBeInTheDocument();
  });

  it("guides project tools and deployment order", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "generate_docker_files") {
        return {
          Dockerfile: "FROM python:3.12",
          ".dockerignore": ".venv"
        };
      }
      if (command === "get_vscode_interpreter_status") {
        return {
          settings_path: "/workspace/api/.vscode/settings.json",
          exists: true,
          expected_interpreter: "/workspace/api/.venv/bin/python",
          configured_interpreter: "/workspace/api/.venv/bin/python",
          terminal_activation: true,
          env_file: "${workspaceFolder}/.env",
          in_sync: true,
          issue: null
        };
      }
      return null;
    });

    render(<StudioDeploy venv={venv} setMessage={vi.fn()} />);

    expect(await screen.findByText("Project tools guidance")).toBeInTheDocument();
    expect(await screen.findByText("VS Code Interpreter Doctor")).toBeInTheDocument();
    expect(screen.getAllByText("/workspace/api/.venv/bin/python").length).toBeGreaterThan(0);
    expect(screen.getByText("Pinned to this environment")).toBeInTheDocument();
    expect(screen.getByText("1. Pin IDE")).toBeInTheDocument();
    expect(screen.getByText("2. Save manifests")).toBeInTheDocument();
    expect(screen.getByText("3. Add guardrails")).toBeInTheDocument();
  });

  it("keeps pre-commit setup read-only for native managers", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "generate_docker_files") {
        return {
          Dockerfile: "FROM python:3.12",
          ".dockerignore": ".venv"
        };
      }
      if (command === "get_vscode_interpreter_status") {
        return {
          settings_path: "",
          exists: false,
          expected_interpreter: "",
          configured_interpreter: null,
          terminal_activation: null,
          env_file: null,
          in_sync: false,
          issue: ".vscode/settings.json does not exist yet."
        };
      }
      return null;
    });

    render(<StudioDeploy venv={{ ...venv, manager_type: "pixi" }} setMessage={vi.fn()} />);

    expect(await screen.findByText(/pixi add ipykernel/i)).toBeInTheDocument();
    expect(await screen.findByText(/Pixi environments are read-only in VOrchestra/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /native manager only/i })).toBeDisabled();
    expect(invokeMock).not.toHaveBeenCalledWith("start_install_precommit_hooks_job", expect.anything());
  });

  it("handles missing dependency-tree tooling and retries after install", async () => {
    dependencyPrereqMock.mockResolvedValueOnce({
      ok: false,
      message: "pipdeptree not found. Please install it in the environment to see the dependency tree."
    });
    packageInstallMock.mockResolvedValue("Installed pipdeptree");
    dependencyTreeMock.mockResolvedValue([
      {
        package_name: "fastapi",
        installed_version: "0.115.0",
        dependencies: [{ package_name: "starlette", installed_version: "0.38.0", dependencies: [] }]
      }
    ]);

    render(<StudioDependencyTree venv={pipVenv} />);

    expect(await screen.findByText(/pipdeptree not found/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /install now/i }));
    expect(packageInstallMock).toHaveBeenCalledWith(pipVenv, "pipdeptree");
    expect(await screen.findByText("fastapi")).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText(/search dependency tree/i), "star");
    expect(await screen.findByText("starlette")).toBeInTheDocument();
    expect(screen.getByText("fastapi")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /collapse all/i }));
    expect(screen.getByPlaceholderText(/search dependency tree/i)).toHaveValue("");
    expect(screen.queryByText("starlette")).not.toBeInTheDocument();
  });

  it("explains package manifest view tradeoffs", () => {
    const props = {
      viewMode: "list" as const,
      setViewMode: vi.fn(),
      loadingSizes: false,
      loadingEnvSize: false,
      packageActionActive: false,
      syncingProject: false,
      analyzingHygiene: false,
      onStopScans: vi.fn(),
      onExport: vi.fn(),
      onSyncProject: vi.fn(),
      onHygiene: vi.fn()
    };

    const { rerender } = render(<PackageManifestToolbar {...props} />);
    expect(screen.getByText(/Flat view is fastest/i)).toBeInTheDocument();

    rerender(<PackageManifestToolbar {...props} viewMode="tree" />);
    expect(screen.getByText(/may require pipdeptree or uv tree/i)).toBeInTheDocument();

    rerender(<PackageManifestToolbar {...props} viewMode="graph" />);
    expect(screen.getByText(/visual dependency exploration/i)).toBeInTheDocument();
  });

  it("summarizes dependency graph visibility and hubs", () => {
    const data = [
      {
        package_name: "fastapi",
        installed_version: "1.0.0",
        dependencies: [
          { package_name: "starlette", installed_version: "1.0.0", dependencies: [] },
          { package_name: "pydantic", installed_version: "2.0.0", dependencies: [
            { package_name: "typing-extensions", installed_version: "4.0.0", dependencies: [] }
          ] }
        ]
      },
      {
        package_name: "pytest",
        installed_version: "8.0.0",
        dependencies: []
      }
    ];

    const filtered = [
      {
        package_name: "fastapi",
        installed_version: "1.0.0",
        dependencies: [
          { package_name: "pydantic", installed_version: "2.0.0", dependencies: [] }
        ]
      }
    ];

    expect(summarizeDependencyGraph(data, filtered)).toEqual({
      roots: 2,
      totalNodes: 5,
      visibleNodes: 2,
      hiddenByFilter: 3,
      hubs: [
        { name: "fastapi", dependencyCount: 2 },
        { name: "pydantic", dependencyCount: 1 }
      ]
    });
  });

  it("runs diagnostics and security scan, including missing pip-audit terminal helper", async () => {
    saveDialogMock.mockResolvedValue("/tmp/api-sbom.cdx.json");
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "start_diagnostics_job") return "job-diagnostics";
      if (command === "start_security_audit_job") return "job-security";
      if (command === "start_package_metadata_audit_job") return "job-metadata";
      if (command === "export_package_sbom") return "Wrote CycloneDX SBOM to /tmp/api-sbom.cdx.json";
      if (command === "open_terminal_with_venv_command") return null;
      return null;
    });
    waitForBackgroundJobMock.mockImplementation(async (jobId: string) => {
      if (jobId === "job-diagnostics") {
        return {
          health: "No conflicts found.",
          outdated: [{ name: "django", version: "4.2.0", latest_version: "5.0.0" }]
        };
      }
      if (jobId === "job-security") {
        throw new Error("pip-audit not installed");
      }
      if (jobId === "job-metadata") {
        return {
          total_packages: 3,
          missing_license: ["private-lib"],
          licenses: [{ license: "MIT", count: 2 }],
          suspicious_packages: [
            { name: "reqeusts", reason: "Name resembles the popular package `requests`." }
          ],
          deprecated_packages: [
            { name: "oldlib", reason: "Classifier marks project inactive" }
          ]
        };
      }
      return null;
    });

    render(<StudioDiagnostics venv={venv} />);

    expect(screen.getByText("Diagnostics scope")).toBeInTheDocument();
    expect(screen.getByText(/explicit, cancellable checks/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /run diagnostics/i }));
    expect(await screen.findByText("django")).toBeInTheDocument();
    expect(screen.getByText("5.0.0")).toBeInTheDocument();
    expect(screen.getByText("1 package need update")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /run security scan/i }));
    expect(await screen.findByText(/pip-audit not installed/i)).toBeInTheDocument();
    expect(screen.getByText(/uv pip install --python/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /open install command/i }));
    expect(invokeMock).toHaveBeenCalledWith("open_terminal_with_venv_command", {
      path: venv.path,
      command: expect.stringContaining("pip-audit")
    });

    await userEvent.click(screen.getByRole("button", { name: /run metadata audit/i }));
    expect(await screen.findByText("MIT")).toBeInTheDocument();
    expect(screen.getAllByText("private-lib").length).toBeGreaterThan(0);
    expect(screen.getByText("Package names to review")).toBeInTheDocument();
    expect(screen.getAllByText("reqeusts").length).toBeGreaterThan(0);
    expect(screen.getByText("Deprecated or inactive packages")).toBeInTheDocument();
    expect(screen.getAllByText("oldlib").length).toBeGreaterThan(0);
    const metadataQueue = screen.getByText("Metadata review queue").closest(".rounded-2xl") as HTMLElement | null;
    expect(metadataQueue).not.toBeNull();
    expect(within(metadataQueue!).getByText("3/3 package findings shown")).toBeInTheDocument();
    expect(within(metadataQueue!).getByText(/Verify the package name/i)).toBeInTheDocument();
    await userEvent.selectOptions(within(metadataQueue!).getByLabelText(/filter metadata findings/i), "suspicious");
    expect(within(metadataQueue!).getByText("1/3 package findings shown")).toBeInTheDocument();
    await userEvent.type(within(metadataQueue!).getByPlaceholderText(/search metadata findings/i), "oldlib");
    expect(within(metadataQueue!).getByText("No metadata findings match this filter.")).toBeInTheDocument();
    expect(screen.getByText("Supply-chain action plan")).toBeInTheDocument();
    expect(screen.getByText("Posture score")).toBeInTheDocument();
    expect(screen.getByText("81")).toBeInTheDocument();
    expect(screen.getByText("Needs review")).toBeInTheDocument();
    expect(screen.getByText(/0 advisories, 2 metadata warnings, 1 missing licenses/i)).toBeInTheDocument();
    expect(screen.getByText("Review suspicious package names")).toBeInTheDocument();
    expect(screen.getByText("Plan replacements for deprecated packages")).toBeInTheDocument();
    expect(screen.getByText("Resolve missing license metadata")).toBeInTheDocument();
    expect(screen.getByText("Export CycloneDX SBOM")).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("start_package_metadata_audit_job", { venvPath: venv.path });

    await userEvent.click(screen.getByRole("button", { name: /export sbom/i }));
    expect(invokeMock).toHaveBeenCalledWith("export_package_sbom", {
      venvPath: venv.path,
      outputPath: "/tmp/api-sbom.cdx.json"
    });
    expect(await screen.findByText(/Wrote CycloneDX SBOM/i)).toBeInTheDocument();
  });

  it("keeps missing security tooling read-only for native Conda environments", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "start_security_audit_job") return "job-security";
      return null;
    });
    waitForBackgroundJobMock.mockImplementation(async (jobId: string) => {
      if (jobId === "job-security") {
        throw new Error("pip-audit not installed");
      }
      return null;
    });

    render(<StudioDiagnostics venv={{ ...venv, manager_type: "conda" }} />);

    expect(screen.getByText("Conda native diagnostics")).toBeInTheDocument();
    expect(screen.getByText("conda list")).toBeInTheDocument();
    expect(screen.getByText("conda update --all --dry-run")).toBeInTheDocument();
    expect(screen.getByText("conda env export")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /run security scan/i }));
    expect(await screen.findByText(/Conda environments are read-only in VOrchestra/i)).toBeInTheDocument();
    expect(screen.getByText("conda install -c conda-forge pip-audit")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /install now/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open install command/i })).not.toBeInTheDocument();
    expect(packageInstallMock).not.toHaveBeenCalled();
  });

  it("summarizes security findings by package and fixability", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "start_security_audit_job") return "job-security";
      return null;
    });
    waitForBackgroundJobMock.mockImplementation(async (jobId: string) => {
      if (jobId === "job-security") {
        return {
          dependencies: [
            {
              name: "django",
              version: "4.2.0",
              vulnerabilities: [
                { id: "GHSA-1", description: "Issue A", fix_versions: ["4.2.10"] },
                { id: "GHSA-2", description: "Issue B", fix_versions: [] }
              ]
            }
          ]
        };
      }
      return null;
    });

    render(<StudioDiagnostics venv={venv} />);

    await userEvent.click(screen.getByRole("button", { name: /run security scan/i }));
    expect(await screen.findByText("Security summary")).toBeInTheDocument();
    expect(screen.getByText("2 advisories across 1 package")).toBeInTheDocument();
    expect(screen.getByText(/1 finding lists fixed versions/i)).toBeInTheDocument();
    expect(screen.getByText("Upgrade fixable vulnerable packages first")).toBeInTheDocument();
    expect(screen.getByText("Review advisories without fixed versions")).toBeInTheDocument();
    expect(screen.getByText("2/2 shown")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText(/filter security findings/i), "blocked");
    expect(screen.getByText("1/2 shown")).toBeInTheDocument();
    expect(screen.queryByText("Issue A")).not.toBeInTheDocument();
    expect(screen.getByText("Issue B")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText(/filter security findings/i), "all");
    await userEvent.type(screen.getByPlaceholderText(/search advisories/i), "GHSA-1");
    expect(screen.getByText("1/2 shown")).toBeInTheDocument();
    expect(screen.getByText("Issue A")).toBeInTheDocument();
    expect(screen.queryByText("Issue B")).not.toBeInTheDocument();
  });

  it("runs all diagnostics checks sequentially from one action", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "start_diagnostics_job") return "job-diagnostics";
      if (command === "start_security_audit_job") return "job-security";
      if (command === "start_package_metadata_audit_job") return "job-metadata";
      return null;
    });
    waitForBackgroundJobMock.mockImplementation(async (jobId: string) => {
      if (jobId === "job-diagnostics") {
        return { health: "No conflicts found.", outdated: [] };
      }
      if (jobId === "job-security") {
        return { dependencies: [] };
      }
      if (jobId === "job-metadata") {
        return {
          total_packages: 1,
          missing_license: [],
          licenses: [{ license: "MIT", count: 1 }],
          suspicious_packages: [],
          deprecated_packages: []
        };
      }
      return null;
    });

    render(<StudioDiagnostics venv={venv} />);

    await userEvent.click(screen.getByRole("button", { name: /run all checks/i }));

    expect(await screen.findByText("No conflicts found.")).toBeInTheDocument();
    expect(screen.getByText("No vulnerabilities found")).toBeInTheDocument();
    expect(screen.getByText("MIT")).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("start_diagnostics_job", { venvPath: venv.path });
    expect(invokeMock).toHaveBeenCalledWith("start_security_audit_job", { venvPath: venv.path });
    expect(invokeMock).toHaveBeenCalledWith("start_package_metadata_audit_job", { venvPath: venv.path });
  });

  it("guides repair actions from environment health signals", async () => {
    const setMessage = vi.fn();
    const setStudioTab = vi.fn();
    const onSync = vi.fn(async () => undefined);
    const reloadStudio = vi.fn();
    saveDialogMock.mockResolvedValue("/tmp/api-support.json");
    packageInstallMock.mockResolvedValue("Installed pipdeptree");
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "get_vscode_interpreter_status") {
        return {
          settings_path: "/workspace/api/.vscode/settings.json",
          exists: true,
          expected_interpreter: "/workspace/api/.venv/bin/python",
          configured_interpreter: "/usr/bin/python",
          terminal_activation: false,
          env_file: null,
          in_sync: false,
          issue: "Configured interpreter does not match this environment."
        };
      }
      if (command === "get_rebuild_source_preview") {
        return {
          kind: "uv_lock",
          label: "uv.lock via uv sync",
          path: "/workspace/api/uv.lock",
          package_count: 3,
          note: "Rebuild will run uv sync with this environment as UV_PROJECT_ENVIRONMENT."
        };
      }
      if (command === "start_generate_vscode_config_job") return "job-vscode";
      if (command === "start_rebuild_venv_from_project_job") return "job-rebuild";
      if (command === "start_scan_venv_job") return "job-scan";
      if (command === "open_terminal_activated") return null;
      if (command === "export_support_bundle") return "Wrote sanitized support bundle to /tmp/api-support.json";
      return null;
    });
    waitForBackgroundJobMock.mockImplementation(async (jobId: string) => {
      if (jobId === "job-vscode") return "VS Code config written.";
      if (jobId === "job-rebuild") return { venv_path: venv.path, installed: ["fastapi"] };
      if (jobId === "job-scan") return { ...venv, last_modified: 2 };
      return null;
    });

    render(
      <StudioRepair
        venv={{ ...venv, is_outdated: true }}
        setStudioTab={setStudioTab}
        onSync={onSync}
        reloadStudio={reloadStudio}
        setMessage={setMessage}
      />
    );

    expect(screen.getByText("80/100")).toBeInTheDocument();
    expect(screen.getByText(/External changes detected/i)).toBeInTheDocument();
    expect(screen.getByText(/restores from requirements.lock, uv.lock, requirements.txt/i)).toBeInTheDocument();
    expect(screen.getByText("Recommended sequence")).toBeInTheDocument();
    expect(screen.getByText(/Next: Re-sync environment inventory/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /run next safe action/i })).toBeInTheDocument();
    expect(screen.getByText("Bug report checklist")).toBeInTheDocument();
    expect(screen.getByText(/Attach the support JSON with OS/i)).toBeInTheDocument();
    expect(await screen.findByText("VS Code Interpreter Doctor")).toBeInTheDocument();
    expect(await screen.findByText("Rebuild Source Preview")).toBeInTheDocument();
    expect(screen.getByText("uv.lock via uv sync")).toBeInTheDocument();
    expect(screen.getByText("/workspace/api/uv.lock")).toBeInTheDocument();
    expect(screen.getByText(/UV_PROJECT_ENVIRONMENT/i)).toBeInTheDocument();
    expect(screen.getByText(/Configured interpreter does not match/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /export support bundle/i }));
    expect(invokeMock).toHaveBeenCalledWith("export_support_bundle", {
      venvPath: venv.path,
      outputPath: "/tmp/api-support.json"
    });
    expect(setMessage).toHaveBeenCalledWith("Wrote sanitized support bundle to /tmp/api-support.json");

    await userEvent.click(screen.getByRole("button", { name: /install pipdeptree/i }));
    expect(packageInstallMock).toHaveBeenCalledWith({ ...venv, is_outdated: true }, "pipdeptree");
    expect(setMessage).toHaveBeenCalledWith("pipdeptree installed.");

    await userEvent.click(screen.getByRole("button", { name: /generate config/i }));
    expect(invokeMock).toHaveBeenCalledWith("start_generate_vscode_config_job", { venvPath: venv.path });
    expect(setMessage).toHaveBeenCalledWith("VS Code config written.");

    await userEvent.click(screen.getByRole("button", { name: /rebuild environment/i }));
    expect(invokeMock).toHaveBeenCalledWith("start_rebuild_venv_from_project_job", {
      venvPath: venv.path,
      engine: "uv",
      pythonBin: null
    });
    expect(addSingleVenvMock).toHaveBeenCalledWith("/workspace/api", { ...venv, last_modified: 2 });
    expect(reloadStudio).toHaveBeenCalledWith({ ...venv, last_modified: 2 });

    await userEvent.click(screen.getByRole("button", { name: /open packages/i }));
    expect(setStudioTab).toHaveBeenCalledWith("packages");

    await userEvent.click(screen.getByRole("button", { name: /open lockfile/i }));
    expect(setStudioTab).toHaveBeenCalledWith("lock");

    await userEvent.click(screen.getByRole("button", { name: /open diagnostics/i }));
    expect(setStudioTab).toHaveBeenCalledWith("diagnostics");
  });

  it("cancels long-running repair wizard jobs", async () => {
    const setMessage = vi.fn();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "get_vscode_interpreter_status") {
        return {
          settings_path: "/workspace/api/.vscode/settings.json",
          exists: true,
          expected_interpreter: "/workspace/api/.venv/bin/python",
          configured_interpreter: null,
          terminal_activation: null,
          env_file: null,
          in_sync: false,
          issue: "No python.defaultInterpreterPath configured."
        };
      }
      if (command === "start_rebuild_venv_from_project_job") return "job-rebuild";
      if (command === "cancel_background_job") return true;
      return null;
    });
    waitForBackgroundJobMock.mockImplementation((jobId: string) => {
      if (jobId === "job-rebuild") return new Promise(() => undefined);
      return null;
    });

    const { unmount } = render(
      <StudioRepair
        venv={{ ...venv, status: "Broken", issue: "Python binary not found" }}
        setStudioTab={vi.fn()}
        onSync={vi.fn()}
        reloadStudio={vi.fn()}
        setMessage={setMessage}
      />
    );

    await screen.findByText("VS Code Interpreter Doctor");
    await userEvent.click(screen.getByRole("button", { name: /rebuild environment/i }));
    expect(await screen.findByRole("button", { name: /stop job/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /stop job/i }));
    expect(invokeMock).toHaveBeenCalledWith("cancel_background_job", { jobId: "job-rebuild" });
    expect(setMessage).toHaveBeenCalledWith("Rebuild from project manifests cancellation requested.");
    unmount();
  });

  it("repairs environments with missing pip through ensurepip", async () => {
    const setMessage = vi.fn();
    const reloadStudio = vi.fn();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "get_vscode_interpreter_status") {
        return {
          settings_path: "/workspace/api/.vscode/settings.json",
          exists: false,
          expected_interpreter: "/workspace/api/.venv/bin/python",
          configured_interpreter: null,
          terminal_activation: null,
          env_file: null,
          in_sync: false,
          issue: "No python.defaultInterpreterPath configured."
        };
      }
      if (command === "start_install_pip_in_venv_job") return "job-pip";
      if (command === "start_scan_venv_job") return "job-scan";
      return null;
    });
    waitForBackgroundJobMock.mockImplementation(async (jobId: string) => {
      if (jobId === "job-pip") return "pip 24.0 from site-packages";
      if (jobId === "job-scan") return { ...venv, status: "Healthy", issue: undefined, last_modified: 3 };
      return null;
    });

    render(
      <StudioRepair
        venv={{ ...venv, status: "Broken", issue: "No module named pip" }}
        setStudioTab={vi.fn()}
        onSync={vi.fn()}
        reloadStudio={reloadStudio}
        setMessage={setMessage}
      />
    );

    await screen.findByText("VS Code Interpreter Doctor");
    await userEvent.click(screen.getByRole("button", { name: /^install pip$/i }));
    expect(invokeMock).toHaveBeenCalledWith("start_install_pip_in_venv_job", { venvPath: venv.path });
    expect(updateSingleVenvMock).toHaveBeenCalledWith(venv.path, { ...venv, status: "Healthy", issue: undefined, last_modified: 3 });
    expect(reloadStudio).toHaveBeenCalledWith({ ...venv, status: "Healthy", issue: undefined, last_modified: 3 });
    expect(setMessage).toHaveBeenCalledWith("pip installed and environment metadata refreshed.");
  });

  it("routes read-only manager security repairs to Diagnostics guidance", async () => {
    const setStudioTab = vi.fn();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "get_vscode_interpreter_status") {
        return {
          settings_path: "",
          exists: false,
          expected_interpreter: "",
          configured_interpreter: null,
          terminal_activation: null,
          env_file: null,
          in_sync: false,
          issue: null
        };
      }
      if (command === "get_rebuild_source_preview") {
        return {
          kind: "unknown",
          label: "source unavailable",
          path: "/workspace/api",
          package_count: 0,
          note: null
        };
      }
      return null;
    });

    render(
      <StudioRepair
        venv={{ ...venv, manager_type: "conda" }}
        setStudioTab={setStudioTab}
        onSync={vi.fn()}
        reloadStudio={vi.fn()}
        setMessage={vi.fn()}
      />
    );

    expect(await screen.findByText("Conda native repair instructions")).toBeInTheDocument();
    expect(screen.getByText("conda list")).toBeInTheDocument();
    expect(screen.getByText("conda env export")).toBeInTheDocument();
    expect(screen.getByText("conda update --all --dry-run")).toBeInTheDocument();

    const card = (await screen.findByText("Install security audit tool")).closest("article");
    expect(card).not.toBeNull();
    expect(within(card!).getByText(/Conda environments are read-only/i)).toBeInTheDocument();

    await userEvent.click(within(card!).getByRole("button", { name: /open diagnostics/i }));
    expect(setStudioTab).toHaveBeenCalledWith("diagnostics");
    expect(packageInstallMock).not.toHaveBeenCalled();

    const pipCard = screen.getByText("Install missing pip").closest("article");
    expect(pipCard).not.toBeNull();
    expect(within(pipCard!).getByText(/Use the native manager if pip support is needed/i)).toBeInTheDocument();
    await userEvent.click(within(pipCard!).getByRole("button", { name: /native manager only/i }));
    expect(invokeMock).not.toHaveBeenCalledWith("start_install_pip_in_venv_job", expect.anything());

    const rebuildCard = screen.getByText("Rebuild from project manifests").closest("article");
    expect(rebuildCard).not.toBeNull();
    expect(within(rebuildCard!).getByText(/Recreate or sync them with the native manager/i)).toBeInTheDocument();
    await userEvent.click(within(rebuildCard!).getByRole("button", { name: /native manager only/i }));
    expect(invokeMock).not.toHaveBeenCalledWith("start_rebuild_venv_from_project_job", expect.anything());

    const treeCard = screen.getByText("Install dependency tree tool").closest("article");
    expect(treeCard).not.toBeNull();
    expect(within(treeCard!).getByText(/Open Packages and use the Tree\/Graph views/i)).toBeInTheDocument();
    await userEvent.click(within(treeCard!).getByRole("button", { name: /open packages/i }));
    expect(setStudioTab).toHaveBeenCalledWith("packages");
    expect(packageInstallMock).not.toHaveBeenCalled();
  });

  it("removes stale missing-path entries from the repair wizard", async () => {
    const setMessage = vi.fn();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "get_vscode_interpreter_status") {
        return {
          settings_path: "",
          exists: false,
          expected_interpreter: "",
          configured_interpreter: null,
          terminal_activation: null,
          env_file: null,
          in_sync: false,
          issue: "Environment path is missing."
        };
      }
      return null;
    });

    render(
      <StudioRepair
        venv={{ ...venv, status: "Broken", issue: "Environment path does not exist" }}
        setStudioTab={vi.fn()}
        onSync={vi.fn()}
        reloadStudio={vi.fn()}
        setMessage={setMessage}
      />
    );

    await screen.findByText("VS Code Interpreter Doctor");
    expect(screen.getAllByText(/Removes only the VOrchestra inventory record/i).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: /remove stale entry/i }));

    expect(removeVenvByPathMock).toHaveBeenCalledWith(venv.path);
    expect(setMessage).toHaveBeenCalledWith("Removed stale entry for api.");
  });

  it("runs and cancels saved automation scripts", async () => {
    const setMessage = vi.fn();
    const refreshScripts = vi.fn();
    const scripts: Script[] = [{ id: 1, name: "Nightly sync", command: "python sync.py" }];
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "start_run_venv_script_job") return "job-script";
      if (command === "cancel_background_job") return true;
      return null;
    });
    waitForBackgroundJobMock.mockImplementation((_jobId: string, onUpdate?: (snapshot: { message?: string; progress?: number }) => void) => {
      onUpdate?.({ message: "Running script", progress: 0.25 });
      return new Promise(() => undefined);
    });

    const { unmount } = render(
      <StudioAutomation
        venv={venv}
        scripts={scripts}
        refreshScripts={refreshScripts}
        setMessage={setMessage}
      />
    );

    expect(screen.getByText("Automation scope")).toBeInTheDocument();
    expect(screen.getByText(/Quick tools run inside this environment/i)).toBeInTheDocument();
    expect(screen.getByText(/Prefer idempotent commands/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /run nightly sync/i }));
    expect(await screen.findByText(/Running script 25%/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /stop nightly sync/i }));

    expect(invokeMock).toHaveBeenCalledWith("start_run_venv_script_job", {
      venvPath: venv.path,
      command: "python sync.py"
    });
    expect(invokeMock).toHaveBeenCalledWith("cancel_background_job", { jobId: "job-script" });
    expect(setMessage).not.toHaveBeenCalledWith(expect.stringContaining("Output:"));

    await userEvent.click(screen.getByRole("button", { name: /delete nightly sync/i }));
    expect(screen.getByText("Delete automation?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(deleteScriptMock).toHaveBeenCalledWith(1, venv.path);
    expect(refreshScripts).toHaveBeenCalledOnce();
    expect(setMessage).toHaveBeenCalledWith("Deleted automation Nightly sync.");
    unmount();
  });

  it("summarizes pytest quick tool results", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "start_run_in_venv_job") return "job-pytest";
      return null;
    });
    waitForBackgroundJobMock.mockResolvedValue({
      stdout: "collected 3 items\n\n=== 3 passed, 1 skipped in 0.42s ===",
      stderr: "",
      exit_code: 0,
      success: true,
      tool_missing: false
    });

    render(
      <StudioAutomation
        venv={venv}
        scripts={[]}
        refreshScripts={vi.fn()}
        setMessage={vi.fn()}
      />
    );

    const pytestCard = screen.getByText("Run pytest").closest("div.rounded-2xl") as HTMLElement | null;
    expect(pytestCard).not.toBeNull();
    await userEvent.type(within(pytestCard!).getByPlaceholderText(/args/i), '-k "not slow"');
    await userEvent.click(within(pytestCard!).getByRole("button", { name: /^run$/i }));

    expect(invokeMock).toHaveBeenCalledWith("start_run_in_venv_job", {
      venvPath: venv.path,
      program: "pytest",
      args: ["-k", "not slow"],
      timeoutSecs: 600
    });
    expect(await screen.findByText(/pytest: 3 passed, 1 skipped/i)).toBeInTheDocument();
  });

  it("does not offer quick-tool installs for read-only native managers", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "start_run_in_venv_job") return "job-pytest";
      return null;
    });
    waitForBackgroundJobMock.mockResolvedValue({
      stdout: "",
      stderr: "pytest not found",
      exit_code: 127,
      success: false,
      tool_missing: true
    });

    render(
      <StudioAutomation
        venv={{ ...venv, manager_type: "pixi" }}
        scripts={[]}
        refreshScripts={vi.fn()}
        setMessage={vi.fn()}
      />
    );

    const pytestCard = screen.getByText("Run pytest").closest("div.rounded-2xl") as HTMLElement | null;
    expect(pytestCard).not.toBeNull();
    await userEvent.click(within(pytestCard!).getByRole("button", { name: /^run$/i }));

    expect(await within(pytestCard!).findByText(/Install it with Pixi's native tooling/i)).toBeInTheDocument();
    expect(within(pytestCard!).queryByRole("button", { name: /^install$/i })).not.toBeInTheDocument();
    expect(packageInstallMock).not.toHaveBeenCalled();
  });

  it("summarizes linter and type-check quick tool results", async () => {
    invokeMock.mockImplementation(async (command: string, args?: { program?: string }) => {
      if (command === "start_run_in_venv_job") return `job-${args?.program}`;
      return null;
    });
    waitForBackgroundJobMock.mockImplementation(async (jobId: string) => {
      if (jobId === "job-ruff") {
        return {
          stdout: "Found 2 errors.",
          stderr: "",
          exit_code: 1,
          success: false,
          tool_missing: false
        };
      }
      if (jobId === "job-mypy") {
        return {
          stdout: "Found 1 error in 1 file (checked 8 source files)",
          stderr: "",
          exit_code: 1,
          success: false,
          tool_missing: false
        };
      }
      return {
        stdout: "",
        stderr: "",
        exit_code: 0,
        success: true,
        tool_missing: false
      };
    });

    render(
      <StudioAutomation
        venv={venv}
        scripts={[]}
        refreshScripts={vi.fn()}
        setMessage={vi.fn()}
      />
    );

    const ruffCard = screen.getByText("ruff check").closest("div.rounded-2xl") as HTMLElement | null;
    const mypyCard = screen.getByText("mypy").closest("div.rounded-2xl") as HTMLElement | null;
    expect(ruffCard).not.toBeNull();
    expect(mypyCard).not.toBeNull();

    await userEvent.click(within(ruffCard!).getByRole("button", { name: /^run$/i }));
    expect(await screen.findByText("ruff: 2 issues found")).toBeInTheDocument();

    await userEvent.click(within(mypyCard!).getByRole("button", { name: /^run$/i }));
    expect(await screen.findByText("mypy: 1 error in 1 file")).toBeInTheDocument();
  });

  it("checks lockfile drift and supports restore cancellation", async () => {
    const setMessage = vi.fn();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "start_compute_lockfile_drift_job") return "job-drift";
      if (command === "start_restore_from_lockfile_job") return "job-restore";
      if (command === "cancel_background_job") return true;
      return null;
    });
    waitForBackgroundJobMock.mockImplementation((jobId: string, onUpdate?: (snapshot: { message?: string; progress?: number }) => void) => {
      if (jobId === "job-drift") {
        return Promise.resolve({
          lockfile_path: "/workspace/api/requirements.lock",
          in_sync: false,
          diff_count: 3,
          entries: [
            { name: "django", kind: "different_version", lock_version: "4.2.0", installed_version: "5.0.0" },
            { name: "fastapi", kind: "missing", lock_version: "0.110.0", installed_version: null },
            { name: "ruff", kind: "extra", lock_version: null, installed_version: "0.6.9" }
          ]
        });
      }
      if (jobId === "job-restore") {
        onUpdate?.({ message: "Installing lockfile packages", progress: 0.4 });
        return new Promise<string>((resolve) => {
          globalThis.setTimeout(() => resolve("Restored from lockfile."), 25);
        });
      }
      return Promise.resolve(null);
    });

    render(<StudioLockfile venv={venv} setMessage={setMessage} />);

    expect(screen.getByText("Lockfile workflow")).toBeInTheDocument();
    expect(screen.getByText("Start with a baseline")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /check drift/i }));
    expect(await screen.findByText("django")).toBeInTheDocument();
    expect(screen.getByText("Review drift before restoring")).toBeInTheDocument();
    expect(screen.getByText(/3 packages drifted/i)).toBeInTheDocument();
    expect(screen.getByText("Recommended next action")).toBeInTheDocument();
    expect(screen.getByText(/Restore applies the lockfile/i)).toBeInTheDocument();
    expect(screen.getByText(/1 version drift/i)).toBeInTheDocument();
    expect(screen.getByText("Drift explorer")).toBeInTheDocument();
    expect(screen.getByText("Showing 3 of 3 packages")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^extra$/i }));
    expect(screen.getByText("ruff")).toBeInTheDocument();
    expect(screen.queryByText("django")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 3 packages")).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText("Search drift..."), "django");
    expect(screen.getByText("No drift entries match the current filters.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^all$/i }));
    expect(screen.getByText("django")).toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 3 packages")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^restore$/i }));
    expect(screen.getByText("Restore from lockfile?")).toBeInTheDocument();
    await userEvent.click(within(screen.getByText("Restore from lockfile?").closest(".fixed")!).getByRole("button", { name: /^restore$/i }));
    expect(await screen.findByText(/installing lockfile packages/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /stop job/i }));
    expect(invokeMock).toHaveBeenCalledWith("cancel_background_job", { jobId: "job-restore" });

    await waitFor(() => expect(setMessage).toHaveBeenCalledWith("Restored from lockfile."));
  });

  it("keeps lockfile writes read-only for native managers", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "start_compute_lockfile_drift_job") return "job-drift";
      return null;
    });
    waitForBackgroundJobMock.mockImplementation(async (jobId: string) => {
      if (jobId === "job-drift") {
        return {
          lockfile_path: "/workspace/api/requirements.lock",
          in_sync: false,
          diff_count: 1,
          entries: [
            { name: "numpy", kind: "different_version", lock_version: "2.0.0", installed_version: "1.26.0" }
          ]
        };
      }
      return null;
    });

    render(<StudioLockfile venv={{ ...venv, manager_type: "conda" }} setMessage={vi.fn()} />);

    expect(screen.getByText("Conda read-only lockfile mode")).toBeInTheDocument();
    expect(screen.getByText(/will not generate pip-style lockfiles or restore packages/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /freeze to lockfile/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^restore$/i })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: /check drift/i }));
    expect(await screen.findByText("numpy")).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("start_compute_lockfile_drift_job", {
      venvPath: venv.path,
      engine: "conda",
      lockfilePath: null
    });
    expect(invokeMock).not.toHaveBeenCalledWith("start_generate_lockfile_job", expect.anything());
    expect(invokeMock).not.toHaveBeenCalledWith("start_restore_from_lockfile_job", expect.anything());
  });

  it("renders environment cards in compact grid rows", () => {
    render(
      <div className="flex-1 overflow-y-auto p-8 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 items-start content-start auto-rows-max pb-20">
        {[venv, { ...venv, name: "worker", path: "/workspace/worker/.venv" }].map((item) => (
          <VenvCard
            key={item.path}
            venv={item}
            syncing={false}
            onSync={vi.fn()}
            onClone={vi.fn()}
            onOpenStudio={vi.fn()}
            onDelete={vi.fn()}
            setMessage={vi.fn()}
          />
        ))}
      </div>
    );

    const grid = screen.getByText("api").closest(".grid");
    expect(grid).toHaveClass("content-start");
    expect(grid).toHaveClass("auto-rows-max");
  });
});
