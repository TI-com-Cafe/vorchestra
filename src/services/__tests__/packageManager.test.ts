import { beforeEach, describe, expect, it, vi } from "vitest";
import { PackageManagerService, needsElevation, stripElevationPrefix } from "../packageManager";
import { VenvInfo } from "../../types";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args)
}));

vi.mock("../backgroundJobs", () => ({
  waitForBackgroundJob: vi.fn(async () => "ok")
}));

const venv: VenvInfo = {
  name: "demo",
  path: "/tmp/demo/.venv",
  version: "Python 3.12",
  status: "Healthy",
  issue: undefined,
  last_modified: 1,
  manager_type: "uv"
};

describe("PackageManagerService", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("starts install jobs with the selected environment engine and indexes", async () => {
    invokeMock.mockResolvedValue("job-1");
    const service = new PackageManagerService();

    await expect(service.startInstall(venv, "django", { indexUrl: "https://pypi.org/simple", editable: true })).resolves.toBe("job-1");

    expect(invokeMock).toHaveBeenCalledWith("start_install_dependency_job", {
      venvPath: venv.path,
      package: "django",
      engine: "uv",
      indexUrl: "https://pypi.org/simple",
      extraIndexUrl: null,
      editable: true
    });
  });

  it("blocks package mutations for read-only native managers before invoking backend jobs", async () => {
    const service = new PackageManagerService();
    const condaVenv: VenvInfo = { ...venv, manager_type: "conda" };

    await expect(service.startInstall(condaVenv, "django")).rejects.toThrow(/Conda environments are read-only/i);
    await expect(service.startUninstall(condaVenv, "django")).rejects.toThrow(/Use the native manager to uninstall packages/i);
    await expect(service.startUpdate(condaVenv, "django")).rejects.toThrow(/Use the native manager to update packages/i);
    await expect(service.installElevated(condaVenv, "django")).rejects.toThrow(/Use the native manager to install packages/i);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("detects and strips elevation sentinel", () => {
    expect(needsElevation("NEEDS_ELEVATION: permission denied")).toBe(true);
    expect(stripElevationPrefix("NEEDS_ELEVATION: permission denied")).toBe("permission denied");
  });
});
