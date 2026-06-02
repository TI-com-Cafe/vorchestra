import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { summarizeInstallImpact, usePyPIExplorerController } from "../usePyPIExplorerController";
import { useStudioPackagesController } from "../useStudioPackagesController";
import { VenvInfo, VenvDetails } from "../../../types";

const invokeMock = vi.fn();
const openDialogMock = vi.fn();
const waitForBackgroundJobMock = vi.fn();
const installMock = vi.fn();
const installElevatedMock = vi.fn();
const cancelJobMock = vi.fn();
const uninstallMock = vi.fn();
const updateMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args)
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => openDialogMock(...args)
}));

vi.mock("../../../services/backgroundJobs", () => ({
  waitForBackgroundJob: (...args: unknown[]) => waitForBackgroundJobMock(...args)
}));

vi.mock("../../../services/packageManager", () => ({
  packageService: {
    install: (...args: unknown[]) => installMock(...args),
    installElevated: (...args: unknown[]) => installElevatedMock(...args),
    cancelJob: (...args: unknown[]) => cancelJobMock(...args),
    uninstall: (...args: unknown[]) => uninstallMock(...args),
    update: (...args: unknown[]) => updateMock(...args)
  },
  needsElevation: (err: unknown) => String(err).includes("NEEDS_ELEVATION:"),
  stripElevationPrefix: (err: unknown) => String(err).replace("NEEDS_ELEVATION:", "").trim()
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

const details: VenvDetails = {
  size_mb: 3.5,
  packages: ["fastapi==0.115.0"]
};

describe("usePyPIExplorerController", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    openDialogMock.mockReset();
    waitForBackgroundJobMock.mockReset();
    installMock.mockReset();
    installElevatedMock.mockReset();
    cancelJobMock.mockReset();
    uninstallMock.mockReset();
    updateMock.mockReset();
  });

  it("searches PyPI and selects the latest returned version", async () => {
    const setMessage = vi.fn();
    invokeMock.mockResolvedValue("job-search");
    waitForBackgroundJobMock.mockResolvedValue({
      info: { name: "fastapi", version: "0.115.0", summary: "API", home_page: "", author: "" },
      version_list: ["0.115.0", "0.114.0"]
    });
    const { result } = renderHook(() => usePyPIExplorerController({ venv, onInstalled: vi.fn(), setMessage }));

    act(() => result.current.setQuery("fastapi"));
    await act(async () => {
      await result.current.handlePypiSearch({ preventDefault: vi.fn() } as unknown as React.FormEvent);
    });

    expect(invokeMock).toHaveBeenCalledWith("start_search_pypi_job", { query: "fastapi" });
    expect(waitForBackgroundJobMock).toHaveBeenCalledWith("job-search");
    expect(result.current.result?.info.name).toBe("fastapi");
    expect(result.current.selectedVersion).toBe("0.115.0");
  });

  it("summarizes dry-run install impact from resolver output", () => {
    const summary = summarizeInstallImpact(`
Would install anyio-4.8.0 fastapi-0.115.0 starlette-0.45.0
Would uninstall oldlib-1.0.0
Would upgrade pydantic-2.8.0
`);

    expect(summary.installs).toEqual(["anyio-4.8.0", "fastapi-0.115.0", "starlette-0.45.0"]);
    expect(summary.uninstalls).toEqual(["oldlib-1.0.0"]);
    expect(summary.upgrades).toEqual(["pydantic-2.8.0"]);
  });

  it("stores install impact after compatibility dry-run", async () => {
    const setMessage = vi.fn();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "start_search_pypi_job") return "job-search";
      if (command === "start_check_install_conflicts_job") return "job-conflict";
      return "job-unknown";
    });
    waitForBackgroundJobMock.mockImplementation(async (jobId: string) => {
      if (jobId === "job-search") {
        return {
          info: { name: "fastapi", version: "0.115.0", summary: "API", home_page: "", author: "" },
          version_list: ["0.115.0"]
        };
      }
      if (jobId === "job-conflict") return "Would install anyio-4.8.0 fastapi-0.115.0";
      return null;
    });
    const { result } = renderHook(() => usePyPIExplorerController({ venv, onInstalled: vi.fn(), setMessage }));

    act(() => result.current.setQuery("fastapi"));
    await act(async () => {
      await result.current.handlePypiSearch({ preventDefault: vi.fn() } as unknown as React.FormEvent);
    });
    await act(async () => {
      await result.current.checkConflicts();
    });

    expect(result.current.installImpact?.installs).toEqual(["anyio-4.8.0", "fastapi-0.115.0"]);
    expect(result.current.isCompatible).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("start_check_install_conflicts_job", {
      venvPath: venv.path,
      package: "fastapi==0.115.0",
      engine: "uv"
    });
  });

  it("cancels an active PyPI search job", async () => {
    const setMessage = vi.fn();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "start_search_pypi_job") return "job-search";
      if (command === "cancel_background_job") return true;
      return null;
    });
    waitForBackgroundJobMock.mockImplementation(() => new Promise(() => undefined));
    const { result } = renderHook(() => usePyPIExplorerController({ venv, onInstalled: vi.fn(), setMessage }));

    act(() => result.current.setQuery("django"));
    void act(() => {
      void result.current.handlePypiSearch({ preventDefault: vi.fn() } as unknown as React.FormEvent);
    });
    await waitFor(() => expect(result.current.searching).toBe(true));

    await act(async () => {
      await result.current.cancelPypiSearch();
    });

    expect(invokeMock).toHaveBeenCalledWith("cancel_background_job", { jobId: "job-search" });
    expect(result.current.searching).toBe(false);
    expect(result.current.searchError).toBe("Search cancelled.");
  });

  it("normalizes plain git urls before installing", async () => {
    const onInstalled = vi.fn();
    installMock.mockResolvedValue("ok");
    const { result } = renderHook(() => usePyPIExplorerController({ venv, onInstalled, setMessage: vi.fn() }));

    act(() => {
      result.current.setGitUrl("https://github.com/example/pkg.git");
      result.current.setGitRef("main");
      result.current.setGitSubdir("python");
    });
    await act(async () => {
      await result.current.installGit();
    });

    expect(installMock).toHaveBeenCalledWith(
      venv,
      "git+https://github.com/example/pkg.git@main#subdirectory=python",
      {},
      expect.objectContaining({ onJobStarted: expect.any(Function) })
    );
    expect(onInstalled).toHaveBeenCalledOnce();
  });

  it("keeps elevation retry state when install needs admin privileges", async () => {
    const setMessage = vi.fn();
    installMock.mockRejectedValue("NEEDS_ELEVATION: permission denied");
    const { result } = renderHook(() => usePyPIExplorerController({ venv, onInstalled: vi.fn(), setMessage }));

    act(() => result.current.setRawUrl("https://example.com/pkg.whl"));
    await act(async () => {
      await result.current.installUrl();
    });

    expect(result.current.pendingElevation?.pkg).toBe("https://example.com/pkg.whl");
    expect(setMessage).toHaveBeenCalledWith(expect.stringContaining("elevation required"));
  });
});

describe("useStudioPackagesController", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    waitForBackgroundJobMock.mockReset();
    installMock.mockReset();
    cancelJobMock.mockReset();
    uninstallMock.mockReset();
    updateMock.mockReset();
  });

  it("loads package catalog, environment size and package sizes via jobs", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "start_get_venv_packages_job") return "job-packages";
      if (command === "start_get_venv_size_job") return "job-size";
      if (command === "start_get_package_sizes_job") return "job-package-sizes";
      return "job-unknown";
    });
    waitForBackgroundJobMock.mockImplementation(async (jobId: string) => {
      if (jobId === "job-packages") return ["fastapi==0.115.0", "uvicorn==0.30.0"];
      if (jobId === "job-size") return 42.25;
      if (jobId === "job-package-sizes") return { fastapi: 1.5, uvicorn: 0.8 };
      return null;
    });

    const { result } = renderHook(() => useStudioPackagesController({
      venv,
      initialDetails: details,
      refresh: vi.fn(),
      setMessage: vi.fn()
    }));

    await waitFor(() => expect(result.current.localDetails?.packages).toHaveLength(2));
    await waitFor(() => expect(result.current.localDetails?.size_mb).toBe(42.25));
    await waitFor(() => expect(result.current.packageSizes.fastapi).toBe(1.5));

    expect(invokeMock).toHaveBeenCalledWith("start_get_venv_packages_job", { path: venv.path });
    expect(invokeMock).toHaveBeenCalledWith("start_get_venv_size_job", { path: venv.path });
    expect(invokeMock).toHaveBeenCalledWith("start_get_package_sizes_job", { venvPath: venv.path });
  });

  it("starts and cancels project dependency sync through background jobs", async () => {
    const setMessage = vi.fn();
    invokeMock.mockResolvedValue("job-detect");
    waitForBackgroundJobMock.mockResolvedValue({
      project_root: "/workspace/api",
      manifests: [],
      merged_packages: ["fastapi", "uvicorn"]
    });
    installMock.mockImplementation(async (_venv, _pkg, _opts, jobOptions) => {
      jobOptions?.onJobStarted?.("job-install");
      return "ok";
    });

    const { result } = renderHook(() => useStudioPackagesController({
      venv,
      initialDetails: details,
      refresh: vi.fn(),
      setMessage
    }));

    await act(async () => {
      await result.current.syncProjectDeps();
    });

    expect(invokeMock).toHaveBeenCalledWith("start_detect_project_manifests_job", { path: "/workspace/api" });
    expect(installMock).toHaveBeenCalledTimes(2);
    expect(setMessage).toHaveBeenCalledWith("Synced 2 project dependencies.");
  });
});
