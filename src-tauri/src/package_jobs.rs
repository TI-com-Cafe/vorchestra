//! Long-running package inspection jobs used by Tauri package commands.

use crate::helpers::{
    build_dependency_tree_with_python_and_cancel, ensure_venv_dir, get_python_path, new_command,
    run_command_with_timeout, run_command_with_timeout_and_cancel, stdout_or_stderr,
};
use crate::jobs::{set_job_progress, BackgroundJobHandle};
use crate::package_hygiene::{parse_package_hygiene_report, PACKAGE_HYGIENE_SCRIPT};
use crate::package_sizes::scan_package_sizes;
use crate::types::{DependencyTreePrereq, PackageHygieneReport};
use std::collections::HashMap;
use std::fs;

pub(crate) fn get_dependency_tree_job(
    venv_path: String,
    engine: String,
    job: &BackgroundJobHandle,
) -> Result<serde_json::Value, String> {
    set_job_progress(job, "Preparing dependency tree...", Some(0.1));
    let venv = ensure_venv_dir(&venv_path)?;
    if engine == "uv" {
        set_job_progress(job, "Reading package metadata...", Some(0.35));
        return build_dependency_tree_with_python_and_cancel(&venv, job.cancel.as_ref());
    }

    let python_path = get_python_path(&venv);
    let mut cmd = new_command(python_path);
    cmd.args(["-m", "pipdeptree", "--json-tree"]);
    set_job_progress(job, "Running pipdeptree...", Some(0.35));
    let out = run_command_with_timeout_and_cancel(&mut cmd, 180, job.cancel.as_ref())?;

    if out.status.success() {
        set_job_progress(job, "Parsing dependency tree...", Some(0.8));
        serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())
    } else {
        let raw_err = stdout_or_stderr(&out);
        let err_lc = raw_err.to_lowercase();
        if err_lc.contains("no module named pipdeptree")
            || (err_lc.contains("modulenotfounderror") && err_lc.contains("pipdeptree"))
        {
            Err("pipdeptree not found. Please install it in the environment to see the dependency tree.".to_string())
        } else if raw_err.trim().is_empty() {
            Err("Failed to build dependency tree for this environment.".to_string())
        } else {
            Err(raw_err)
        }
    }
}

pub(crate) fn check_dependency_tree_prereq_impl(
    venv_path: String,
    engine: String,
) -> Result<DependencyTreePrereq, String> {
    let venv = ensure_venv_dir(&venv_path)?;

    if engine == "uv" {
        return Ok(DependencyTreePrereq {
            ok: true,
            message: None,
        });
    }

    let python_path = get_python_path(&venv);
    let mut cmd = new_command(python_path);
    cmd.args([
        "-c",
        "import importlib.util,sys;sys.exit(0 if importlib.util.find_spec('pipdeptree') else 1)",
    ]);

    match run_command_with_timeout(&mut cmd, 4) {
        Ok(out) if out.status.success() => Ok(DependencyTreePrereq {
            ok: true,
            message: None,
        }),
        Ok(out) => {
            let raw_err = stdout_or_stderr(&out);
            let err_lc = raw_err.to_lowercase();
            if err_lc.contains("no module named pipdeptree")
                || (err_lc.contains("modulenotfounderror") && err_lc.contains("pipdeptree"))
            {
                Ok(DependencyTreePrereq {
                    ok: false,
                    message: Some("pipdeptree not found. Please install it in the environment to see the dependency tree.".to_string()),
                })
            } else {
                Ok(DependencyTreePrereq {
                    ok: true,
                    message: None,
                })
            }
        }
        Err(_) => Ok(DependencyTreePrereq {
            ok: true,
            message: None,
        }),
    }
}

pub(crate) fn get_package_sizes_job(
    venv_path: String,
    job: &BackgroundJobHandle,
) -> Result<HashMap<String, f64>, String> {
    set_job_progress(job, "Scanning package directories...", Some(0.1));
    let sizes = scan_package_sizes(
        &venv_path,
        Some(job.cancel.as_ref()),
        |message, progress| {
            set_job_progress(job, message, progress);
        },
    )?;
    set_job_progress(job, "Package size scan finished.", Some(0.95));
    Ok(sizes)
}

pub(crate) fn export_requirements_job(
    venv_path: String,
    job: &BackgroundJobHandle,
) -> Result<String, String> {
    set_job_progress(job, "Preparing requirements export...", Some(0.15));
    let pb = ensure_venv_dir(&venv_path)?;
    let python = get_python_path(&pb);
    let project_root = pb.parent().unwrap_or(&pb).to_path_buf();
    let req_path = project_root.join("requirements.txt");
    let mut cmd = new_command(python);
    cmd.args(["-m", "pip", "freeze"]);
    set_job_progress(job, "Running pip freeze...", Some(0.45));
    let out = run_command_with_timeout_and_cancel(&mut cmd, 60, job.cancel.as_ref())?;
    if out.status.success() {
        set_job_progress(job, "Writing requirements.txt...", Some(0.85));
        fs::write(&req_path, out.stdout).map_err(|e| e.to_string())?;
        Ok(format!("Exported to {}", req_path.to_string_lossy()))
    } else {
        Err(String::from_utf8_lossy(&out.stderr).to_string())
    }
}

pub(crate) fn analyze_package_hygiene_job(
    venv_path: String,
    job: &BackgroundJobHandle,
) -> Result<PackageHygieneReport, String> {
    set_job_progress(job, "Analyzing package dependency ownership...", Some(0.2));
    let venv = ensure_venv_dir(&venv_path)?;
    let python = get_python_path(&venv);
    let mut cmd = new_command(python);
    cmd.args(["-c", PACKAGE_HYGIENE_SCRIPT]);
    let out = run_command_with_timeout_and_cancel(&mut cmd, 60, job.cancel.as_ref())?;
    if !out.status.success() {
        return Err(format!(
            "Failed to analyze package hygiene: {}",
            stdout_or_stderr(&out).trim()
        ));
    }
    let raw = String::from_utf8_lossy(&out.stdout);
    let report = parse_package_hygiene_report(&raw)?;
    set_job_progress(job, "Package hygiene analysis finished.", Some(0.95));
    Ok(report)
}
