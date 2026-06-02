import { Dispatch, SetStateAction, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { dbService } from "../../services/db";
import { waitForBackgroundJob } from "../../services/backgroundJobs";
import { VenvInfo } from "../../types";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

type Workspace = { path: string; is_default: boolean };

interface WorkspaceOpsConfig {
  setLoading: StateSetter<boolean>;
  setSyncingVenv: StateSetter<string | null>;
  setMessage: (msg: string) => void;
  setVenvCache: StateSetter<Record<string, VenvInfo[]>>;
}

export function useWorkspaceOperations({
  setLoading,
  setSyncingVenv,
  setMessage,
  setVenvCache
}: WorkspaceOpsConfig) {
  const scanInFlightRef = useRef<Map<string, Promise<void>>>(new Map());
  const scanJobIdsRef = useRef<Map<string, string>>(new Map());
  const scanGenerationRef = useRef<Map<string, number>>(new Map());

  const nextScanGeneration = useCallback((workspacePath: string) => {
    const next = (scanGenerationRef.current.get(workspacePath) ?? 0) + 1;
    scanGenerationRef.current.set(workspacePath, next);
    return next;
  }, []);

  const scanWorkspace = useCallback(async (workspacePath: string) => {
    if (!workspacePath) return;
    const existing = scanInFlightRef.current.get(workspacePath);
    if (existing) return existing;
    const scanGeneration = nextScanGeneration(workspacePath);

    const task = (async () => {
      setLoading(true);
      setMessage("Scanning...");

      try {
        const jobId = await invoke<string>("start_list_venvs_job", { basePath: workspacePath });
        scanJobIdsRef.current.set(workspacePath, jobId);
        const res = await waitForBackgroundJob<VenvInfo[]>(jobId);
        if (scanGenerationRef.current.get(workspacePath) !== scanGeneration) {
          return;
        }
        const stillTracked = (await dbService.getWorkspaces()).some((workspace) => workspace.path === workspacePath);
        if (!stillTracked) {
          setMessage(`Discarded scan result for removed workspace ${workspacePath}.`);
          return;
        }
        await dbService.saveVenvCache(workspacePath, res);
        setVenvCache((prev) => {
          const existingTemplateNames = new Map(
            (prev[workspacePath] ?? []).map((venv) => [venv.path, venv.template_name])
          );
          const merged = res.map((venv) => ({
            ...venv,
            template_name: venv.template_name ?? existingTemplateNames.get(venv.path) ?? null
          }));
          return { ...prev, [workspacePath]: merged };
        });
        setMessage(`${res.length} envs found.`);
      } catch (err) {
        if (scanGenerationRef.current.get(workspacePath) !== scanGeneration) {
          return;
        }
        if (String(err).toLowerCase().includes("cancelled")) {
          setMessage(`Cancelled scan for ${workspacePath}.`);
          return;
        }
        setMessage(`Error: ${err}`);
      } finally {
        if (scanGenerationRef.current.get(workspacePath) === scanGeneration) {
          setLoading(false);
          scanJobIdsRef.current.delete(workspacePath);
          scanInFlightRef.current.delete(workspacePath);
        }
      }
    })();

    scanInFlightRef.current.set(workspacePath, task);
    return task;
  }, [nextScanGeneration, setLoading, setMessage, setVenvCache]);

  const syncSingleVenv = useCallback(async (venvPath: string) => {
    setSyncingVenv(venvPath);
    try {
      const jobId = await invoke<string>("start_scan_venv_job", { path: venvPath });
      const updated = await waitForBackgroundJob<VenvInfo>(jobId, (snapshot) => {
        if (!snapshot.message) return;
        const progress =
          typeof snapshot.progress === "number"
            ? ` ${Math.round(snapshot.progress * 100)}%`
            : "";
        setMessage(`${snapshot.message}${progress}`);
      });
      await dbService.updateSingleVenv(venvPath, updated);
      setVenvCache((prev) => {
        const wsKey = Object.keys(prev).find((ws) => prev[ws].some((v) => v.path === venvPath));
        if (!wsKey) return prev;
        return {
          ...prev,
          [wsKey]: prev[wsKey].map((v) => (
            v.path === venvPath
              ? { ...updated, template_name: updated.template_name ?? v.template_name ?? null }
              : v
          ))
        };
      });
    } catch (err) {
      console.error(err);
    } finally {
      setSyncingVenv(null);
    }
  }, [setSyncingVenv, setVenvCache]);

  const checkSyncStatus = useCallback(async (venvPath: string) => {
    try {
      const actual: number = await invoke("get_venv_mtime", { path: venvPath });
      setVenvCache((prev) => {
        const wsKey = Object.keys(prev).find((ws) => prev[ws].some((v) => v.path === venvPath));
        if (!wsKey) return prev;

        return {
          ...prev,
          [wsKey]: prev[wsKey].map((v) => {
            if (v.path !== venvPath) return v;
            const isOutdated = Math.abs(actual - v.last_modified) > 2;
            return { ...v, is_outdated: isOutdated, actual_mtime: actual, status: "Healthy" };
          })
        };
      });
    } catch {
      setVenvCache((prev) => {
        const wsKey = Object.keys(prev).find((ws) => prev[ws].some((v) => v.path === venvPath));
        if (!wsKey) return prev;
        return {
          ...prev,
          [wsKey]: prev[wsKey].map((v) =>
            v.path === venvPath ? { ...v, status: "Broken", issue: "Folder missing" } : v
          )
        };
      });
    }
  }, [setVenvCache]);

  const cancelWorkspaceScan = useCallback(async (workspacePath: string) => {
    const jobId = scanJobIdsRef.current.get(workspacePath);
    nextScanGeneration(workspacePath);
    scanJobIdsRef.current.delete(workspacePath);
    scanInFlightRef.current.delete(workspacePath);
    setLoading(false);
    if (!jobId) return false;
    return await invoke<boolean>("cancel_background_job", { jobId });
  }, [nextScanGeneration, setLoading]);

  return { scanWorkspace, syncSingleVenv, checkSyncStatus, cancelWorkspaceScan };
}

interface WorkspaceCrudActionsConfig {
  workspaces: Workspace[];
  setWorkspaces: StateSetter<Workspace[]>;
  setActiveWorkspace: StateSetter<string>;
  setVenvCache: StateSetter<Record<string, VenvInfo[]>>;
  setMessage: (msg: string) => void;
  scanWorkspace: (workspacePath: string) => Promise<void>;
  cancelWorkspaceScan?: (workspacePath: string) => Promise<boolean>;
}

export function useWorkspaceCrudActions({
  workspaces,
  setWorkspaces,
  setActiveWorkspace,
  setVenvCache,
  setMessage,
  scanWorkspace,
  cancelWorkspaceScan
}: WorkspaceCrudActionsConfig) {
  const addWorkspace = useCallback(async () => {
    const selected = await open({ directory: true });
    if (!selected) return;
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (path === "/" || /^[A-Za-z]:\\?$/.test(path)) {
      setMessage("Choose a project/workspace folder, not the filesystem root.");
      return;
    }
    if (workspaces.some((w) => w.path === path)) return;

    await dbService.addWorkspace(path);
    setWorkspaces((prev) => (prev.some((w) => w.path === path) ? prev : [...prev, { path, is_default: false }]));
    setActiveWorkspace(path);
    await scanWorkspace(path);
  }, [workspaces, setWorkspaces, setActiveWorkspace, scanWorkspace]);

  const removeWorkspace = useCallback(async (workspacePath: string) => {
    if (!(await ask(`Remove ${workspacePath}?`))) return;
    try {
      await cancelWorkspaceScan?.(workspacePath);
      await dbService.removeWorkspace(workspacePath);
      setWorkspaces((prev) => prev.filter((w) => w.path !== workspacePath));
      setVenvCache((prev) => {
        const next = { ...prev };
        delete next[workspacePath];
        return next;
      });
      setActiveWorkspace((prev) => {
        if (prev !== workspacePath) return prev;
        const nextWorkspace = workspaces.find((w) => w.path !== workspacePath);
        return nextWorkspace?.path ?? "";
      });
      setMessage(`Removed workspace ${workspacePath}.`);
    } catch (err) {
      setMessage(`Failed to remove workspace ${workspacePath}: ${err}`);
    }
  }, [workspaces, setWorkspaces, setActiveWorkspace, setVenvCache, setMessage, cancelWorkspaceScan]);

  const setDefaultWorkspace = useCallback(async (workspacePath: string) => {
    await dbService.setDefaultWorkspace(workspacePath);
    setWorkspaces((prev) => prev.map((w) => ({ ...w, is_default: w.path === workspacePath })));
    setMessage("Default workspace updated.");
  }, [setWorkspaces, setMessage]);

  return { addWorkspace, removeWorkspace, setDefaultWorkspace };
}
