//! Project autodetection: given a folder, find Python project manifests
//! (requirements.txt, pyproject.toml, Pipfile, setup.py, setup.cfg,
//! environment.yml, pixi.toml),
//! extract the dependency list when possible, and present a merged
//! suggestion the frontend can feed straight into `create_venv_with_template`.
//!
//! Parsing strategy is intentionally tolerant: anything we can't parse
//! confidently shows up as an empty `packages` list with a note, so the
//! user knows what was found and can decide manually.

use crate::helpers::canonicalize_dir;
use crate::jobs::{create_background_job, set_job_progress, set_job_status, AppState};
use crate::project_manifest::{
    merge_packages, read_conda_environment, read_pipfile, read_pixi_toml, read_pyproject,
    read_requirements_txt, read_setup_cfg, read_setup_py, read_uv_workspace_info,
};
use crate::types::{ManifestKind, ProjectDetection, ProjectManifest};
use std::sync::atomic::Ordering;

fn detect_project_manifests_job(
    path: String,
    job: &crate::jobs::BackgroundJobHandle,
) -> Result<ProjectDetection, String> {
    set_job_progress(job, "Inspecting project manifests...", Some(0.15));
    let root = canonicalize_dir(&path)?;
    let mut manifests: Vec<ProjectManifest> = Vec::new();

    let req_path = root.join("requirements.txt");
    if req_path.exists() {
        let (pkgs, note) = read_requirements_txt(&req_path);
        manifests.push(ProjectManifest {
            kind: ManifestKind::RequirementsTxt,
            path: req_path.to_string_lossy().to_string(),
            packages: pkgs,
            note,
        });
    }

    if job.cancel.load(Ordering::Relaxed) {
        return Err("Cancelled by user".to_string());
    }
    set_job_progress(job, "Reading pyproject.toml...", Some(0.35));
    let pyproject = root.join("pyproject.toml");
    let mut workspace = None;
    if pyproject.exists() {
        let (pkgs, note) = read_pyproject(&pyproject);
        workspace = read_uv_workspace_info(&pyproject);
        manifests.push(ProjectManifest {
            kind: ManifestKind::Pyproject,
            path: pyproject.to_string_lossy().to_string(),
            packages: pkgs,
            note,
        });
    }

    if job.cancel.load(Ordering::Relaxed) {
        return Err("Cancelled by user".to_string());
    }
    set_job_progress(job, "Reading Pipfile...", Some(0.5));
    let pipfile = root.join("Pipfile");
    if pipfile.exists() {
        let (pkgs, note) = read_pipfile(&pipfile);
        manifests.push(ProjectManifest {
            kind: ManifestKind::Pipfile,
            path: pipfile.to_string_lossy().to_string(),
            packages: pkgs,
            note,
        });
    }

    if job.cancel.load(Ordering::Relaxed) {
        return Err("Cancelled by user".to_string());
    }
    set_job_progress(job, "Reading setup.cfg...", Some(0.65));
    let setup_cfg = root.join("setup.cfg");
    if setup_cfg.exists() {
        // setup.cfg uses `install_requires` in INI format. We extract
        // a best-effort list rather than depending on an INI parser.
        let (pkgs, note) = read_setup_cfg(&setup_cfg);
        manifests.push(ProjectManifest {
            kind: ManifestKind::SetupCfg,
            path: setup_cfg.to_string_lossy().to_string(),
            packages: pkgs,
            note,
        });
    }

    if job.cancel.load(Ordering::Relaxed) {
        return Err("Cancelled by user".to_string());
    }
    set_job_progress(job, "Reading setup.py...", Some(0.72));
    let setup_py = root.join("setup.py");
    if setup_py.exists() {
        // We don't execute setup.py, so dependency extraction is a
        // tolerant regex pass. The note tells the user we may have
        // missed something.
        let (pkgs, note) = read_setup_py(&setup_py);
        manifests.push(ProjectManifest {
            kind: ManifestKind::SetupPy,
            path: setup_py.to_string_lossy().to_string(),
            packages: pkgs,
            note,
        });
    }

    if job.cancel.load(Ordering::Relaxed) {
        return Err("Cancelled by user".to_string());
    }
    set_job_progress(job, "Reading Conda/Pixi manifests...", Some(0.84));
    let conda_env = root.join("environment.yml");
    if conda_env.exists() {
        let (pkgs, note) = read_conda_environment(&conda_env);
        manifests.push(ProjectManifest {
            kind: ManifestKind::CondaEnvironment,
            path: conda_env.to_string_lossy().to_string(),
            packages: pkgs,
            note,
        });
    }

    let pixi_toml = root.join("pixi.toml");
    if pixi_toml.exists() {
        let (pkgs, note) = read_pixi_toml(&pixi_toml);
        manifests.push(ProjectManifest {
            kind: ManifestKind::PixiToml,
            path: pixi_toml.to_string_lossy().to_string(),
            packages: pkgs,
            note,
        });
    }

    let merged = merge_packages(&manifests);

    set_job_progress(job, "Project manifest detection finished.", Some(0.95));
    Ok(ProjectDetection {
        project_root: root.to_string_lossy().to_string(),
        manifests,
        merged_packages: merged,
        workspace,
    })
}

#[tauri::command]
pub fn start_detect_project_manifests_job(
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let (job_id, job) = create_background_job(&state)?;
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            detect_project_manifests_job(path, &blocking_job)
                .and_then(|detection| serde_json::to_value(detection).map_err(|e| e.to_string()))
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
