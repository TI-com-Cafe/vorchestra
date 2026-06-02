import { Dispatch, SetStateAction, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { dbService } from "../../services/db";
import { ManagerStatus, Template, VenvInfo } from "../../types";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

interface AppInitializationConfig {
  setWorkspaces: StateSetter<{ path: string; is_default: boolean }[]>;
  setActiveWorkspace: StateSetter<string>;
  setVenvCache: StateSetter<Record<string, VenvInfo[]>>;
  setSystemPythons: StateSetter<string[]>;
  setSelectedPython: StateSetter<string>;
  setCustomTemplates: StateSetter<Template[]>;
  setAvailableManagers: StateSetter<ManagerStatus>;
  setSelectedEngine: StateSetter<"pip" | "uv">;
  setIsInitialLoading: StateSetter<boolean>;
}

export function useAppInitialization({
  setWorkspaces,
  setActiveWorkspace,
  setVenvCache,
  setSystemPythons,
  setSelectedPython,
  setCustomTemplates,
  setAvailableManagers,
  setSelectedEngine,
  setIsInitialLoading
}: AppInitializationConfig) {
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const ws = await dbService.getWorkspaces();
        if (cancelled) return;
        setWorkspaces(ws);

        if (ws.length > 0) {
          const def = ws.find((w) => w.is_default) || ws[0];
          if (!cancelled) setActiveWorkspace(def.path);
        }
      } catch (err) {
        console.error("BOOT ERR [workspaces]:", err);
      }

      try {
        const cache = await dbService.getCachedVenvs();
        if (!cancelled) setVenvCache(cache);
      } catch (err) {
        console.error("BOOT ERR [cache]:", err);
      }

      try {
        const py = await invoke<string[]>("list_system_pythons");
        if (!cancelled) {
          setSystemPythons(py);
          if (py.length > 0) setSelectedPython(py[0].split("|")[0]);
        }
      } catch (err) {
        console.error("BOOT ERR [python]:", err);
      }

      try {
        const templates = await dbService.getCustomTemplates();
        if (!cancelled) setCustomTemplates(templates);
      } catch (err) {
        console.error("BOOT ERR [templates]:", err);
      }

      try {
        const mgrs = await invoke<ManagerStatus>("check_managers");
        if (!cancelled && mgrs) {
          setAvailableManagers(mgrs);
          if (mgrs.uv) setSelectedEngine("uv");
        }
      } catch (err) {
        console.error("BOOT ERR [managers]:", err);
      } finally {
        if (!cancelled) setIsInitialLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [
    setWorkspaces,
    setActiveWorkspace,
    setVenvCache,
    setSystemPythons,
    setSelectedPython,
    setCustomTemplates,
    setAvailableManagers,
    setSelectedEngine,
    setIsInitialLoading
  ]);
}
