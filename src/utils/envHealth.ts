import { VenvInfo } from "../types";
import { isReadOnlyManager, readOnlyManagerLabel } from "./venvManagers";

export type EnvironmentHealthTone = "green" | "amber" | "red";

export interface EnvironmentHealthSignal {
  label: string;
  penalty: number;
}

export interface EnvironmentHealth {
  score: number;
  label: "Healthy" | "Needs Sync" | "Needs Attention" | "Broken";
  tone: EnvironmentHealthTone;
  signals: EnvironmentHealthSignal[];
  primaryAction: "open_studio" | "sync" | "repair" | "delete_stale";
}

const BROKEN_PATH_PATTERNS = [
  "missing",
  "does not exist",
  "not found",
  "no such file",
  "python binary"
];

const MISSING_PIP_PATTERNS = [
  "no module named pip",
  "pip not installed",
  "missing pip",
  "without pip"
];

export function assessEnvironmentHealth(venv: VenvInfo): EnvironmentHealth {
  const signals: EnvironmentHealthSignal[] = [];
  const issue = venv.issue?.toLowerCase() ?? "";
  const version = venv.version.trim().toLowerCase();
  const missingPip = MISSING_PIP_PATTERNS.some(pattern => issue.includes(pattern));
  const readOnly = isReadOnlyManager(venv.manager_type);
  const readOnlyMissingPip = readOnly && missingPip;

  if (venv.status === "Broken" && !readOnlyMissingPip) {
    signals.push({
      label: missingPip ? "pip is missing; install pip before package operations" : (venv.issue || "Environment is broken"),
      penalty: 70
    });
  } else if (readOnlyMissingPip) {
    signals.push({
      label: "pip is missing, but native-manager inventory does not require pip",
      penalty: 0
    });
  }

  if (venv.is_outdated) {
    signals.push({
      label: "External changes detected, sync recommended",
      penalty: 20
    });
  }

  if (venv.manager_type === "pip") {
    signals.push({
      label: "pip-managed environment; uv can improve install speed",
      penalty: 5
    });
  }

  if (readOnly) {
    signals.push({
      label: `${readOnlyManagerLabel(venv.manager_type)} environment detected as read-only inventory`,
      penalty: 0
    });
    signals.push({
      label: "pip-style lockfile restore is disabled; use native lock/sync commands",
      penalty: 0
    });
  }

  if (!version || version === "unknown" || version === "python unknown") {
    signals.push({
      label: "Python runtime version was not detected, scan recommended",
      penalty: 10
    });
  }

  const score = Math.max(0, 100 - signals.reduce((sum, signal) => sum + signal.penalty, 0));
  const missingOnDisk = venv.status === "Broken" && BROKEN_PATH_PATTERNS.some(pattern => issue.includes(pattern));

  if (venv.status === "Broken" && !readOnlyMissingPip) {
    return {
      score,
      label: "Broken",
      tone: "red",
      signals,
      primaryAction: missingOnDisk ? "delete_stale" : "repair"
    };
  }

  if (venv.is_outdated) {
    return {
      score,
      label: "Needs Sync",
      tone: "amber",
      signals,
      primaryAction: "sync"
    };
  }

  if (score <= 90) {
    return {
      score,
      label: "Needs Attention",
      tone: "amber",
      signals,
      primaryAction: "open_studio"
    };
  }

  return {
    score,
    label: "Healthy",
    tone: "green",
    signals,
    primaryAction: "open_studio"
  };
}
