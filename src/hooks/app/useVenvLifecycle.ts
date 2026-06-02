import { Dispatch, SetStateAction, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { dbService } from "../../services/db";
import { buildVenvFromTemplate } from "../../services/venvBuildJobs";
import { waitForBackgroundJob } from "../../services/backgroundJobs";
import { Template, VenvDetails, VenvInfo } from "../../types";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

interface VenvCreationConfig {
  activeWorkspace: string;
  newVenvName: string;
  selectedPython: string;
  selectedEngine: "pip" | "uv";
  selectedTemplate: Template;
  setLoading: StateSetter<boolean>;
  setBuildJobId: StateSetter<string | null>;
  setNewVenvName: StateSetter<string>;
  setMessage: (msg: string) => void;
  setVenvCache: StateSetter<Record<string, VenvInfo[]>>;
  scanWorkspace: (workspacePath: string) => Promise<void>;
}

export function useVenvCreation({
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
}: VenvCreationConfig) {
  return useCallback(async () => {
    if (!newVenvName || !activeWorkspace) return;
    setLoading(true);
    setMessage(`Building ${newVenvName}...`);
    try {
      const result = await buildVenvFromTemplate({
        path: activeWorkspace,
        name: newVenvName,
        pythonBin: selectedPython,
        engine: selectedEngine,
        packages: selectedTemplate.pkgs
      }, (snapshot) => {
        if (!snapshot.message) return;
        const progress =
          typeof snapshot.progress === "number"
            ? ` ${Math.round(snapshot.progress * 100)}%`
            : "";
        setMessage(`${snapshot.message}${progress}`);
      }, setBuildJobId);
      setNewVenvName("");
      try {
        const scanJobId = await invoke<string>("start_scan_venv_job", { path: result.venv_path });
        const created = await waitForBackgroundJob<VenvInfo>(scanJobId, (snapshot) => {
          if (!snapshot.message) return;
          const progress =
            typeof snapshot.progress === "number"
              ? ` ${Math.round(snapshot.progress * 100)}%`
              : "";
          setMessage(`${snapshot.message}${progress}`);
        });
        const createdWithTemplate: VenvInfo = {
          ...created,
          template_name: selectedTemplate.id === "none" ? null : selectedTemplate.name
        };
        await dbService.addSingleVenv(activeWorkspace, createdWithTemplate);
        setVenvCache((prev) => {
          const current = prev[activeWorkspace] ?? [];
          const withoutDuplicate = current.filter((venv) => venv.path !== createdWithTemplate.path);
          return { ...prev, [activeWorkspace]: [...withoutDuplicate, createdWithTemplate] };
        });
      } catch (scanErr) {
        console.warn("Created venv could not be indexed directly; falling back to workspace scan.", scanErr);
        await scanWorkspace(activeWorkspace);
      }
      setMessage(`Built ${result.venv_path} (${result.installed.length} packages).`);
    } catch (err) {
      setMessage(`Error: ${err}`);
    } finally {
      setLoading(false);
      setBuildJobId(null);
    }
  }, [
    newVenvName,
    activeWorkspace,
    selectedPython,
    selectedEngine,
    selectedTemplate,
    setLoading,
    setBuildJobId,
    setNewVenvName,
    setMessage,
    setVenvCache,
    scanWorkspace
  ]);
}

interface VenvDeletionConfig {
  activeWorkspace: string;
  cancelWorkspaceScan?: (workspacePath: string) => Promise<boolean>;
  setMessage: (msg: string) => void;
  setVenvCache: StateSetter<Record<string, VenvInfo[]>>;
}

export function useVenvDeletion({ activeWorkspace, cancelWorkspaceScan, setMessage, setVenvCache }: VenvDeletionConfig) {
  return useCallback(async (venvPath: string) => {
    if (!(await ask("Move the environment folder to recoverable VOrchestra trash? If the folder is already missing, only the stale entry will be removed."))) return;
    try {
      if (activeWorkspace) {
        await cancelWorkspaceScan?.(activeWorkspace);
      }
      const result = await invoke<string>("delete_venv", { path: venvPath });
      await dbService.removeVenvByPath(venvPath);
      setVenvCache((prev) => {
        const next = { ...prev };
        for (const workspace of Object.keys(next)) {
          next[workspace] = next[workspace].filter((venv) => venv.path !== venvPath);
        }
        return next;
      });
      setMessage(result);
    } catch (err) {
      setMessage(`Error: ${err}`);
    }
  }, [activeWorkspace, cancelWorkspaceScan, setMessage, setVenvCache]);
}

interface SaveTemplateConfig {
  selectedVenv: VenvInfo | null;
  venvDetails: VenvDetails | null;
  setVenvDetails: StateSetter<VenvDetails | null>;
  setCustomTemplates: StateSetter<Template[]>;
  setMessage: (msg: string) => void;
}

export function useSaveTemplate({
  selectedVenv,
  venvDetails,
  setVenvDetails,
  setCustomTemplates,
  setMessage
}: SaveTemplateConfig) {
  return useCallback(async (templateName: string) => {
    if (!templateName || !selectedVenv) return;
    try {
      let packages = venvDetails?.packages;
      if (!packages) {
        const jobId = await invoke<string>("start_get_venv_packages_job", { path: selectedVenv.path });
        packages = await waitForBackgroundJob<string[]>(jobId);
      }
      setVenvDetails((prev) => ({
        size_mb: prev?.size_mb ?? venvDetails?.size_mb ?? 0,
        packages
      }));
      await dbService.saveCustomTemplate(templateName, packages.map((p) => p.split("==")[0]));
      setCustomTemplates(await dbService.getCustomTemplates());
      setMessage(`Saved template: ${templateName}`);
    } catch (err) {
      setMessage(`Error: ${err}`);
    }
  }, [selectedVenv, venvDetails, setVenvDetails, setCustomTemplates, setMessage]);
}
