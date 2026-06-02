import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CompareVenvModal, diffActionPlan } from "../CompareVenvModal";
import { ProjectDetectModal } from "../ProjectDetectModal";
import { HygieneOverlay } from "../HygieneOverlay";
import { PythonInstallModal } from "../PythonInstallModal";
import { UvInstallModal } from "../UvInstallModal";
import { CloneVenvModal } from "../CloneVenvModal";
import { VenvInfo } from "../../types";

const invokeMock = vi.fn();
const openDialogMock = vi.fn();
const waitForBackgroundJobMock = vi.fn();
const getCachedVenvsMock = vi.fn();
const removeVenvByPathMock = vi.fn();
const addSingleVenvMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args)
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => openDialogMock(...args)
}));

vi.mock("../../services/backgroundJobs", () => ({
  waitForBackgroundJob: (...args: unknown[]) => waitForBackgroundJobMock(...args)
}));

vi.mock("../../services/db", () => ({
  dbService: {
    getCachedVenvs: (...args: unknown[]) => getCachedVenvsMock(...args),
    removeVenvByPath: (...args: unknown[]) => removeVenvByPathMock(...args),
    addSingleVenv: (...args: unknown[]) => addSingleVenvMock(...args)
  }
}));

const source: VenvInfo = {
  name: "source",
  path: "/ws/source/.venv",
  version: "Python 3.12",
  status: "Healthy",
  issue: undefined,
  last_modified: 1,
  manager_type: "pip"
};

const target: VenvInfo = {
  ...source,
  name: "target",
  path: "/ws/target/.venv",
  manager_type: "uv"
};

describe("critical modal flows", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    openDialogMock.mockReset();
    waitForBackgroundJobMock.mockReset();
    getCachedVenvsMock.mockReset();
    removeVenvByPathMock.mockReset();
    addSingleVenvMock.mockReset();
  });

  it("runs venv comparison and renders diff metrics", async () => {
    invokeMock.mockResolvedValue("job-compare");
    waitForBackgroundJobMock.mockResolvedValue({
      source_path: source.path,
      target_path: target.path,
      matching: 1,
      differing: 1,
      only_in_source: 0,
      only_in_target: 1,
      entries: [
        { name: "django", kind: "different_version", source_version: "4", target_version: "5" },
        { name: "ruff", kind: "extra", source_version: null, target_version: "0.6" }
      ]
    });

    render(<CompareVenvModal source={source} candidates={[target]} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /compare/i }));

    await screen.findByText("django");
    expect(screen.getByText("ruff")).toBeInTheDocument();
    expect(screen.getByText("Comparison guidance")).toBeInTheDocument();
    expect(screen.getByText("Dependency drift needs review")).toBeInTheDocument();
    expect(screen.getByText("Reconciliation plan")).toBeInTheDocument();
    expect(screen.getByText(/Resolve 1 version difference/i)).toBeInTheDocument();
    expect(screen.getByText(/Review 1 target-only package/i)).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("start_diff_venvs_job", {
      sourcePath: source.path,
      targetPath: target.path
    });
  });

  it("builds an actionable diff reconciliation plan", () => {
    expect(diffActionPlan({
      source_path: source.path,
      target_path: target.path,
      matching: 2,
      differing: 0,
      only_in_source: 0,
      only_in_target: 0,
      entries: []
    })).toEqual([
      "No reconciliation is needed; both environments expose the same package set and versions."
    ]);

    expect(diffActionPlan({
      source_path: source.path,
      target_path: target.path,
      matching: 0,
      differing: 2,
      only_in_source: 1,
      only_in_target: 1,
      entries: []
    })).toEqual([
      "Resolve 2 version differences through lockfile or project sync first.",
      "Install or document 1 source-only package on the target if parity is required.",
      "Review 1 target-only package before pruning; they may be intentional tooling.",
      "After changes, rerun Compare to confirm drift is gone."
    ]);
  });

  it("filters venv comparison results by drift kind and package name", async () => {
    invokeMock.mockResolvedValue("job-compare");
    waitForBackgroundJobMock.mockResolvedValue({
      source_path: source.path,
      target_path: target.path,
      matching: 1,
      differing: 1,
      only_in_source: 1,
      only_in_target: 1,
      entries: [
        { name: "django", kind: "different_version", source_version: "4", target_version: "5" },
        { name: "fastapi", kind: "missing", source_version: "0.110", target_version: null },
        { name: "ruff", kind: "extra", source_version: null, target_version: "0.6" },
        { name: "pip", kind: "in_sync", source_version: "24", target_version: "24" }
      ]
    });

    render(<CompareVenvModal source={source} candidates={[target]} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /compare/i }));

    await screen.findByText("Diff explorer");
    expect(screen.getByText("Showing 4 of 4 packages")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /only target/i }));
    expect(screen.getByText("ruff")).toBeInTheDocument();
    expect(screen.queryByText("django")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 4 packages")).toBeInTheDocument();

    await userEvent.clear(screen.getByPlaceholderText(/search package/i));
    await userEvent.type(screen.getByPlaceholderText(/search package/i), "django");
    expect(screen.getByText("No packages match the current diff filters.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^all$/i }));
    expect(screen.getByText("django")).toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 4 packages")).toBeInTheDocument();
  });

  it("detects project manifests and submits editable build options", async () => {
    const onBuild = vi.fn();
    const onClose = vi.fn();
    openDialogMock.mockResolvedValue("/projects/api");
    invokeMock.mockResolvedValue("job-detect");
    waitForBackgroundJobMock.mockResolvedValue({
      project_root: "/projects/api",
      manifests: [
        { kind: "requirements_txt", path: "/projects/api/requirements.txt", packages: ["fastapi"], note: null },
        { kind: "pyproject", path: "/projects/api/pyproject.toml", packages: ["fastapi"], note: null },
        { kind: "conda_environment", path: "/projects/api/environment.yml", packages: ["numpy"], note: "Conda read-only inventory." },
        { kind: "pixi_toml", path: "/projects/api/pixi.toml", packages: ["polars"], note: "Pixi read-only inventory." }
      ],
      merged_packages: ["fastapi"],
      workspace: {
        manager: "uv",
        members: ["packages/*", "apps/api"],
        excludes: []
      }
    });

    render(
      <ProjectDetectModal
        defaultEngine="uv"
        uvAvailable={true}
        systemPythons={["/usr/bin/python3|Python 3.12"]}
        onClose={onClose}
        onBuild={onBuild}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /browse/i }));
    await screen.findByText("requirements.txt");
    expect(screen.getByText("environment.yml")).toBeInTheDocument();
    expect(screen.getByText("pixi.toml")).toBeInTheDocument();
    expect(screen.getAllByText("Read-only")).toHaveLength(2);
    expect(screen.getByText("Build readiness")).toBeInTheDocument();
    expect(screen.getByText("1 installable package ready")).toBeInTheDocument();
    expect(screen.getByText(/2 read-only manifests will be shown as inventory/i)).toBeInTheDocument();
    expect(screen.getByText("Standardization proposal")).toBeInTheDocument();
    expect(screen.getByText("Standardize on uv project workflow")).toBeInTheDocument();
    expect(screen.getByText("Review uv workspace scope")).toBeInTheDocument();
    expect(screen.getByText(/2 workspace member patterns detected/i)).toBeInTheDocument();
    expect(screen.getByText("Keep Conda/Pixi as read-only inventory")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /build venv from project/i }));

    await waitFor(() => expect(onBuild).toHaveBeenCalledOnce());
    expect(onBuild).toHaveBeenCalledWith(expect.objectContaining({
      projectRoot: "/projects/api",
      engine: "uv",
      venvName: "api-venv",
      packages: ["fastapi"]
    }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows hygiene results and can prune broken database entries", async () => {
    const onRefresh = vi.fn();
    const setMessage = vi.fn();
    getCachedVenvsMock.mockResolvedValue({ "/ws": [source] });
    invokeMock.mockResolvedValue("job-audit");
    waitForBackgroundJobMock
      .mockResolvedValueOnce({ broken_links: [source.path], untracked_venvs: [] })
      .mockResolvedValueOnce({ broken_links: [], untracked_venvs: [] });

    render(
      <HygieneOverlay
        workspaces={["/ws"]}
        onRefresh={onRefresh}
        setMessage={setMessage}
        onClose={vi.fn()}
      />
    );

    await screen.findByText(source.path);
    expect(screen.getByText("Hygiene plan")).toBeInTheDocument();
    expect(screen.getByText(/Prune 1 ghost entry first/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /prune/i }));

    await waitFor(() => expect(removeVenvByPathMock).toHaveBeenCalledWith(source.path));
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(setMessage).toHaveBeenCalledWith("Dead link pruned from database.");
  });

  it("cancels an active Python install job", async () => {
    const onInstalled = vi.fn();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "start_list_python_versions_job") return "job-list";
      if (command === "start_install_python_job") return "job-install";
      if (command === "cancel_background_job") return true;
      return null;
    });
    waitForBackgroundJobMock.mockImplementation((jobId: string, onUpdate?: (snapshot: { message?: string; progress?: number }) => void) => {
      if (jobId === "job-list") {
        return Promise.resolve([
          { key: "cpython-3.13", version: "3.13.1", installed: false, path: null }
        ]);
      }
      if (jobId === "job-install") {
        onUpdate?.({ message: "Installing Python 3.13.1", progress: 0.3 });
        return new Promise(() => undefined);
      }
      return Promise.resolve(null);
    });

    const { unmount } = render(
      <PythonInstallModal
        uvAvailable={true}
        onClose={vi.fn()}
        onInstalled={onInstalled}
        onRequestUvInstall={vi.fn()}
      />
    );

    await userEvent.click(await screen.findByRole("button", { name: /^install$/i }));
    expect(await screen.findByText(/Installing Python 3.13.1 30%/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /stop install/i }));

    expect(invokeMock).toHaveBeenCalledWith("cancel_background_job", { jobId: "job-install" });
    expect(onInstalled).not.toHaveBeenCalled();
    unmount();
  });

  it("explains runtime and uv install impact before expensive actions", async () => {
    invokeMock.mockResolvedValue("job-list");
    waitForBackgroundJobMock.mockResolvedValue([
      { key: "cpython-3.12", version: "3.12.9", installed: true, path: "/home/user/.local/share/uv/python/3.12" },
      { key: "cpython-3.13", version: "3.13.1", installed: false, path: null }
    ]);

    const { unmount } = render(
      <PythonInstallModal
        uvAvailable={true}
        onClose={vi.fn()}
        onInstalled={vi.fn()}
        onRequestUvInstall={vi.fn()}
      />
    );

    expect(screen.getByText("Runtime guidance")).toBeInTheDocument();
    expect(await screen.findByText(/1 installed runtime and 1 downloadable runtime found/i)).toBeInTheDocument();
    unmount();

    render(
      <UvInstallModal
        command="curl -LsSf https://astral.sh/uv/install.sh | sh"
        installing={false}
        onClose={vi.fn()}
        onInstall={vi.fn()}
        onInstallElevated={vi.fn()}
      />
    );

    expect(screen.getByText("Install impact")).toBeInTheDocument();
    expect(screen.getByText(/managed Python downloads/i)).toBeInTheDocument();
  });

  it("explains clone strategy and updates it when packages are excluded", async () => {
    render(
      <CloneVenvModal
        source={source}
        workspaces={[{ path: "/ws", is_default: true }]}
        defaultWorkspace="/ws"
        onClose={vi.fn()}
        onCloned={vi.fn()}
      />
    );

    expect(screen.getByText("Clone plan")).toBeInTheDocument();
    expect(screen.getByText(/re-install packages from the source/i)).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText(/re-install all packages/i));
    expect(screen.getByText(/create an empty environment/i)).toBeInTheDocument();
  });
});
