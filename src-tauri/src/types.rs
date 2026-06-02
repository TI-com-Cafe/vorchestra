//! Shared data types and constants exposed across modules.
//!
//! Anything that crosses a module boundary lives here so the helpers and
//! command modules don't need to depend on each other.

use serde::{Deserialize, Serialize};

/// Marker file written into a venv directory by VOrchestra at creation
/// time. Stores the manager engine ("pip" or "uv") so we can prefer the
/// right toolchain on subsequent operations even after the user moves
/// the venv around.
pub const ENGINE_MARKER_FILE: &str = ".vorchestra-engine";

#[derive(Serialize, Deserialize, Clone)]
pub struct VenvInfo {
    pub name: String,
    pub path: String,
    pub version: String,
    pub status: String,
    pub issue: Option<String>,
    pub last_modified: u64,
    pub manager_type: String,
    pub template_name: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct VenvDetails {
    pub packages: Vec<String>,
    pub size_mb: f64,
}

#[derive(Serialize, Deserialize)]
pub struct OutdatedPackage {
    pub name: String,
    pub version: String,
    pub latest_version: String,
}

#[derive(Serialize, Deserialize)]
pub struct VenvSetupResult {
    pub venv_path: String,
    pub installed: Vec<String>,
}

#[derive(Serialize, Deserialize)]
pub struct DependencyTreePrereq {
    pub ok: bool,
    pub message: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct AuditReport {
    /// Paths in DB but not on disk.
    pub broken_links: Vec<String>,
    /// Paths on disk but not in DB.
    pub untracked_venvs: Vec<VenvInfo>,
}

#[derive(Serialize, Deserialize)]
pub struct ManagerStatus {
    pub uv: bool,
    pub poetry: bool,
    pub pdm: bool,
    pub conda: bool,
    pub pixi: bool,
}

/// Per-package result of a venv vs lockfile comparison.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DriftKind {
    InSync,
    DifferentVersion,
    /// Declared in the lockfile but not installed.
    Missing,
    /// Installed but not declared in the lockfile.
    Extra,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DriftEntry {
    pub name: String,
    pub lock_version: Option<String>,
    pub installed_version: Option<String>,
    pub kind: DriftKind,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DriftReport {
    pub entries: Vec<DriftEntry>,
    pub in_sync: bool,
    pub lockfile_path: String,
    pub diff_count: usize,
}

/// Metadata stored at the root of a venv bundle zip so import knows
/// what to recreate.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BundleManifest {
    pub format_version: u32,
    pub venv_name: String,
    pub python_version: String,
    pub engine: String,
    pub created_at_unix: u64,
    pub package_count: usize,
    pub note: Option<String>,
}

/// One entry inside a cache directory (top-level subdirectory or file).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CacheEntry {
    pub name: String,
    pub path: String,
    pub size_mb: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CacheLocation {
    /// "pip", "uv", or "uv_per_venv" (the per-venv .uv-cache dirs we
    /// create for offline-friendly reuse).
    pub kind: String,
    pub label: String,
    pub path: String,
    pub size_mb: f64,
    pub exists: bool,
    pub top_entries: Vec<CacheEntry>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CacheSummary {
    pub locations: Vec<CacheLocation>,
    pub total_mb: f64,
    pub duplicate_wheels: Vec<DuplicateWheelGroup>,
    pub venvs: Vec<VenvCleanupCandidate>,
    pub total_venv_mb: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DuplicateWheelGroup {
    pub file_name: String,
    pub copies: usize,
    pub total_mb: f64,
    pub paths: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct VenvCleanupCandidate {
    pub name: String,
    pub path: String,
    pub size_mb: f64,
    pub exists: bool,
    pub last_modified: u64,
    pub days_since_modified: Option<u64>,
    pub signals: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PackageHygieneReport {
    pub root_packages: Vec<String>,
    pub dependency_packages: Vec<String>,
    pub total_packages: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LicenseBucket {
    pub license: String,
    pub count: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PackageMetadataAudit {
    pub total_packages: usize,
    pub missing_license: Vec<String>,
    pub licenses: Vec<LicenseBucket>,
    pub suspicious_packages: Vec<SuspiciousPackage>,
    pub deprecated_packages: Vec<DeprecatedPackage>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SuspiciousPackage {
    pub name: String,
    pub reason: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DeprecatedPackage {
    pub name: String,
    pub reason: String,
}

/// One row of a venv-to-venv comparison. `DriftKind` is reused with this
/// mapping:
///   * `InSync`            -> both venvs have the same package & version
///   * `DifferentVersion`  -> both have it but versions differ
///   * `Missing`           -> only the *source* (left) has it
///   * `Extra`             -> only the *target* (right) has it
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct VenvDiffEntry {
    pub name: String,
    pub source_version: Option<String>,
    pub target_version: Option<String>,
    pub kind: DriftKind,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct VenvDiffReport {
    pub source_path: String,
    pub target_path: String,
    pub entries: Vec<VenvDiffEntry>,
    pub matching: usize,
    pub differing: usize,
    pub only_in_source: usize,
    pub only_in_target: usize,
}

/// Outcome of `run_in_venv` — captured stdout/stderr plus a hint when the
/// requested tool is not installed in the venv so the frontend can offer
/// to install it.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ToolRunResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub success: bool,
    pub tool_missing: bool,
}

/// One project manifest discovered when autodetecting a folder.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub enum ManifestKind {
    RequirementsTxt,
    Pyproject,
    Pipfile,
    SetupPy,
    SetupCfg,
    CondaEnvironment,
    PixiToml,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProjectManifest {
    pub kind: ManifestKind,
    pub path: String,
    /// Package strings ready to be passed to pip / uv (e.g. "requests>=2.0",
    /// "django==4.2"). May be empty if we found the manifest but could not
    /// confidently extract a list (e.g. setup.py without parsing).
    pub packages: Vec<String>,
    /// Optional contextual notes (e.g. "extracted only required deps,
    /// optional groups present").
    pub note: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProjectDetection {
    /// Absolute path that was scanned.
    pub project_root: String,
    pub manifests: Vec<ProjectManifest>,
    /// Merged, de-duplicated suggestion to feed into create-venv.
    pub merged_packages: Vec<String>,
    /// uv workspace metadata from [tool.uv.workspace], when present.
    pub workspace: Option<ProjectWorkspaceInfo>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProjectWorkspaceInfo {
    pub manager: String,
    pub members: Vec<String>,
    pub excludes: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct PythonVersion {
    /// Bare semver-style version string, e.g. "3.13.0".
    pub version: String,
    /// Canonical id consumable by `uv python install <key>`,
    /// e.g. "cpython-3.13.0".
    pub key: String,
    /// True when uv reports a local install path; false when uv reports
    /// the version is available for download.
    pub installed: bool,
    /// Filesystem path to the python interpreter when installed.
    pub path: Option<String>,
}
