//! Long-running venv inspection jobs used by lifecycle commands.

use crate::helpers::{
    canonicalize_dir, ensure_venv_dir, get_venv_info, list_installed_packages, safe_dir_size_mb,
    scan_max_depth,
};
use crate::jobs::{set_job_progress, BackgroundJobHandle};
use crate::types::{VenvDetails, VenvInfo};
use std::sync::atomic::{AtomicBool, Ordering};
use walkdir::WalkDir;

fn ensure_not_cancelled(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::Relaxed) {
        Err("Cancelled by user".to_string())
    } else {
        Ok(())
    }
}

pub(crate) fn list_venvs_job(
    base_path: String,
    job: &BackgroundJobHandle,
) -> Result<Vec<VenvInfo>, String> {
    set_job_progress(job, "Preparing workspace scan...", Some(0.05));
    let mut venvs = Vec::new();
    let root = canonicalize_dir(&base_path)?;
    let walker = WalkDir::new(&root)
        .max_depth(scan_max_depth())
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            if name == "node_modules" || name == "target" || name == "__pycache__" || name == ".git"
            {
                return false;
            }
            if name.starts_with('.') && name != ".venv" && name != ".pixi" {
                return false;
            }
            true
        });
    let mut visited = 0usize;
    for entry in walker.filter_map(|e| e.ok()) {
        ensure_not_cancelled(&job.cancel)?;
        visited += 1;
        if visited % 250 == 0 {
            set_job_progress(
                job,
                format!("Scanning workspace... {} entries checked", visited),
                None,
            );
        }
        if let Some(info) = get_venv_info(entry.path()) {
            venvs.push(info);
            set_job_progress(
                job,
                format!("Found {} environment(s)...", venvs.len()),
                None,
            );
        }
    }
    set_job_progress(job, "Workspace scan finished.", Some(0.95));
    Ok(venvs)
}

pub(crate) fn get_venv_details_job(
    path: String,
    job: &BackgroundJobHandle,
) -> Result<VenvDetails, String> {
    set_job_progress(job, "Inspecting environment folder...", Some(0.15));
    let p = ensure_venv_dir(&path)?;
    set_job_progress(job, "Calculating environment size...", Some(0.35));
    let size_mb = safe_dir_size_mb(&p, 300_000);
    ensure_not_cancelled(&job.cancel)?;
    set_job_progress(job, "Reading installed packages...", Some(0.65));
    let packages = list_installed_packages(&p)?;
    set_job_progress(job, "Environment details loaded.", Some(0.95));
    Ok(VenvDetails { packages, size_mb })
}

pub(crate) fn get_venv_packages_job(
    path: String,
    job: &BackgroundJobHandle,
) -> Result<Vec<String>, String> {
    set_job_progress(job, "Reading installed packages...", Some(0.25));
    let p = ensure_venv_dir(&path)?;
    let packages = list_installed_packages(&p)?;
    set_job_progress(job, "Installed packages loaded.", Some(0.95));
    Ok(packages)
}

pub(crate) fn get_venv_size_job(path: String, job: &BackgroundJobHandle) -> Result<f64, String> {
    set_job_progress(job, "Calculating environment size...", Some(0.25));
    let p = ensure_venv_dir(&path)?;
    let size = safe_dir_size_mb(&p, 300_000);
    set_job_progress(job, "Environment size calculated.", Some(0.95));
    Ok(size)
}
