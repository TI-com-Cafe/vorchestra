//! Package analysis helpers used by package commands: upgrade previews,
//! reverse dependency lookup, and dry-run conflict checks.

use crate::helpers::{
    ensure_venv_dir, get_manager_path, get_python_path, new_command,
    run_command_with_timeout_and_cancel, stdout_or_stderr, uv_cache_dir_for,
};
use crate::jobs::{set_job_progress, BackgroundJobHandle};

/// Runs a dry-run upgrade for a package and returns the raw resolver
/// output. pip / uv emit a human-readable plan listing what would be
/// installed / replaced / dropped without touching the venv.
pub(crate) fn preview_upgrade_job(
    venv_path: String,
    package: String,
    engine: String,
    job: &BackgroundJobHandle,
) -> Result<String, String> {
    set_job_progress(
        job,
        format!("Previewing upgrade for {}...", package),
        Some(0.2),
    );
    let venv = ensure_venv_dir(&venv_path)?;
    let mut cmd = if engine == "uv" {
        let uv = get_manager_path("uv");
        let python = get_python_path(&venv);
        let mut c = new_command(uv);
        c.env("UV_CACHE_DIR", uv_cache_dir_for(&venv));
        c.args(["pip", "install", "--upgrade", "--dry-run", "--python"])
            .arg(&python)
            .arg(&package);
        c
    } else {
        let python = get_python_path(&venv);
        let mut c = new_command(python);
        c.args(["-m", "pip", "install", "--upgrade", "--dry-run", &package]);
        c
    };
    let out = run_command_with_timeout_and_cancel(&mut cmd, 120, job.cancel.as_ref())?;
    set_job_progress(job, "Upgrade preview finished.", Some(0.95));
    Ok(format!(
        "{}{}",
        String::from_utf8_lossy(&out.stderr),
        String::from_utf8_lossy(&out.stdout)
    ))
}

/// Returns the list of installed distributions that declare a runtime
/// dependency on `package`. Empty list means the package is a "root".
pub(crate) fn why_is_installed_job(
    venv_path: String,
    package: String,
    job: &BackgroundJobHandle,
) -> Result<Vec<String>, String> {
    set_job_progress(
        job,
        format!("Inspecting reverse dependencies for {}...", package),
        Some(0.2),
    );
    let venv = ensure_venv_dir(&venv_path)?;
    let python = get_python_path(&venv);
    let script = r#"import importlib.metadata as m, json, os, re, sys
target_raw = os.environ.get("VORCHESTRA_TARGET", "")
def norm(s):
    return re.sub(r"[-_.]+", "-", s).lower()
target = norm(target_raw)
parents = []
for dist in m.distributions():
    name = dist.metadata.get("Name") or dist.metadata.get("name") or dist.name
    if not name:
        continue
    for req in (dist.requires or []):
        base = req.split(";", 1)[0].strip()
        if not base:
            continue
        base = base.split("[", 1)[0].strip()
        match = re.match(r"([A-Za-z0-9_.-]+)", base)
        if match and norm(match.group(1)) == target:
            parents.append(name)
            break
parents.sort(key=str.lower)
sys.stdout.write(json.dumps(parents))
"#;
    let mut cmd = new_command(python);
    cmd.env("VORCHESTRA_TARGET", &package);
    cmd.args(["-c", script]);
    let out = run_command_with_timeout_and_cancel(&mut cmd, 60, job.cancel.as_ref())?;
    if !out.status.success() {
        return Err(format!(
            "Failed to introspect dependencies: {}",
            stdout_or_stderr(&out).trim()
        ));
    }
    let raw = String::from_utf8_lossy(&out.stdout);
    let parsed: Vec<String> = serde_json::from_str(&raw)
        .map_err(|e| format!("Invalid JSON from python: {} ({})", e, raw))?;
    set_job_progress(job, "Reverse dependency inspection finished.", Some(0.95));
    Ok(parsed)
}

pub(crate) fn check_install_conflicts_job(
    venv_path: String,
    package: String,
    engine: String,
    job: &BackgroundJobHandle,
) -> Result<String, String> {
    set_job_progress(
        job,
        format!("Running dry-run install for {}...", package),
        Some(0.2),
    );
    let pb = ensure_venv_dir(&venv_path)?;

    let mut cmd = if engine == "uv" {
        let uv = get_manager_path("uv");
        let python = get_python_path(&pb);
        let mut c = new_command(uv);
        c.env("UV_CACHE_DIR", uv_cache_dir_for(&pb));
        c.args(["pip", "install", "--python"])
            .arg(&python)
            .args(["--dry-run", &package]);
        c
    } else {
        let python = get_python_path(&pb);
        let mut c = new_command(python);
        c.args(["-m", "pip", "install", "--dry-run", &package]);
        c
    };

    let out = run_command_with_timeout_and_cancel(&mut cmd, 120, job.cancel.as_ref())?;
    set_job_progress(job, "Conflict check finished.", Some(0.95));
    Ok(String::from_utf8_lossy(&out.stderr).to_string()
        + String::from_utf8_lossy(&out.stdout).as_ref())
}
