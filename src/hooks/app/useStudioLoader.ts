import { Dispatch, MutableRefObject, SetStateAction, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { dbService } from "../../services/db";
import { Script, StudioTabId, VenvDetails, VenvInfo } from "../../types";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

interface StudioLoaderConfig {
  mountedRef: MutableRefObject<boolean>;
  setSelectedVenv: StateSetter<VenvInfo | null>;
  setStudioTab: StateSetter<StudioTabId | "deploy">;
  setVenvDetails: StateSetter<VenvDetails | null>;
  setScripts: StateSetter<Script[]>;
  setEnvContent: StateSetter<string>;
  setPyvenvCfg: StateSetter<string>;
}

export function useStudioLoader({
  mountedRef,
  setSelectedVenv,
  setStudioTab,
  setVenvDetails,
  setScripts,
  setEnvContent,
  setPyvenvCfg
}: StudioLoaderConfig) {
  const studioLoadIdRef = useRef(0);

  return useCallback(async (venv: VenvInfo) => {
    const loadId = studioLoadIdRef.current + 1;
    studioLoadIdRef.current = loadId;

    setSelectedVenv(venv);
    setStudioTab("packages");
    setVenvDetails(null);

    try {
      dbService.getScripts(venv.path).then((items) => {
        if (!mountedRef.current || studioLoadIdRef.current !== loadId) return;
        setScripts(items);
      });

      invoke<string>("read_env_file", { venvPath: venv.path })
        .then((env) => {
          if (!mountedRef.current || studioLoadIdRef.current !== loadId) return;
          setEnvContent(env);
        })
        .catch((err) => console.error("Env load error:", err));

      invoke<string>("get_pyvenv_cfg", { venvPath: venv.path })
        .then((cfg) => {
          if (!mountedRef.current || studioLoadIdRef.current !== loadId) return;
          setPyvenvCfg(cfg);
        })
        .catch((err) => console.error("pyvenv.cfg load error:", err));
    } catch (err) {
      console.error("BG Load Error:", err);
    }
  }, [mountedRef, setSelectedVenv, setStudioTab, setVenvDetails, setScripts, setEnvContent, setPyvenvCfg]);
}
