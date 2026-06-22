//! Venv lifecycle commands: list, scan, create, delete, get details, mtime.

use crate::helpers::{
    canonicalize_dir, classify_install_error, default_python_command, detect_manager_type,
    ensure_venv_dir, get_manager_path, get_python_path, get_venv_info, new_command,
    parse_pip_freeze, persist_engine_marker, run_command_with_timeout,
    run_command_with_timeout_and_cancel, run_command_with_timeout_cancel_and_output,
    stdout_or_stderr, uv_cache_dir_for,
};
use crate::jobs::{
    append_job_log, create_background_job, set_job_progress, set_job_status, AppState,
    BackgroundJobHandle,
};
use crate::package_managers::manager_for_engine;
use crate::project_manifest::{
    merge_packages, read_pipfile, read_pyproject, read_requirements_txt, read_setup_cfg,
    read_setup_py,
};
use crate::recycle::recycle_dir;
use crate::types::{ManifestKind, ProjectManifest, VenvDiffReport, VenvSetupResult};
use crate::venv_diff::build_venv_diff_report;
use crate::venv_freeze::{freeze_venv, freeze_venv_with_cancel};
use crate::venv_inspection::{get_venv_packages_job, get_venv_size_job, list_venvs_job};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::UNIX_EPOCH;

#[tauri::command]
pub fn start_scan_venv_job(
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let (job_id, job) = create_background_job(&state)?;
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            set_job_progress(&blocking_job, "Scanning environment metadata...", Some(0.2));
            if blocking_job.cancel.load(Ordering::Relaxed) {
                return Err("Cancelled by user".to_string());
            }
            let canon = ensure_venv_dir(&path)?;
            let info = get_venv_info(&canon).ok_or_else(|| "Not a valid venv".to_string())?;
            set_job_progress(&blocking_job, "Environment metadata ready.", Some(0.95));
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

fn install_pip_in_venv_job(venv_path: String, job: &BackgroundJobHandle) -> Result<String, String> {
    set_job_progress(job, "Preparing ensurepip...", Some(0.15));
    let venv = ensure_venv_dir(&venv_path)?;
    ensure_mutable_lifecycle_engine(&detect_manager_type(&venv))?;
    let python = get_python_path(&venv);

    let mut ensurepip = new_command(&python);
    ensurepip.args(["-m", "ensurepip", "--upgrade"]);
    set_job_progress(job, "Installing pip with ensurepip...", Some(0.45));
    let out = run_command_with_timeout_and_cancel(&mut ensurepip, 180, job.cancel.as_ref())?;
    if !out.status.success() {
        return Err(format!(
            "Failed to install pip with ensurepip: {}",
            stdout_or_stderr(&out).trim()
        ));
    }

    let mut pip_check = new_command(&python);
    pip_check.args(["-m", "pip", "--version"]);
    set_job_progress(job, "Verifying pip...", Some(0.8));
    let out = run_command_with_timeout_and_cancel(&mut pip_check, 60, job.cancel.as_ref())?;
    if !out.status.success() {
        return Err(format!(
            "pip install verification failed: {}",
            stdout_or_stderr(&out).trim()
        ));
    }

    set_job_progress(job, "pip is available.", Some(0.95));
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn ensure_mutable_lifecycle_engine(engine: &str) -> Result<(), String> {
    if matches!(engine, "pip" | "uv") {
        return Ok(());
    }

    Err(format!(
        "{} environments are read-only in VOrchestra. Use the native manager for lifecycle changes.",
        engine
    ))
}

#[tauri::command]
pub fn start_install_pip_in_venv_job(
    venv_path: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let (job_id, job) = create_background_job(&state)?;
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            install_pip_in_venv_job(venv_path, &blocking_job).map(serde_json::Value::String)
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
pub fn start_list_venvs_job(
    base_path: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let (job_id, job) = create_background_job(&state)?;
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            list_venvs_job(base_path, &blocking_job)
                .and_then(|venvs| serde_json::to_value(venvs).map_err(|e| e.to_string()))
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

pub fn create_venv_internal(
    path: String,
    name: String,
    python_bin: String,
    engine: String,
) -> Result<String, String> {
    let root = canonicalize_dir(&path)?;
    let safe_name = validate_venv_name(&name)?;
    let mut full_path = root.clone();
    full_path.push(&safe_name);
    if full_path.exists() {
        return Err(format!(
            "Environment `{}` already exists in this workspace.",
            safe_name
        ));
    }
    let target_path = full_path.to_string_lossy().to_string();

    if engine == "uv" {
        let uv_path = get_manager_path("uv");
        let mut cmd = new_command(uv_path);
        cmd.args(["venv", &target_path]);
        cmd.env("UV_CACHE_DIR", uv_cache_dir_for(&root));
        if !python_bin.is_empty() {
            cmd.arg("--python").arg(&python_bin);
        }
        let output = cmd.output().map_err(|e| e.to_string())?;
        if output.status.success() {
            persist_engine_marker(&full_path, "uv");
            return Ok(target_path);
        } else {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }
    }

    let bin = if python_bin.is_empty() {
        default_python_command().to_string()
    } else {
        python_bin
    };
    let output = new_command(bin)
        .args(["-m", "venv", &target_path])
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        persist_engine_marker(&full_path, "pip");
        Ok(target_path)
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
pub fn start_create_venv_with_template_job(
    path: String,
    name: String,
    python_bin: String,
    engine: String,
    packages: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let (job_id, job) = create_background_job(&state)?;
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome =
            tauri::async_runtime::spawn_blocking(move || -> Result<serde_json::Value, String> {
                set_job_progress(
                    &blocking_job,
                    format!("Creating environment `{}` with {}...", name, engine),
                    Some(0.02),
                );

                if blocking_job.cancel.load(Ordering::Relaxed) {
                    return Err("Cancelled by user".to_string());
                }

                let total = packages.len();
                let venv_path =
                    create_venv_internal(path, name.clone(), python_bin, engine.clone())?;
                set_job_progress(
                    &blocking_job,
                    format!("Environment created at {}", venv_path),
                    Some(if total == 0 { 0.9 } else { 0.12 }),
                );

                let mut installed = Vec::new();
                for (idx, pkg) in packages.into_iter().enumerate() {
                    if blocking_job.cancel.load(Ordering::Relaxed) {
                        return Err("Cancelled by user".to_string());
                    }

                    let start_progress = 0.12 + (idx as f64 / total as f64) * 0.82;
                    set_job_progress(
                        &blocking_job,
                        format!("Installing package {} of {}: {}", idx + 1, total, pkg),
                        Some(start_progress),
                    );

                    crate::commands::packages::install_dependency_with_cancel_and_output_internal(
                        venv_path.clone(),
                        pkg.clone(),
                        engine.clone(),
                        crate::commands::packages::InstallOptions::default(),
                        Some(blocking_job.cancel.as_ref()),
                        |stream, line| append_job_log(&blocking_job, stream, line),
                    )
                    .map_err(|err| format!("Failed to install `{}`: {}", pkg, err))?;
                    installed.push(pkg.clone());

                    let done_progress = 0.12 + ((idx + 1) as f64 / total as f64) * 0.82;
                    set_job_progress(
                        &blocking_job,
                        format!("Installed package {} of {}: {}", idx + 1, total, pkg),
                        Some(done_progress),
                    );
                }

                set_job_progress(&blocking_job, "Template build finished.", Some(0.98));
                serde_json::to_value(VenvSetupResult {
                    venv_path,
                    installed,
                })
                .map_err(|e| e.to_string())
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

fn detect_rebuild_packages(project_root: &Path) -> Vec<String> {
    let mut manifests = Vec::new();
    let req_path = project_root.join("requirements.txt");
    if req_path.exists() {
        let (packages, note) = read_requirements_txt(&req_path);
        manifests.push(ProjectManifest {
            kind: ManifestKind::RequirementsTxt,
            path: req_path.to_string_lossy().to_string(),
            packages,
            note,
        });
    }

    let pyproject = project_root.join("pyproject.toml");
    if pyproject.exists() {
        let (packages, note) = read_pyproject(&pyproject);
        manifests.push(ProjectManifest {
            kind: ManifestKind::Pyproject,
            path: pyproject.to_string_lossy().to_string(),
            packages,
            note,
        });
    }

    let pipfile = project_root.join("Pipfile");
    if pipfile.exists() {
        let (packages, note) = read_pipfile(&pipfile);
        manifests.push(ProjectManifest {
            kind: ManifestKind::Pipfile,
            path: pipfile.to_string_lossy().to_string(),
            packages,
            note,
        });
    }

    let setup_cfg = project_root.join("setup.cfg");
    if setup_cfg.exists() {
        let (packages, note) = read_setup_cfg(&setup_cfg);
        manifests.push(ProjectManifest {
            kind: ManifestKind::SetupCfg,
            path: setup_cfg.to_string_lossy().to_string(),
            packages,
            note,
        });
    }

    let setup_py = project_root.join("setup.py");
    if setup_py.exists() {
        let (packages, note) = read_setup_py(&setup_py);
        manifests.push(ProjectManifest {
            kind: ManifestKind::SetupPy,
            path: setup_py.to_string_lossy().to_string(),
            packages,
            note,
        });
    }

    merge_packages(&manifests)
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum RebuildSource {
    RequirementsFile(PathBuf),
    UvSync {
        lock_path: PathBuf,
        pyproject_path: PathBuf,
    },
    ManifestPackages(Vec<String>),
}

#[derive(Debug, Serialize)]
pub struct RebuildSourcePreview {
    pub kind: String,
    pub label: String,
    pub path: String,
    pub package_count: usize,
    pub note: String,
}

fn infer_rebuild_python_bin(original: &Path, explicit: Option<String>) -> String {
    if let Some(value) = explicit {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }

    let venv_python = get_python_path(original);
    if venv_python.exists() {
        let mut cmd = new_command(&venv_python);
        cmd.args([
            "-c",
            "import sys; print(getattr(sys, '_base_executable', '') or '')",
        ]);
        if let Ok(out) = run_command_with_timeout(&mut cmd, 10) {
            if out.status.success() {
                let candidate = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !candidate.is_empty() && Path::new(&candidate).exists() {
                    return candidate;
                }
            }
        }
    }

    let cfg_path = original.join("pyvenv.cfg");
    if let Ok(cfg) = fs::read_to_string(&cfg_path) {
        let mut home: Option<PathBuf> = None;
        for line in cfg.lines() {
            if let Some((key, value)) = line.split_once('=') {
                let key = key.trim();
                let value = value.trim();
                if key == "executable" && Path::new(value).exists() {
                    return value.to_string();
                }
                if key == "home" && !value.is_empty() {
                    home = Some(PathBuf::from(value));
                }
            }
        }
        if let Some(home) = home {
            let candidate = home.join(crate::helpers::exe_name("python"));
            if candidate.exists() {
                return candidate.to_string_lossy().to_string();
            }
        }
    }

    String::new()
}

fn detect_rebuild_source(project_root: &Path, engine: &str) -> RebuildSource {
    let lock = project_root.join("requirements.lock");
    if lock.exists() {
        return RebuildSource::RequirementsFile(lock);
    }

    let uv_lock = project_root.join("uv.lock");
    let pyproject = project_root.join("pyproject.toml");
    if engine == "uv" && uv_lock.exists() && pyproject.exists() {
        return RebuildSource::UvSync {
            lock_path: uv_lock,
            pyproject_path: pyproject,
        };
    }

    let requirements = project_root.join("requirements.txt");
    if requirements.exists() {
        return RebuildSource::RequirementsFile(requirements);
    }

    RebuildSource::ManifestPackages(detect_rebuild_packages(project_root))
}

fn rebuild_source_preview(project_root: &Path, engine: &str) -> RebuildSourcePreview {
    match detect_rebuild_source(project_root, engine) {
        RebuildSource::RequirementsFile(path) => {
            let label = path
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "requirements file".to_string());
            let package_count = requirement_entries(&path).len();
            RebuildSourcePreview {
                kind: "requirements".to_string(),
                label,
                path: path.to_string_lossy().to_string(),
                package_count,
                note: "Rebuild will install this pinned requirements file directly.".to_string(),
            }
        }
        RebuildSource::UvSync { lock_path, .. } => {
            let package_count = detect_rebuild_packages(project_root).len();
            RebuildSourcePreview {
                kind: "uv_lock".to_string(),
                label: "uv.lock via uv sync".to_string(),
                path: lock_path.to_string_lossy().to_string(),
                package_count,
                note: "Rebuild will run uv sync with this environment as UV_PROJECT_ENVIRONMENT."
                    .to_string(),
            }
        }
        RebuildSource::ManifestPackages(packages) => RebuildSourcePreview {
            kind: "manifests".to_string(),
            label: "project manifests".to_string(),
            path: project_root.to_string_lossy().to_string(),
            package_count: packages.len(),
            note: if packages.is_empty() {
                "No installable pip/uv packages were detected; rebuild creates an empty environment."
                    .to_string()
            } else {
                "Rebuild will install packages detected from project manifests.".to_string()
            },
        },
    }
}

#[tauri::command]
pub async fn get_rebuild_source_preview(
    venv_path: String,
    engine: String,
) -> Result<RebuildSourcePreview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let original = Path::new(&venv_path);
        let project_root = original
            .parent()
            .ok_or_else(|| "Cannot infer project root for rebuild preview.".to_string())?;
        let project_root = canonicalize_dir(&project_root.to_string_lossy())?;
        Ok(rebuild_source_preview(&project_root, &engine))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn install_requirements_file_for_rebuild(
    venv_path: &str,
    engine: &str,
    requirements_path: &Path,
    job: &BackgroundJobHandle,
) -> Result<(), String> {
    let venv = PathBuf::from(venv_path);
    let manager = manager_for_engine(engine)?;
    let mut cmd = manager
        .install_requirements_command(&venv, requirements_path)
        .to_command();

    let out = run_command_with_timeout_cancel_and_output(
        &mut cmd,
        900,
        job.cancel.as_ref(),
        |stream, line| append_job_log(job, stream, line),
    )?;
    if out.status.success() {
        Ok(())
    } else {
        Err(classify_install_error(stdout_or_stderr(&out)))
    }
}

fn run_uv_sync_for_rebuild(
    rebuilt_path: &str,
    project_root: &Path,
    job: &BackgroundJobHandle,
) -> Result<(), String> {
    let uv = get_manager_path("uv");
    let mut cmd = new_command(uv);
    cmd.current_dir(project_root);
    cmd.env("UV_PROJECT_ENVIRONMENT", rebuilt_path);
    cmd.env("UV_CACHE_DIR", uv_cache_dir_for(Path::new(rebuilt_path)));
    cmd.arg("sync");

    let out = run_command_with_timeout_cancel_and_output(
        &mut cmd,
        900,
        job.cancel.as_ref(),
        |stream, line| append_job_log(job, stream, line),
    )?;
    if out.status.success() {
        Ok(())
    } else {
        Err(classify_install_error(stdout_or_stderr(&out)))
    }
}

fn requirement_entries(path: &Path) -> Vec<String> {
    fs::read_to_string(path)
        .map(|raw| {
            raw.lines()
                .map(str::trim)
                .filter(|line| {
                    !line.is_empty()
                        && !line.starts_with('#')
                        && !line.starts_with("-r ")
                        && !line.starts_with("--requirement")
                })
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

#[tauri::command]
pub fn start_rebuild_venv_from_project_job(
    venv_path: String,
    engine: String,
    python_bin: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    ensure_mutable_lifecycle_engine(&engine)?;
    let (job_id, job) = create_background_job(&state)?;
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome =
            tauri::async_runtime::spawn_blocking(move || -> Result<serde_json::Value, String> {
                set_job_progress(&blocking_job, "Preparing rebuild...", Some(0.05));
                let original = Path::new(&venv_path);
                let project_root = original
                    .parent()
                    .ok_or_else(|| {
                        "Cannot rebuild an environment without a parent directory.".to_string()
                    })?
                    .to_path_buf();
                let project_root = canonicalize_dir(&project_root.to_string_lossy())?;
                let name = original
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .ok_or_else(|| "Cannot infer environment folder name.".to_string())?;
                let python = infer_rebuild_python_bin(original, python_bin);

                if original.exists() {
                    let _ = crate::commands::snapshots::create_snapshot_for_venv(
                        original,
                        &engine,
                        "before rebuild",
                        Some(blocking_job.cancel.as_ref()),
                    )
                    .map(|info| {
                        append_job_log(
                            &blocking_job,
                            "stdout",
                            format!("Created rollback snapshot {}", info.id),
                        )
                    });
                    set_job_progress(
                        &blocking_job,
                        "Moving existing environment to recoverable trash...",
                        Some(0.18),
                    );
                    recycle_dir(original)?;
                }

                if blocking_job.cancel.load(Ordering::Relaxed) {
                    return Err("Cancelled by user".to_string());
                }

                set_job_progress(&blocking_job, "Detecting rebuild source...", Some(0.28));
                let rebuild_source = detect_rebuild_source(&project_root, &engine);
                let rebuilt_path = create_venv_internal(
                    project_root.to_string_lossy().to_string(),
                    name,
                    python,
                    engine.clone(),
                )?;

                let mut installed = Vec::new();
                match rebuild_source {
                    RebuildSource::RequirementsFile(requirements_path) => {
                        let file_name = requirements_path
                            .file_name()
                            .map(|s| s.to_string_lossy().to_string())
                            .unwrap_or_else(|| "requirements file".to_string());
                        set_job_progress(
                            &blocking_job,
                            format!("Installing dependencies from {}...", file_name),
                            Some(0.42),
                        );
                        install_requirements_file_for_rebuild(
                            &rebuilt_path,
                            &engine,
                            &requirements_path,
                            &blocking_job,
                        )?;
                        installed = requirement_entries(&requirements_path);
                        set_job_progress(
                            &blocking_job,
                            format!("Rebuild finished from {}.", file_name),
                            Some(0.98),
                        );
                        return serde_json::to_value(VenvSetupResult {
                            venv_path: rebuilt_path,
                            installed,
                        })
                        .map_err(|e| e.to_string());
                    }
                    RebuildSource::UvSync { .. } => {
                        set_job_progress(
                            &blocking_job,
                            "Running uv sync from uv.lock...",
                            Some(0.42),
                        );
                        run_uv_sync_for_rebuild(
                            &rebuilt_path,
                            &project_root,
                            &blocking_job,
                        )?;
                        installed = detect_rebuild_packages(&project_root);
                        set_job_progress(
                            &blocking_job,
                            "Rebuild finished from uv.lock.",
                            Some(0.98),
                        );
                        return serde_json::to_value(VenvSetupResult {
                            venv_path: rebuilt_path,
                            installed,
                        })
                        .map_err(|e| e.to_string());
                    }
                    RebuildSource::ManifestPackages(packages) => {
                        let total = packages.len();
                        for (idx, pkg) in packages.into_iter().enumerate() {
                            if blocking_job.cancel.load(Ordering::Relaxed) {
                                return Err("Cancelled by user".to_string());
                            }
                            let progress = if total == 0 {
                                0.9
                            } else {
                                0.38 + (idx as f64 / total as f64) * 0.55
                            };
                            set_job_progress(
                                &blocking_job,
                                format!("Installing package {} of {}: {}", idx + 1, total, pkg),
                                Some(progress),
                            );
                            crate::commands::packages::install_dependency_with_cancel_and_output_internal(
                                rebuilt_path.clone(),
                                pkg.clone(),
                                engine.clone(),
                                crate::commands::packages::InstallOptions::default(),
                                Some(blocking_job.cancel.as_ref()),
                                |stream, line| append_job_log(&blocking_job, stream, line),
                            )
                            .map_err(|err| format!("Failed to install `{}`: {}", pkg, err))?;
                            installed.push(pkg);
                        }
                    }
                }

                set_job_progress(&blocking_job, "Rebuild finished.", Some(0.98));
                serde_json::to_value(VenvSetupResult {
                    venv_path: rebuilt_path,
                    installed,
                })
                .map_err(|e| e.to_string())
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
pub async fn delete_venv(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || delete_venv_impl(path))
        .await
        .map_err(|e| e.to_string())?
}

fn delete_venv_impl(path: String) -> Result<String, String> {
    let raw_path = Path::new(&path);
    if !raw_path.exists() {
        return Ok(format!(
            "Environment folder is already missing. Removed stale entry for {}.",
            path
        ));
    }

    let p = ensure_venv_dir(&path)?;
    let recycled = recycle_dir(&p)?;
    Ok(format!(
        "Moved {} to recoverable trash at {}",
        p.to_string_lossy(),
        recycled.to_string_lossy()
    ))
}

#[tauri::command]
pub fn get_venv_mtime(path: String) -> Result<u64, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("Path does not exist".to_string());
    }
    let mtime = p
        .metadata()
        .and_then(|m| m.modified())
        .map(|t| {
            t.duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0)
        })
        .unwrap_or(0);
    Ok(mtime)
}

fn ensure_not_cancelled(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::Relaxed) {
        Err("Cancelled by user".to_string())
    } else {
        Ok(())
    }
}

fn validate_venv_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Pick a name for the environment.".to_string());
    }
    if trimmed == "." || trimmed == ".." || trimmed.contains('/') || trimmed.contains('\\') {
        return Err("Environment name must be a folder name, not a path.".to_string());
    }
    Ok(trimmed.to_string())
}

fn clone_venv_job(
    source_path: String,
    target_workspace: String,
    new_name: String,
    include_packages: bool,
    job: &BackgroundJobHandle,
) -> Result<String, String> {
    set_job_progress(job, "Preparing clone...", Some(0.05));
    let safe_name = validate_venv_name(&new_name)?;
    let source = ensure_venv_dir(&source_path)?;
    let target_root = canonicalize_dir(&target_workspace)?;
    let dest = target_root.join(safe_name);
    if dest.exists() {
        return Err(format!(
            "{} already exists in the target workspace.",
            dest.to_string_lossy()
        ));
    }

    ensure_not_cancelled(job.cancel.as_ref())?;
    let engine = detect_manager_type(&source);
    let source_python = get_python_path(&source);
    let python_bin = source_python.to_string_lossy().to_string();

    set_job_progress(job, "Creating target environment...", Some(0.2));
    if engine == "uv" {
        let uv_path = get_manager_path("uv");
        let mut cmd = new_command(uv_path);
        cmd.arg("venv").arg(&dest).arg("--python").arg(&python_bin);
        cmd.env("UV_CACHE_DIR", uv_cache_dir_for(&target_root));
        let out = run_command_with_timeout_and_cancel(&mut cmd, 180, job.cancel.as_ref())?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).to_string());
        }
        persist_engine_marker(&dest, "uv");
    } else {
        let mut cmd = new_command(&python_bin);
        cmd.args(["-m", "venv"]).arg(&dest);
        let out = run_command_with_timeout_and_cancel(&mut cmd, 180, job.cancel.as_ref())?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).to_string());
        }
        persist_engine_marker(&dest, "pip");
    }

    if include_packages {
        ensure_not_cancelled(job.cancel.as_ref())?;
        set_job_progress(job, "Exporting source package set...", Some(0.45));
        let freeze = freeze_venv(&source, &engine)?;
        let tmp = dest.join(".vorchestra-clone-requirements.txt");
        fs::write(&tmp, &freeze)
            .map_err(|e| format!("Failed to stage clone requirements: {}", e))?;

        set_job_progress(job, "Installing packages into clone...", Some(0.65));
        let manager = manager_for_engine(&engine)?;
        let mut cmd = manager
            .install_requirements_command(&dest, &tmp)
            .to_command();
        let install_result = run_command_with_timeout_cancel_and_output(
            &mut cmd,
            600,
            job.cancel.as_ref(),
            |stream, line| append_job_log(job, stream, line),
        );

        let _ = fs::remove_file(&tmp);

        let out = install_result?;
        if !out.status.success() {
            return Err(format!(
                "Cloned venv created but package install failed: {}",
                stdout_or_stderr(&out).trim()
            ));
        }
    }

    set_job_progress(job, "Clone finished.", Some(0.95));
    Ok(format!(
        "Cloned {} -> {}",
        source.to_string_lossy(),
        dest.to_string_lossy()
    ))
}

/// Starts a cancellable clone operation so package installation never blocks
/// the window event loop.
#[tauri::command]
pub fn start_clone_venv_job(
    source_path: String,
    target_workspace: String,
    new_name: String,
    include_packages: bool,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let (job_id, job) = create_background_job(&state)?;
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            clone_venv_job(
                source_path,
                target_workspace,
                new_name,
                include_packages,
                &blocking_job,
            )
            .map(serde_json::Value::String)
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

/// Compares two venvs at the package level. Useful for "what differs
/// between dev and prod" workflows. Both venvs must already exist.
fn diff_venvs_job(
    source_path: String,
    target_path: String,
    job: &BackgroundJobHandle,
) -> Result<VenvDiffReport, String> {
    set_job_progress(job, "Preparing venv comparison...", Some(0.1));
    let source = ensure_venv_dir(&source_path)?;
    let target = ensure_venv_dir(&target_path)?;
    let source_engine = detect_manager_type(&source);
    let target_engine = detect_manager_type(&target);

    set_job_progress(job, "Reading source package set...", Some(0.3));
    let source_pkgs = parse_pip_freeze(&freeze_venv_with_cancel(
        &source,
        &source_engine,
        Some(job.cancel.as_ref()),
    )?);
    set_job_progress(job, "Reading target package set...", Some(0.6));
    let target_pkgs = parse_pip_freeze(&freeze_venv_with_cancel(
        &target,
        &target_engine,
        Some(job.cancel.as_ref()),
    )?);

    ensure_not_cancelled(&job.cancel)?;
    set_job_progress(job, "Venv comparison finished.", Some(0.95));
    Ok(build_venv_diff_report(
        source.to_string_lossy().to_string(),
        target.to_string_lossy().to_string(),
        source_pkgs,
        target_pkgs,
    ))
}

#[tauri::command]
pub fn start_diff_venvs_job(
    source_path: String,
    target_path: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let (job_id, job) = create_background_job(&state)?;
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            diff_venvs_job(source_path, target_path, &blocking_job)
                .and_then(|report| serde_json::to_value(report).map_err(|e| e.to_string()))
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
pub fn start_get_venv_packages_job(
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let (job_id, job) = create_background_job(&state)?;
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            get_venv_packages_job(path, &blocking_job)
                .and_then(|packages| serde_json::to_value(packages).map_err(|e| e.to_string()))
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
pub fn start_get_venv_size_job(
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let (job_id, job) = create_background_job(&state)?;
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            get_venv_size_job(path, &blocking_job).map(serde_json::Value::from)
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
    use super::{
        delete_venv_impl, detect_rebuild_source, ensure_mutable_lifecycle_engine,
        infer_rebuild_python_bin, rebuild_source_preview, requirement_entries, validate_venv_name,
        RebuildSource,
    };
    use std::fs;

    #[test]
    fn validate_venv_name_trims_valid_name() {
        assert_eq!(validate_venv_name("  api-env  ").unwrap(), "api-env");
    }

    #[test]
    fn validate_venv_name_rejects_empty_and_paths() {
        assert!(validate_venv_name("  ").is_err());
        assert!(validate_venv_name("../env").is_err());
        assert!(validate_venv_name("nested/env").is_err());
        assert!(validate_venv_name("nested\\env").is_err());
        assert!(validate_venv_name(".").is_err());
        assert!(validate_venv_name("..").is_err());
    }

    #[test]
    fn delete_venv_impl_treats_missing_folder_as_stale_entry_success() {
        let missing = std::env::temp_dir().join(format!(
            "vorchestra-missing-venv-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let msg = delete_venv_impl(missing.to_string_lossy().to_string()).unwrap();
        assert!(msg.contains("already missing"));
        assert!(msg.contains("Removed stale entry"));
    }

    #[test]
    fn rebuild_prefers_requirements_lock_over_requirements_txt() {
        let root = std::env::temp_dir().join(format!(
            "vorchestra-rebuild-source-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let lock = root.join("requirements.lock");
        let req = root.join("requirements.txt");
        fs::write(&lock, "django==5.0\n").unwrap();
        fs::write(&req, "django\n").unwrap();

        assert_eq!(
            detect_rebuild_source(&root, "uv"),
            RebuildSource::RequirementsFile(lock)
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rebuild_uv_prefers_uv_lock_before_requirements_txt() {
        let root = std::env::temp_dir().join(format!(
            "vorchestra-rebuild-uv-source-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let uv_lock = root.join("uv.lock");
        let pyproject = root.join("pyproject.toml");
        fs::write(&uv_lock, "").unwrap();
        fs::write(&pyproject, "[project]\ndependencies = [\"fastapi\"]\n").unwrap();
        fs::write(root.join("requirements.txt"), "django\n").unwrap();

        assert_eq!(
            detect_rebuild_source(&root, "uv"),
            RebuildSource::UvSync {
                lock_path: uv_lock,
                pyproject_path: pyproject
            }
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rebuild_pip_ignores_uv_lock_and_uses_requirements_txt() {
        let root = std::env::temp_dir().join(format!(
            "vorchestra-rebuild-pip-source-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("uv.lock"), "").unwrap();
        fs::write(
            root.join("pyproject.toml"),
            "[project]\ndependencies = [\"fastapi\"]\n",
        )
        .unwrap();
        let req = root.join("requirements.txt");
        fs::write(&req, "django\n").unwrap();

        assert_eq!(
            detect_rebuild_source(&root, "pip"),
            RebuildSource::RequirementsFile(req)
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn lifecycle_mutations_reject_read_only_native_managers() {
        assert!(ensure_mutable_lifecycle_engine("pip").is_ok());
        assert!(ensure_mutable_lifecycle_engine("uv").is_ok());

        let err = ensure_mutable_lifecycle_engine("pixi").unwrap_err();
        assert!(err.contains("read-only"));
    }

    #[test]
    fn rebuild_source_preview_reports_uv_lock_plan() {
        let root = std::env::temp_dir().join(format!(
            "vorchestra-rebuild-preview-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("uv.lock"), "").unwrap();
        fs::write(
            root.join("pyproject.toml"),
            "[project]\ndependencies = [\"fastapi\"]\n",
        )
        .unwrap();

        let preview = rebuild_source_preview(&root, "uv");
        assert_eq!(preview.kind, "uv_lock");
        assert_eq!(preview.label, "uv.lock via uv sync");
        assert_eq!(preview.package_count, 1);
        assert!(preview.note.contains("UV_PROJECT_ENVIRONMENT"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn infer_rebuild_python_bin_uses_explicit_value_first() {
        let root = std::env::temp_dir();
        assert_eq!(
            infer_rebuild_python_bin(&root, Some("  /usr/bin/python3  ".to_string())),
            "/usr/bin/python3"
        );
    }

    #[test]
    fn requirement_entries_skip_comments_and_nested_includes() {
        let path = std::env::temp_dir().join(format!(
            "vorchestra-rebuild-requirements-{}.txt",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::write(
            &path,
            "# generated\n-r base.txt\n--requirement dev.txt\ndjango==5.0\n\nfastapi\n",
        )
        .unwrap();

        assert_eq!(
            requirement_entries(&path),
            vec!["django==5.0".to_string(), "fastapi".to_string()]
        );
        let _ = fs::remove_file(path);
    }
}
