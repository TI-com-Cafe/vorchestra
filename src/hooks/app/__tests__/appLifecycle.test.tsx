import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { useVenvCreation, useVenvDeletion } from "../useVenvLifecycle";
import { useWorkspaceCrudActions, useWorkspaceOperations } from "../useWorkspaceOperations";
import { Template, VenvInfo } from "../../../types";

const invokeMock = vi.fn();
const waitForBackgroundJobMock = vi.fn();
const buildVenvFromTemplateMock = vi.fn();
const addSingleVenvMock = vi.fn();
const updateSingleVenvMock = vi.fn();
const saveVenvCacheMock = vi.fn();
const removeWorkspaceMock = vi.fn();
const removeVenvByPathMock = vi.fn();
const addWorkspaceMock = vi.fn();
const getWorkspacesMock = vi.fn();
const askMock = vi.fn();
const openMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args)
}));

vi.mock("../../../services/backgroundJobs", () => ({
  waitForBackgroundJob: (...args: unknown[]) => waitForBackgroundJobMock(...args)
}));

vi.mock("../../../services/venvBuildJobs", () => ({
  buildVenvFromTemplate: (...args: unknown[]) => buildVenvFromTemplateMock(...args)
}));

vi.mock("../../../services/db", () => ({
  dbService: {
    addWorkspace: (...args: unknown[]) => addWorkspaceMock(...args),
    getWorkspaces: (...args: unknown[]) => getWorkspacesMock(...args),
    addSingleVenv: (...args: unknown[]) => addSingleVenvMock(...args),
    updateSingleVenv: (...args: unknown[]) => updateSingleVenvMock(...args),
    saveVenvCache: (...args: unknown[]) => saveVenvCacheMock(...args),
    removeWorkspace: (...args: unknown[]) => removeWorkspaceMock(...args),
    removeVenvByPath: (...args: unknown[]) => removeVenvByPathMock(...args)
  }
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: (...args: unknown[]) => askMock(...args),
  open: (...args: unknown[]) => openMock(...args)
}));

const template: Template = {
  id: "api",
  name: "API",
  pkgs: ["fastapi"]
};

const venv: VenvInfo = {
  name: "api",
  path: "/workspace/api/.venv",
  version: "Python 3.12",
  status: "Healthy",
  issue: undefined,
  last_modified: 1,
  manager_type: "uv"
};

describe("app lifecycle hooks", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    waitForBackgroundJobMock.mockReset();
    buildVenvFromTemplateMock.mockReset();
    addSingleVenvMock.mockReset();
    updateSingleVenvMock.mockReset();
    saveVenvCacheMock.mockReset();
    removeWorkspaceMock.mockReset();
    removeVenvByPathMock.mockReset();
    addWorkspaceMock.mockReset();
    getWorkspacesMock.mockReset();
    askMock.mockReset();
    openMock.mockReset();
  });

  it("indexes a newly created environment through the scan job", async () => {
    const setLoading = vi.fn();
    const setBuildJobId = vi.fn();
    const setNewVenvName = vi.fn();
    const setMessage = vi.fn();
    const setVenvCache = vi.fn();
    const scanWorkspace = vi.fn();

    buildVenvFromTemplateMock.mockResolvedValue({
      venv_path: venv.path,
      installed: ["fastapi"]
    });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "start_scan_venv_job") return "job-scan";
      return null;
    });
    waitForBackgroundJobMock.mockResolvedValue(venv);

    const { result } = renderHook(() => useVenvCreation({
      activeWorkspace: "/workspace",
      newVenvName: "api",
      selectedPython: "/usr/bin/python3",
      selectedEngine: "uv",
      selectedTemplate: template,
      setLoading,
      setBuildJobId,
      setNewVenvName,
      setMessage,
      setVenvCache,
      scanWorkspace
    }));

    await act(async () => {
      await result.current();
    });

    expect(invokeMock).toHaveBeenCalledWith("start_scan_venv_job", { path: venv.path });
    expect(waitForBackgroundJobMock).toHaveBeenCalledWith("job-scan", expect.any(Function));
    expect(addSingleVenvMock).toHaveBeenCalledWith("/workspace", {
      ...venv,
      template_name: "API"
    });
    expect(scanWorkspace).not.toHaveBeenCalled();
    expect(setMessage).toHaveBeenCalledWith(`Built ${venv.path} (1 packages).`);
  });

  it("syncs a single environment through the scan job", async () => {
    const setLoading = vi.fn();
    const setSyncingVenv = vi.fn();
    const setMessage = vi.fn();
    const setVenvCache = vi.fn();

    invokeMock.mockImplementation(async (command: string) => {
      if (command === "start_scan_venv_job") return "job-scan";
      return null;
    });
    waitForBackgroundJobMock.mockResolvedValue({ ...venv, last_modified: 2 });

    const { result } = renderHook(() => useWorkspaceOperations({
      setLoading,
      setSyncingVenv,
      setMessage,
      setVenvCache
    }));

    await act(async () => {
      await result.current.syncSingleVenv(venv.path);
    });

    expect(setSyncingVenv).toHaveBeenCalledWith(venv.path);
    expect(invokeMock).toHaveBeenCalledWith("start_scan_venv_job", { path: venv.path });
    expect(waitForBackgroundJobMock).toHaveBeenCalledWith("job-scan", expect.any(Function));
    expect(updateSingleVenvMock).toHaveBeenCalledWith(venv.path, expect.objectContaining({ last_modified: 2 }));
    await waitFor(() => expect(setSyncingVenv).toHaveBeenLastCalledWith(null));
  });

  it("cancels workspace scanning before deleting a venv and does not force a rescan", async () => {
    const cancelWorkspaceScan = vi.fn().mockResolvedValue(true);
    const setMessage = vi.fn();
    const setVenvCache = vi.fn();

    askMock.mockResolvedValue(true);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "delete_venv") return "Moved environment to trash.";
      return null;
    });
    removeVenvByPathMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useVenvDeletion({
      activeWorkspace: "/workspace",
      cancelWorkspaceScan,
      setMessage,
      setVenvCache
    }));

    await act(async () => {
      await result.current(venv.path);
    });

    expect(cancelWorkspaceScan).toHaveBeenCalledWith("/workspace");
    expect(invokeMock).toHaveBeenCalledWith("delete_venv", { path: venv.path });
    expect(removeVenvByPathMock).toHaveBeenCalledWith(venv.path);
    expect(setVenvCache.mock.calls[0][0]({ "/workspace": [venv] })).toEqual({ "/workspace": [] });
    expect(setMessage).toHaveBeenCalledWith("Moved environment to trash.");
  });

  it("discards workspace scan results when the workspace was removed mid-scan", async () => {
    const setLoading = vi.fn();
    const setSyncingVenv = vi.fn();
    const setMessage = vi.fn();
    const setVenvCache = vi.fn();

    invokeMock.mockImplementation(async (command: string) => {
      if (command === "start_list_venvs_job") return "job-list";
      return null;
    });
    waitForBackgroundJobMock.mockResolvedValue([venv]);
    getWorkspacesMock.mockResolvedValue([{ path: "/workspace", is_default: true }]);

    const { result } = renderHook(() => useWorkspaceOperations({
      setLoading,
      setSyncingVenv,
      setMessage,
      setVenvCache
    }));

    await act(async () => {
      await result.current.scanWorkspace("/");
    });

    expect(invokeMock).toHaveBeenCalledWith("start_list_venvs_job", { basePath: "/" });
    expect(saveVenvCacheMock).not.toHaveBeenCalled();
    expect(setVenvCache).not.toHaveBeenCalled();
    expect(setMessage).toHaveBeenCalledWith("Discarded scan result for removed workspace /.");
  });

  it("cancels an active workspace scan before removing the workspace", async () => {
    const setLoading = vi.fn();
    const setSyncingVenv = vi.fn();
    const setMessage = vi.fn();
    const setVenvCache = vi.fn();
    const setWorkspaces = vi.fn();
    const setActiveWorkspace = vi.fn();

    let resolveScan: (value: VenvInfo[]) => void = () => undefined;
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "start_list_venvs_job") return "job-root-scan";
      if (command === "cancel_background_job") return true;
      return null;
    });
    waitForBackgroundJobMock.mockImplementation(() => new Promise<VenvInfo[]>((resolve) => {
      resolveScan = resolve;
    }));
    getWorkspacesMock.mockResolvedValue([{ path: "/", is_default: false }]);
    askMock.mockResolvedValue(true);
    removeWorkspaceMock.mockResolvedValue(undefined);

    const ops = renderHook(() => useWorkspaceOperations({
      setLoading,
      setSyncingVenv,
      setMessage,
      setVenvCache
    }));
    const crud = renderHook(() => useWorkspaceCrudActions({
      workspaces: [{ path: "/", is_default: false }],
      setWorkspaces,
      setActiveWorkspace,
      setVenvCache,
      setMessage,
      scanWorkspace: ops.result.current.scanWorkspace,
      cancelWorkspaceScan: ops.result.current.cancelWorkspaceScan
    }));

    let scanPromise: Promise<void> | undefined;
    await act(async () => {
      scanPromise = ops.result.current.scanWorkspace("/");
    });

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("start_list_venvs_job", { basePath: "/" }));

    await act(async () => {
      await crud.result.current.removeWorkspace("/");
    });

    expect(invokeMock).toHaveBeenCalledWith("cancel_background_job", { jobId: "job-root-scan" });
    expect(removeWorkspaceMock).toHaveBeenCalledWith("/");

    await act(async () => {
      resolveScan([venv]);
      await scanPromise;
    });
  });

  it("removes filesystem-root workspace from state and cache", async () => {
    const setWorkspaces = vi.fn();
    const setActiveWorkspace = vi.fn();
    const setVenvCache = vi.fn();
    const setMessage = vi.fn();

    askMock.mockResolvedValue(true);
    removeWorkspaceMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useWorkspaceCrudActions({
      workspaces: [{ path: "/", is_default: false }, { path: "/workspace", is_default: true }],
      setWorkspaces,
      setActiveWorkspace,
      setVenvCache,
      setMessage,
      scanWorkspace: vi.fn()
    }));

    await act(async () => {
      await result.current.removeWorkspace("/");
    });

    expect(removeWorkspaceMock).toHaveBeenCalledWith("/");
    expect(setWorkspaces.mock.calls[0][0]([{ path: "/", is_default: false }, { path: "/workspace", is_default: true }]))
      .toEqual([{ path: "/workspace", is_default: true }]);
    expect(setVenvCache.mock.calls[0][0]({ "/": [venv], "/workspace": [venv] })).toEqual({ "/workspace": [venv] });
    expect(setActiveWorkspace.mock.calls[0][0]("/")).toBe("/workspace");
    expect(setMessage).toHaveBeenCalledWith("Removed workspace /.");
  });

  it("prevents adding filesystem root as a workspace", async () => {
    const setMessage = vi.fn();
    const scanWorkspace = vi.fn();

    openMock.mockResolvedValue("/");

    const { result } = renderHook(() => useWorkspaceCrudActions({
      workspaces: [],
      setWorkspaces: vi.fn(),
      setActiveWorkspace: vi.fn(),
      setVenvCache: vi.fn(),
      setMessage,
      scanWorkspace
    }));

    await act(async () => {
      await result.current.addWorkspace();
    });

    expect(addWorkspaceMock).not.toHaveBeenCalled();
    expect(scanWorkspace).not.toHaveBeenCalled();
    expect(setMessage).toHaveBeenCalledWith("Choose a project/workspace folder, not the filesystem root.");
  });
});
