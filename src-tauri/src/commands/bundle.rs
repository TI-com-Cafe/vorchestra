//! Export / import venvs as portable zip bundles. The bundle format is
//! intentionally simple so it stays diff-able and tool-friendly:
//!
//!   <zip>
//!     vorchestra-bundle.json   metadata (python version, engine, name)
//!     requirements.lock        pip-freeze of the source venv
//!
//! Restoration is not deterministic to the byte (no wheels are bundled
//! in this version) but it reproduces the exact package versions on any
//! machine with the right Python available.

use crate::commands::venv::create_venv_internal;
use crate::helpers::{
    canonicalize_dir, classify_install_error, detect_manager_type, ensure_venv_dir,
    get_python_path, new_command, run_command_with_timeout,
    run_command_with_timeout_cancel_and_output, stdout_or_stderr,
};
use crate::jobs::{
    append_job_log, create_background_job, set_job_progress, set_job_status, AppState,
};
use crate::package_managers::manager_for_engine;
use crate::types::BundleManifest;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use zip::write::SimpleFileOptions;
use zip::ZipArchive;

const MANIFEST_FILE: &str = "vorchestra-bundle.json";
const REQUIREMENTS_FILE: &str = "requirements.lock";
const FORMAT_VERSION: u32 = 1;

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn freeze(venv: &Path, engine: &str) -> Result<String, String> {
    let manager = manager_for_engine(engine)?;
    let mut cmd = manager.freeze_command(venv).to_command();
    let out = run_command_with_timeout(&mut cmd, 60)?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        Err(format!(
            "{}: {}",
            manager.freeze_failure_prefix(),
            stdout_or_stderr(&out).trim()
        ))
    }
}

fn read_python_version(venv: &Path) -> String {
    let python = get_python_path(venv);
    new_command(python)
        .arg("--version")
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                let txt = if o.stdout.is_empty() {
                    String::from_utf8_lossy(&o.stderr).to_string()
                } else {
                    String::from_utf8_lossy(&o.stdout).to_string()
                };
                Some(txt.trim().to_string())
            } else {
                None
            }
        })
        .unwrap_or_else(|| "Python (unknown)".to_string())
}

fn export_venv_bundle_job(
    venv_path: String,
    output_path: String,
    job: &crate::jobs::BackgroundJobHandle,
) -> Result<String, String> {
    set_job_progress(job, "Reading environment metadata...", Some(0.1));
    let venv = ensure_venv_dir(&venv_path)?;
    let engine = detect_manager_type(&venv);

    set_job_progress(job, "Freezing package list...", Some(0.3));
    let freeze_text = freeze(&venv, &engine)?;
    let py_version = read_python_version(&venv);
    let venv_name = venv
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "venv".to_string());

    let pkg_count = freeze_text
        .lines()
        .filter(|l| !l.trim().is_empty() && !l.trim().starts_with('#'))
        .count();

    let manifest = BundleManifest {
        format_version: FORMAT_VERSION,
        venv_name: venv_name.clone(),
        python_version: py_version.clone(),
        engine: engine.clone(),
        created_at_unix: now_unix(),
        package_count: pkg_count,
        note: None,
    };
    let manifest_json = serde_json::to_string_pretty(&manifest)
        .map_err(|e| format!("Failed to serialize manifest: {}", e))?;

    let target = PathBuf::from(&output_path);
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create output directory: {}", e))?;
        }
    }

    set_job_progress(job, "Writing bundle archive...", Some(0.65));
    let file = File::create(&target).map_err(|e| format!("Failed to create bundle file: {}", e))?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    zip.start_file(MANIFEST_FILE, opts)
        .map_err(|e| e.to_string())?;
    zip.write_all(manifest_json.as_bytes())
        .map_err(|e| e.to_string())?;

    zip.start_file(REQUIREMENTS_FILE, opts)
        .map_err(|e| e.to_string())?;
    zip.write_all(freeze_text.as_bytes())
        .map_err(|e| e.to_string())?;

    zip.finish().map_err(|e| e.to_string())?;
    set_job_progress(job, "Bundle export finished.", Some(0.95));
    Ok(format!(
        "Wrote bundle for `{}` ({} packages) to {}",
        venv_name,
        pkg_count,
        target.to_string_lossy()
    ))
}

#[tauri::command]
pub fn start_export_venv_bundle_job(
    venv_path: String,
    output_path: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let (job_id, job) = create_background_job(&state)?;
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            export_venv_bundle_job(venv_path, output_path, &blocking_job)
                .map(serde_json::Value::String)
        })
        .await
        .map_err(|e| e.to_string())
        .and_then(|res| res);

        match outcome {
            Ok(result) => set_job_status(&job, "success", Some(result), None),
            Err(err) => set_job_status(&job, "error", None, Some(err)),
        }
    });
    Ok(job_id)
}

#[tauri::command]
pub async fn read_bundle_manifest(bundle_path: String) -> Result<BundleManifest, String> {
    tauri::async_runtime::spawn_blocking(move || read_bundle_manifest_from_path(&bundle_path))
        .await
        .map_err(|e| e.to_string())?
}

fn read_bundle_manifest_from_path(bundle_path: &str) -> Result<BundleManifest, String> {
    let file = File::open(bundle_path).map_err(|e| format!("Failed to open bundle: {}", e))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("Failed to read zip: {}", e))?;
    let mut manifest_file = archive
        .by_name(MANIFEST_FILE)
        .map_err(|e| format!("Manifest entry missing: {}", e))?;
    let mut buf = String::new();
    manifest_file
        .read_to_string(&mut buf)
        .map_err(|e| format!("Failed to read manifest: {}", e))?;
    serde_json::from_str(&buf).map_err(|e| format!("Invalid manifest JSON: {}", e))
}

#[tauri::command]
pub fn start_import_venv_bundle_job(
    bundle_path: String,
    target_workspace: String,
    new_name: String,
    python_bin: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let (job_id, job) = create_background_job(&state)?;
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            set_job_progress(&blocking_job, "Reading bundle...", Some(0.1));
            if new_name.trim().is_empty() {
                return Err("Pick a name for the imported venv.".to_string());
            }
            let workspace = canonicalize_dir(&target_workspace)?;
            let bundle_file =
                File::open(&bundle_path).map_err(|e| format!("Failed to open bundle: {}", e))?;
            let mut archive =
                ZipArchive::new(bundle_file).map_err(|e| format!("Failed to read zip: {}", e))?;

            let manifest: BundleManifest = {
                let mut m = archive
                    .by_name(MANIFEST_FILE)
                    .map_err(|e| format!("Manifest missing: {}", e))?;
                let mut s = String::new();
                m.read_to_string(&mut s)
                    .map_err(|e| format!("Failed to read manifest: {}", e))?;
                serde_json::from_str(&s).map_err(|e| format!("Invalid manifest JSON: {}", e))?
            };

            let requirements: String = {
                let mut r = archive
                    .by_name(REQUIREMENTS_FILE)
                    .map_err(|e| format!("requirements.lock missing: {}", e))?;
                let mut s = String::new();
                r.read_to_string(&mut s)
                    .map_err(|e| format!("Failed to read requirements: {}", e))?;
                s
            };

            set_job_progress(
                &blocking_job,
                "Creating environment from bundle...",
                Some(0.3),
            );
            let venv_path_str = create_venv_internal(
                workspace.to_string_lossy().to_string(),
                new_name.trim().to_string(),
                python_bin,
                manifest.engine.clone(),
            )?;
            let venv = PathBuf::from(&venv_path_str);

            let staged = venv.join(".vorchestra-bundle-requirements.txt");
            fs::write(&staged, &requirements)
                .map_err(|e| format!("Failed to stage requirements: {}", e))?;

            set_job_progress(&blocking_job, "Installing bundled packages...", Some(0.6));
            let manager = manager_for_engine(&manifest.engine)?;
            let mut cmd = manager
                .install_requirements_command(&venv, &staged)
                .to_command();
            let install_result = run_command_with_timeout_cancel_and_output(
                &mut cmd,
                600,
                blocking_job.cancel.as_ref(),
                |stream, line| append_job_log(&blocking_job, stream, line),
            );

            let _ = fs::remove_file(&staged);

            let out = install_result?;
            if !out.status.success() {
                let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                return Err(classify_install_error(stderr));
            }

            set_job_progress(&blocking_job, "Bundle import finished.", Some(0.95));
            Ok(serde_json::Value::String(format!(
                "Imported venv `{}` ({} packages) into {}",
                new_name.trim(),
                manifest.package_count,
                workspace.to_string_lossy()
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_path(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("vorchestra-{}-{}", name, suffix))
    }

    fn write_bundle(path: &Path, manifest: Option<&BundleManifest>, requirements: Option<&str>) {
        let file = File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let opts = SimpleFileOptions::default();
        if let Some(manifest) = manifest {
            zip.start_file(MANIFEST_FILE, opts).unwrap();
            zip.write_all(serde_json::to_string(manifest).unwrap().as_bytes())
                .unwrap();
        }
        if let Some(requirements) = requirements {
            zip.start_file(REQUIREMENTS_FILE, opts).unwrap();
            zip.write_all(requirements.as_bytes()).unwrap();
        }
        zip.finish().unwrap();
    }

    #[test]
    fn read_bundle_manifest_accepts_valid_bundle() {
        let path = unique_temp_path("bundle-ok.zip");
        let manifest = BundleManifest {
            format_version: FORMAT_VERSION,
            venv_name: "demo".to_string(),
            python_version: "Python 3.12.0".to_string(),
            engine: "uv".to_string(),
            created_at_unix: 42,
            package_count: 2,
            note: Some("test".to_string()),
        };
        write_bundle(&path, Some(&manifest), Some("django==5.0\n"));

        let read = read_bundle_manifest_from_path(path.to_str().unwrap()).unwrap();
        assert_eq!(read.venv_name, "demo");
        assert_eq!(read.engine, "uv");
        assert_eq!(read.package_count, 2);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn read_bundle_manifest_rejects_missing_manifest() {
        let path = unique_temp_path("bundle-missing-manifest.zip");
        write_bundle(&path, None, Some("django==5.0\n"));

        let err = read_bundle_manifest_from_path(path.to_str().unwrap()).unwrap_err();
        assert!(err.contains("Manifest entry missing"));
        let _ = fs::remove_file(path);
    }
}
