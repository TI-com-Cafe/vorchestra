export interface VenvInfo {
  name: string;
  path: string;
  version: string;
  status: string;
  issue?: string;
  last_modified: number;
  manager_type: "pip" | "uv" | "conda" | "pixi";
  template_name?: string | null;
  is_outdated?: boolean;
  actual_mtime?: number;
}

export interface VenvDetails {
  packages: string[];
  size_mb: number;
}

export interface OutdatedPackage {
  name: string;
  version: string;
  latest_version: string;
}

export interface Script {
  id: number;
  name: string;
  command: string;
}

export interface ManagerStatus {
  uv: boolean;
  poetry: boolean;
  pdm: boolean;
  conda: boolean;
  pixi: boolean;
}

export interface PythonVersion {
  version: string;
  key: string;
  installed: boolean;
  path: string | null;
}

export interface ToolRunResult {
  stdout: string;
  stderr: string;
  exit_code: number | null;
  success: boolean;
  tool_missing: boolean;
}

export type ManifestKind =
  | "requirements_txt"
  | "pyproject"
  | "pipfile"
  | "setup_py"
  | "setup_cfg"
  | "conda_environment"
  | "pixi_toml";

export interface ProjectManifest {
  kind: ManifestKind;
  path: string;
  packages: string[];
  note: string | null;
}

export interface ProjectDetection {
  project_root: string;
  manifests: ProjectManifest[];
  merged_packages: string[];
  workspace?: {
    manager: string;
    members: string[];
    excludes: string[];
  } | null;
}

export interface ToastMessage {
  id: number;
  text: string;
  tone: "info" | "success" | "error";
}

export interface Template {
  id: string;
  name: string;
  pkgs: string[];
}

export type ThemeMode = "light" | "dark" | "system";
export type StatusFilter = "All" | "Healthy" | "Broken";
export type StudioTabId = "packages" | "automation" | "config" | "diagnostics" | "lock" | "repair";

export type DriftKind = "in_sync" | "different_version" | "missing" | "extra";

export interface DriftEntry {
  name: string;
  lock_version: string | null;
  installed_version: string | null;
  kind: DriftKind;
}

export interface DriftReport {
  entries: DriftEntry[];
  in_sync: boolean;
  diff_count: number;
  lockfile_path: string;
}

export interface VenvDiffEntry {
  name: string;
  source_version: string | null;
  target_version: string | null;
  kind: DriftKind;
}

export interface VenvDiffReport {
  source_path: string;
  target_path: string;
  entries: VenvDiffEntry[];
  matching: number;
  differing: number;
  only_in_source: number;
  only_in_target: number;
}

export interface VscodeInterpreterStatus {
  settings_path: string;
  exists: boolean;
  expected_interpreter: string;
  configured_interpreter: string | null;
  terminal_activation: boolean | null;
  env_file: string | null;
  in_sync: boolean;
  issue: string | null;
}

export interface CacheEntry {
  name: string;
  path: string;
  size_mb: number;
}

export interface CacheLocation {
  kind: "pip" | "uv" | "uv_per_venv";
  label: string;
  path: string;
  size_mb: number;
  exists: boolean;
  top_entries: CacheEntry[];
}

export interface CacheSummary {
  locations: CacheLocation[];
  total_mb: number;
  duplicate_wheels: DuplicateWheelGroup[];
  venvs: VenvCleanupCandidate[];
  total_venv_mb: number;
}

export interface DuplicateWheelGroup {
  file_name: string;
  copies: number;
  total_mb: number;
  paths: string[];
}

export interface VenvCleanupCandidate {
  name: string;
  path: string;
  size_mb: number;
  exists: boolean;
  last_modified: number;
  days_since_modified: number | null;
  signals: Array<"missing" | "large" | "stale" | "normal" | string>;
}

export interface PackageHygieneReport {
  root_packages: string[];
  dependency_packages: string[];
  total_packages: number;
}

export interface LicenseBucket {
  license: string;
  count: number;
}

export interface PackageMetadataAudit {
  total_packages: number;
  missing_license: string[];
  licenses: LicenseBucket[];
  suspicious_packages?: SuspiciousPackage[];
  deprecated_packages?: DeprecatedPackage[];
  policy?: PolicyDecision;
}

export interface SuspiciousPackage {
  name: string;
  reason: string;
}

export interface DeprecatedPackage {
  name: string;
  reason: string;
}

export interface PolicyFinding {
  severity: "info" | "warning" | "block" | string;
  code: string;
  package_name: string | null;
  message: string;
  evidence: string | null;
}

export interface PolicyDecision {
  enabled: boolean;
  allowed: boolean;
  config_path: string | null;
  findings: PolicyFinding[];
}

export interface ProjectSnapshotInfo {
  id: string;
  reason: string;
  created_at_unix: number;
  project_root: string;
  snapshot_path: string;
  captured_files: string[];
  freeze_file: string | null;
}

export interface LocalAiStatus {
  available: boolean;
  provider: string;
  models: string[];
  error: string | null;
}

export interface BundleManifest {
  format_version: number;
  venv_name: string;
  python_version: string;
  engine: string;
  created_at_unix: number;
  package_count: number;
  note: string | null;
}

export interface EnvEntry {
  key: string;
  value: string;
  from_example: boolean;
}
