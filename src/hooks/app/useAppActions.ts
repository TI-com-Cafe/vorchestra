import type { Dispatch, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";

import { VenvInfo } from "../../types";
import { dbService } from "../../services/db";
import { waitForBackgroundJob } from "../../services/backgroundJobs";
import { buildVenvFromTemplate } from "../../services/venvBuildJobs";

type WorkspaceRow = { path: string; is_default: boolean };
type ManagerStatus = { uv: boolean; poetry: boolean; pdm: boolean; conda: boolean; pixi: boolean };
type Engine = "pip" | "uv";

interface AppActionsParams {
  workspaces: WorkspaceRow[];
  setWorkspaces: Dispatch<SetStateAction<WorkspaceRow[]>>;
  setActiveWorkspace: Dispatch<SetStateAction<string>>;
  setVenvCache: Dispatch<SetStateAction<Record<string, VenvInfo[]>>>;
  setSystemPythons: Dispatch<SetStateAction<string[]>>;
  setSelectedPython: Dispatch<SetStateAction<string>>;
  setAvailableManagers: Dispatch<SetStateAction<ManagerStatus>>;
  setSelectedEngine: Dispatch<SetStateAction<Engine>>;
  setWizardDismissed: Dispatch<SetStateAction<boolean>>;
  setIsUvInstallOpen: Dispatch<SetStateAction<boolean>>;
  setInstallingUv: Dispatch<SetStateAction<boolean>>;
  setUvInstallCmd: Dispatch<SetStateAction<string>>;
  setMessage: (msg: string) => void;
  scanWorkspace: (workspacePath: string) => Promise<void>;
}

interface ProjectBuildArgs {
  projectRoot: string;
  pythonBin: string;
  engine: Engine;
  venvName: string;
  packages: string[];
  onProgress?: (message: string) => void;
  onJobStart?: (jobId: string) => void;
}

export function useAppActions({
  workspaces,
  setWorkspaces,
  setActiveWorkspace,
  setVenvCache,
  setSystemPythons,
  setSelectedPython,
  setAvailableManagers,
  setSelectedEngine,
  setWizardDismissed,
  setIsUvInstallOpen,
  setInstallingUv,
  setUvInstallCmd,
  setMessage,
  scanWorkspace
}: AppActionsParams) {
  const onCancelProjectBuild = async (jobId: string) => {
    await invoke<boolean>("cancel_background_job", { jobId });
    setMessage("Cancelling project build...");
  };

  const onProjectBuild = async ({
    projectRoot,
    pythonBin,
    engine,
    venvName,
    packages,
    onProgress,
    onJobStart
  }: ProjectBuildArgs) => {
    setMessage(`Building venv from ${projectRoot}...`);
    try {
      const result = await buildVenvFromTemplate(
        { path: projectRoot, name: venvName, pythonBin, engine, packages },
        (snapshot) => {
          if (!snapshot.message) return;
          const progress =
            typeof snapshot.progress === "number"
              ? ` ${Math.round(snapshot.progress * 100)}%`
              : "";
          const message = `${snapshot.message}${progress}`;
          onProgress?.(message);
          setMessage(message);
        },
        onJobStart
      );
      setMessage(`Built ${result.venv_path} (${result.installed.length} packages).`);
      if (!workspaces.some(w => w.path === projectRoot)) {
        await dbService.addWorkspace(projectRoot);
        setWorkspaces(prev => [...prev, { path: projectRoot, is_default: false }]);
      }
      setActiveWorkspace(projectRoot);
      await scanWorkspace(projectRoot);
    } catch (err) {
      setMessage(`Error: ${err}`);
      throw err;
    }
  };

  const requestUvInstall = async () => {
    try {
      setUvInstallCmd(await invoke<string>("uv_install_command"));
    } catch {
      setUvInstallCmd("");
    }
    setIsUvInstallOpen(true);
  };

  const onPythonInstalled = async () => {
    const py = await invoke<string[]>("list_system_pythons");
    setSystemPythons(py);
    if (py.length > 0) setSelectedPython(py[0].split("|")[0]);
    setMessage("Python installed and detected.");
  };

  const refreshManagersAfterUvInstall = async (successMessage: string, restartMessage: string) => {
    setMessage(`${successMessage} Re-detecting managers...`);
    const mgrs = await invoke<ManagerStatus>("check_managers");
    setAvailableManagers(mgrs);
    if (mgrs.uv) {
      setSelectedEngine("uv");
      setIsUvInstallOpen(false);
      setMessage("uv ready. Selected as default engine.");
    } else {
      setMessage(restartMessage);
    }
  };

  const onUvInstall = async () => {
    setInstallingUv(true);
    setMessage("Installing uv...");
    try {
      const jobId = await invoke<string>("start_install_uv_job");
      const result = await waitForBackgroundJob<string>(jobId, (snapshot) => {
        if (snapshot.message) setMessage(snapshot.message);
      });
      await refreshManagersAfterUvInstall(result, "uv installed but not yet visible - try restarting VOrchestra.");
    } catch (err) {
      const errStr = String(err);
      if (errStr.includes("NEEDS_ELEVATION:")) {
        setMessage("Permission denied. Use 'Retry as Administrator' to continue.");
      } else {
        setMessage(`uv install failed: ${err}`);
      }
      throw err;
    } finally {
      setInstallingUv(false);
    }
  };

  const onUvInstallElevated = async () => {
    setInstallingUv(true);
    setMessage("Requesting elevation for uv install...");
    try {
      const result = await invoke<string>("install_uv_elevated");
      await refreshManagersAfterUvInstall(result, "Elevated install completed; restart VOrchestra if uv is still not detected.");
    } catch (err) {
      setMessage(`Elevated uv install failed: ${err}`);
    } finally {
      setInstallingUv(false);
    }
  };

  const onFirstRunPickWorkspace = async (path: string) => {
    await dbService.addWorkspace(path);
    setWorkspaces([{ path, is_default: true }]);
    await dbService.setDefaultWorkspace(path);
    setActiveWorkspace(path);
    await scanWorkspace(path);
    setWizardDismissed(true);
  };

  const onHygieneRefresh = async () => {
    setVenvCache(await dbService.getCachedVenvs());
  };

  return {
    onCancelProjectBuild,
    onProjectBuild,
    requestUvInstall,
    onPythonInstalled,
    onUvInstall,
    onUvInstallElevated,
    onFirstRunPickWorkspace,
    onHygieneRefresh
  };
}
