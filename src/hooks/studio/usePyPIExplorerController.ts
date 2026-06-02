import { FormEvent, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import { VenvInfo } from "../../types";
import { packageService, needsElevation, stripElevationPrefix } from "../../services/packageManager";
import { waitForBackgroundJob } from "../../services/backgroundJobs";

export interface PyPIResult {
  info: { name: string; version: string; summary: string; home_page: string; author: string };
  version_list?: string[];
}

export type PyPISourceTab = "pypi" | "git" | "url" | "file" | "project";

type InstallOpts = { indexUrl?: string; extraIndexUrl?: string; editable?: boolean };
export type InstallImpactSummary = {
  installs: string[];
  uninstalls: string[];
  upgrades: string[];
  raw: string;
};

interface UsePyPIExplorerControllerParams {
  venv: VenvInfo;
  onInstalled: () => void;
  setMessage: (msg: string) => void;
}

export const TEST_PYPI_INDEX = "https://test.pypi.org/simple/";
export const isWindows = typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent);

const parseDryRunItems = (raw: string, label: string): string[] => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = raw.match(new RegExp(`(?:^|\\n)\\s*Would ${escaped}\\s+(.+?)(?=\\n\\s*Would |\\n\\s*$|$)`, "is"));
  if (!match) return [];
  return match[1]
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
};

export const summarizeInstallImpact = (raw: string): InstallImpactSummary => ({
  installs: parseDryRunItems(raw, "install"),
  uninstalls: parseDryRunItems(raw, "uninstall"),
  upgrades: [
    ...parseDryRunItems(raw, "upgrade"),
    ...parseDryRunItems(raw, "update")
  ],
  raw
});

export function usePyPIExplorerController({ venv, onInstalled, setMessage }: UsePyPIExplorerControllerParams) {
  const [tab, setTab] = useState<PyPISourceTab>("pypi");
  const [installing, setInstalling] = useState(false);
  const [installingElevated, setInstallingElevated] = useState(false);
  const [pendingElevation, setPendingElevation] = useState<{ pkg: string; opts: InstallOpts } | null>(null);
  const installJobRef = useRef<string | null>(null);

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<PyPIResult | null>(null);
  const [selectedVersion, setSelectedVersion] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [useTestPyPI, setUseTestPyPI] = useState(false);
  const [checkingConflicts, setCheckingConflicts] = useState(false);
  const [conflictReport, setConflictReport] = useState<string | null>(null);
  const [isCompatible, setIsCompatible] = useState<boolean | null>(null);
  const [installImpact, setInstallImpact] = useState<InstallImpactSummary | null>(null);
  const conflictJobRef = useRef<string | null>(null);
  const searchJobRef = useRef<string | null>(null);
  const searchRequestRef = useRef(0);

  const [gitUrl, setGitUrl] = useState("");
  const [gitRef, setGitRef] = useState("");
  const [gitSubdir, setGitSubdir] = useState("");
  const [rawUrl, setRawUrl] = useState("");
  const [filePath, setFilePath] = useState<string | null>(null);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [editable, setEditable] = useState(true);

  useEffect(() => {
    return () => {
      searchRequestRef.current += 1;
    };
  }, []);

  const resetCompatibility = () => {
    setIsCompatible(null);
    setConflictReport(null);
    setInstallImpact(null);
  };

  const runInstall = async (pkg: string, opts: InstallOpts, label: string) => {
    setInstalling(true);
    setPendingElevation(null);
    setMessage(`Installing ${label}...`);
    try {
      await packageService.install(venv, pkg, opts, {
        onJobStarted: (jobId) => { installJobRef.current = jobId; },
        onUpdate: (snapshot) => {
          const lastLog = snapshot.logs?.[snapshot.logs.length - 1];
          if (lastLog) {
            setMessage(lastLog);
            return;
          }
          if (snapshot.message) setMessage(snapshot.message);
        }
      });
      setMessage(`Successfully installed ${label}.`);
      onInstalled();
    } catch (err) {
      if (needsElevation(err)) {
        setPendingElevation({ pkg, opts });
        setMessage(`${label}: permission denied - elevation required.`);
      } else {
        setMessage(`Installation failed: ${err}`);
      }
    } finally {
      installJobRef.current = null;
      setInstalling(false);
    }
  };

  const cancelInstall = async () => {
    const jobId = installJobRef.current;
    if (!jobId) return;
    installJobRef.current = null;
    try {
      await packageService.cancelJob(jobId);
      setMessage("Package installation cancelled.");
    } catch (err) {
      setMessage(`Cancel failed: ${err}`);
    } finally {
      setInstalling(false);
    }
  };

  const runInstallElevated = async () => {
    if (!pendingElevation) return;
    setInstallingElevated(true);
    setMessage(isWindows ? "Requesting administrator privileges..." : "Opening sudo terminal...");
    try {
      const out = await packageService.installElevated(venv, pendingElevation.pkg, pendingElevation.opts);
      setMessage(out);
      setPendingElevation(null);
      onInstalled();
    } catch (err) {
      setMessage(`Elevated install failed: ${stripElevationPrefix(err)}`);
    } finally {
      setInstallingElevated(false);
    }
  };

  const handlePypiSearch = async (e: FormEvent) => {
    e.preventDefault();
    const requestedQuery = query.trim();
    if (!requestedQuery) return;

    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;
    setSearching(true);
    setResult(null);
    setSearchError(null);
    resetCompatibility();

    try {
      const jobId = await invoke<string>("start_search_pypi_job", { query: requestedQuery });
      searchJobRef.current = jobId;
      const data = await waitForBackgroundJob<PyPIResult>(jobId);
      if (searchRequestRef.current !== requestId) return;
      setResult(data);
      setSelectedVersion(data.info.version);
    } catch (err) {
      if (searchRequestRef.current !== requestId) return;
      const message = String(err).includes("Operation cancelled")
        ? "Search cancelled."
        : String(err || `Package not found: ${requestedQuery}`);
      setSearchError(message);
      if (message !== "Search cancelled.") setMessage(message);
    } finally {
      if (searchRequestRef.current === requestId) {
        searchJobRef.current = null;
        setSearching(false);
      }
    }
  };

  const cancelPypiSearch = async () => {
    const jobId = searchJobRef.current;
    searchRequestRef.current += 1;
    searchJobRef.current = null;
    if (jobId) {
      try {
        await invoke<boolean>("cancel_background_job", { jobId });
      } catch (err) {
        setMessage(`Cancel failed: ${err}`);
      }
    }
    setSearching(false);
    setSearchError("Search cancelled.");
  };

  const checkConflicts = async () => {
    if (!result) return;
    setCheckingConflicts(true);
    resetCompatibility();
    const fullPackage = `${result.info.name}==${selectedVersion}`;
    try {
      const jobId = await invoke<string>("start_check_install_conflicts_job", {
        venvPath: venv.path, package: fullPackage, engine: venv.manager_type
      });
      conflictJobRef.current = jobId;
      const report = await waitForBackgroundJob<string>(jobId);
      setConflictReport(report);
      setInstallImpact(summarizeInstallImpact(report));
      const lower = report.toLowerCase();
      setIsCompatible(!(lower.includes("conflict") || lower.includes("error:") || lower.includes("incompatible")));
    } catch (err) {
      setConflictReport(`Check failed: ${err}`);
      setIsCompatible(false);
      setInstallImpact(null);
    } finally {
      conflictJobRef.current = null;
      setCheckingConflicts(false);
    }
  };

  const cancelConflictCheck = async () => {
    const jobId = conflictJobRef.current;
    if (!jobId) return;
    conflictJobRef.current = null;
    try {
      await invoke<boolean>("cancel_background_job", { jobId });
      setConflictReport("Compatibility check cancelled.");
      setIsCompatible(null);
      setInstallImpact(null);
    } catch (err) {
      setMessage(`Cancel failed: ${err}`);
    } finally {
      setCheckingConflicts(false);
    }
  };

  const installPypi = async () => {
    if (!result) return;
    const pkg = `${result.info.name}==${selectedVersion}`;
    const opts: InstallOpts = useTestPyPI ? { indexUrl: TEST_PYPI_INDEX } : {};
    await runInstall(pkg, opts, pkg + (useTestPyPI ? " (Test PyPI)" : ""));
  };

  const installGit = async () => {
    if (!gitUrl.trim()) return;
    let pkg = gitUrl.trim();
    if (!pkg.startsWith("git+") && (pkg.startsWith("http://") || pkg.startsWith("https://") || pkg.startsWith("ssh://") || pkg.startsWith("git@"))) {
      pkg = `git+${pkg}`;
    }
    if (gitRef.trim()) pkg = `${pkg}@${gitRef.trim()}`;
    if (gitSubdir.trim()) pkg = `${pkg}#subdirectory=${gitSubdir.trim()}`;
    await runInstall(pkg, {}, pkg);
  };

  const installUrl = async () => {
    if (!rawUrl.trim()) return;
    await runInstall(rawUrl.trim(), {}, rawUrl.trim());
  };

  const pickFile = async () => {
    const picked = await openDialog({
      multiple: false,
      filters: [{ name: "Python distribution", extensions: ["whl", "tar.gz", "zip"] }]
    });
    if (typeof picked === "string") setFilePath(picked);
  };

  const installFile = async () => {
    if (!filePath) return;
    await runInstall(filePath, {}, filePath.split(/[\\/]/).pop() || filePath);
  };

  const pickProject = async () => {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === "string") setProjectPath(picked);
  };

  const installProject = async () => {
    if (!projectPath) return;
    const label = (editable ? "[editable] " : "") + projectPath;
    await runInstall(projectPath, { editable }, label);
  };

  return {
    tab,
    setTab,
    installing,
    installingElevated,
    pendingElevation,
    query,
    setQuery,
    searching,
    result,
    selectedVersion,
    setSelectedVersion,
    searchError,
    setSearchError,
    useTestPyPI,
    setUseTestPyPI,
    checkingConflicts,
    conflictReport,
    isCompatible,
    installImpact,
    gitUrl,
    setGitUrl,
    gitRef,
    setGitRef,
    gitSubdir,
    setGitSubdir,
    rawUrl,
    setRawUrl,
    filePath,
    projectPath,
    editable,
    setEditable,
    resetCompatibility,
    cancelInstall,
    runInstallElevated,
    handlePypiSearch,
    cancelPypiSearch,
    checkConflicts,
    cancelConflictCheck,
    installPypi,
    installGit,
    installUrl,
    pickFile,
    installFile,
    pickProject,
    installProject
  };
}
