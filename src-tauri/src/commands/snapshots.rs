//! Project snapshots and rollback helpers.
//!
//! A snapshot captures project manifests/lockfiles plus an optional
//! `pip freeze` state before risky operations. Restore puts the project
//! files back and re-installs the frozen package set when available.

use crate::helpers::{
    detect_manager_type, ensure_venv_dir, run_command_with_timeout_cancel_and_output,
    stdout_or_stderr,
};
use crate::jobs::{
    append_job_log, create_background_job, set_job_progress, set_job_status, AppState,
};
use crate::package_managers::manager_for_engine;
use crate::types::ProjectSnapshotInfo;
use crate::venv_freeze::freeze_venv_with_cancel;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

const SNAPSHOT_DIR: &str = ".vorchestra/snapshots";
const MANIFEST_FILE: &str = "snapshot.json";

const CAPTURE_FILES: &[&str] = &[
    "pyproject.toml",
    "uv.lock",
    "requirements.lock",
    "requirements.txt",
    "requirements-dev.txt",
    "constraints.txt",
    "Pipfile",
    "Pipfile.lock",
    "poetry.lock",
    "environment.yml",
    "pixi.toml",
    "pixi.lock",
];

#[derive(Serialize, Deserialize)]
struct SnapshotManifest {
    id: String,
    reason: String,
    created_at_unix: u64,
    project_root: String,
    captured_files: Vec<String>,
    freeze_file: Option<String>,
}

impl SnapshotManifest {
    fn to_info(&self, snapshot_path: &Path) -> ProjectSnapshotInfo {
        ProjectSnapshotInfo {
            id: self.id.clone(),
            reason: self.reason.clone(),
            created_at_unix: self.created_at_unix,
            project_root: self.project_root.clone(),
            snapshot_path: snapshot_path.to_string_lossy().to_string(),
            captured_files: self.captured_files.clone(),
            freeze_file: self.freeze_file.clone(),
        }
    }
}

pub(crate) fn create_snapshot_for_venv_path(
    venv_path: &str,
    engine: &str,
    reason: &str,
    cancel: Option<&std::sync::atomic::AtomicBool>,
) -> Result<ProjectSnapshotInfo, String> {
    let venv = ensure_venv_dir(venv_path)?;
    create_snapshot_for_venv(&venv, engine, reason, cancel)
}

pub(crate) fn create_snapshot_for_venv(
    venv: &Path,
    engine: &str,
    reason: &str,
    cancel: Option<&std::sync::atomic::AtomicBool>,
) -> Result<ProjectSnapshotInfo, String> {
    let project_root = venv
        .parent()
        .ok_or_else(|| "Cannot infer project root for snapshot.".to_string())?;
    let created_at_unix = now_unix();
    let safe_reason = sanitize_id(reason);
    let id = format!("{}-{}", created_at_unix, safe_reason);
    let snapshot_path = project_root.join(SNAPSHOT_DIR).join(&id);
    fs::create_dir_all(&snapshot_path)
        .map_err(|e| format!("Failed to create snapshot directory: {}", e))?;

    let mut captured_files = Vec::new();
    for file in CAPTURE_FILES {
        let source = project_root.join(file);
        if !source.is_file() {
            continue;
        }
        let target = snapshot_path.join(file);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create snapshot subdirectory: {}", e))?;
        }
        fs::copy(&source, &target)
            .map_err(|e| format!("Failed to snapshot {}: {}", source.display(), e))?;
        captured_files.push((*file).to_string());
    }

    let freeze_file = match freeze_venv_with_cancel(venv, engine, cancel) {
        Ok(freeze) if !freeze.trim().is_empty() => {
            let file = "installed.freeze.txt";
            fs::write(snapshot_path.join(file), freeze)
                .map_err(|e| format!("Failed to write freeze snapshot: {}", e))?;
            Some(file.to_string())
        }
        _ => None,
    };

    let manifest = SnapshotManifest {
        id,
        reason: reason.to_string(),
        created_at_unix,
        project_root: project_root.to_string_lossy().to_string(),
        captured_files,
        freeze_file,
    };
    fs::write(
        snapshot_path.join(MANIFEST_FILE),
        serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("Failed to write snapshot manifest: {}", e))?;
    Ok(manifest.to_info(&snapshot_path))
}

#[tauri::command]
pub async fn list_project_snapshots(venv_path: String) -> Result<Vec<ProjectSnapshotInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let venv = ensure_venv_dir(&venv_path)?;
        let project_root = venv
            .parent()
            .ok_or_else(|| "Cannot infer project root for snapshots.".to_string())?;
        list_project_snapshots_for_root(project_root)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn start_create_project_snapshot_job(
    venv_path: String,
    reason: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let (job_id, job) = create_background_job(&state)?;
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            set_job_progress(&blocking_job, "Creating project snapshot...", Some(0.2));
            let venv = ensure_venv_dir(&venv_path)?;
            let engine = detect_manager_type(&venv);
            let info = create_snapshot_for_venv(
                &venv,
                &engine,
                if reason.trim().is_empty() {
                    "manual"
                } else {
                    &reason
                },
                Some(blocking_job.cancel.as_ref()),
            )?;
            set_job_progress(&blocking_job, "Snapshot created.", Some(0.95));
            serde_json::to_value(info).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())
        .and_then(|res| res);

        match outcome {
            Ok(result) => set_job_status(&job, "success", Some(result), None),
            Err(err) if err == "Cancelled by user" => set_job_status(&job, "cancelled", None, None),
            Err(err) => set_job_status(&job, "error", None, Some(err)),
        }
    });
    Ok(job_id)
}

#[tauri::command]
pub fn start_restore_project_snapshot_job(
    venv_path: String,
    snapshot_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let (job_id, job) = create_background_job(&state)?;
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            set_job_progress(&blocking_job, "Preparing snapshot restore...", Some(0.1));
            let venv = ensure_venv_dir(&venv_path)?;
            let engine = detect_manager_type(&venv);
            let project_root = venv
                .parent()
                .ok_or_else(|| "Cannot infer project root for snapshot restore.".to_string())?;
            let snapshot_path = project_root.join(SNAPSHOT_DIR).join(&snapshot_id);
            let manifest = read_snapshot_manifest(&snapshot_path)?;

            for file in &manifest.captured_files {
                let source = snapshot_path.join(file);
                let target = project_root.join(file);
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent)
                        .map_err(|e| format!("Failed to prepare restore target: {}", e))?;
                }
                fs::copy(&source, &target)
                    .map_err(|e| format!("Failed to restore {}: {}", file, e))?;
            }

            if let Some(freeze_file) = &manifest.freeze_file {
                let freeze_path = snapshot_path.join(freeze_file);
                if freeze_path.exists() {
                    set_job_progress(
                        &blocking_job,
                        "Restoring installed package set...",
                        Some(0.45),
                    );
                    let manager = manager_for_engine(&engine)?;
                    let mut cmd = manager
                        .install_requirements_command(&venv, &freeze_path)
                        .to_command();
                    let out = run_command_with_timeout_cancel_and_output(
                        &mut cmd,
                        900,
                        blocking_job.cancel.as_ref(),
                        |stream, line| append_job_log(&blocking_job, stream, line),
                    )?;
                    if !out.status.success() {
                        return Err(format!(
                            "Project files restored, but package restore failed: {}",
                            stdout_or_stderr(&out).trim()
                        ));
                    }
                }
            }

            set_job_progress(&blocking_job, "Snapshot restore finished.", Some(0.95));
            Ok(serde_json::Value::String(format!(
                "Restored snapshot {}.",
                manifest.id
            )))
        })
        .await
        .map_err(|e| e.to_string())
        .and_then(|res| res);

        match outcome {
            Ok(result) => set_job_status(&job, "success", Some(result), None),
            Err(err) if err == "Cancelled by user" => set_job_status(&job, "cancelled", None, None),
            Err(err) => set_job_status(&job, "error", None, Some(err)),
        }
    });
    Ok(job_id)
}

fn list_project_snapshots_for_root(
    project_root: &Path,
) -> Result<Vec<ProjectSnapshotInfo>, String> {
    let root = project_root.join(SNAPSHOT_DIR);
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut snapshots = Vec::new();
    for entry in fs::read_dir(&root).map_err(|e| format!("Failed to read snapshots: {}", e))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if let Ok(manifest) = read_snapshot_manifest(&path) {
            snapshots.push(manifest.to_info(&path));
        }
    }
    snapshots.sort_by(|a, b| b.created_at_unix.cmp(&a.created_at_unix));
    Ok(snapshots)
}

fn read_snapshot_manifest(snapshot_path: &Path) -> Result<SnapshotManifest, String> {
    let raw = fs::read_to_string(snapshot_path.join(MANIFEST_FILE))
        .map_err(|e| format!("Failed to read snapshot manifest: {}", e))?;
    serde_json::from_str(&raw).map_err(|e| format!("Invalid snapshot manifest: {}", e))
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn sanitize_id(value: &str) -> String {
    let mut out = value
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>();
    while out.contains("--") {
        out = out.replace("--", "-");
    }
    out = out.trim_matches('-').to_string();
    if out.is_empty() {
        "snapshot".to_string()
    } else {
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_id_keeps_snapshot_ids_safe() {
        assert_eq!(
            sanitize_id("Before install: Django 5"),
            "before-install-django-5"
        );
        assert_eq!(sanitize_id("  "), "snapshot");
    }
}
