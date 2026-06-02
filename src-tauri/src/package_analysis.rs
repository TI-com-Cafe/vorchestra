//! Package analysis helpers used by package commands: upgrade previews,
//! reverse dependency lookup, and dry-run conflict checks.

use crate::command_runner::{CommandRunner, RealCommandRunner};
use crate::helpers::{
    ensure_venv_dir, get_python_path, new_command, run_command_with_timeout_and_cancel,
    stdout_or_stderr,
};
use crate::jobs::{set_job_progress, BackgroundJobHandle};
use crate::package_managers::manager_for_engine;

/// Runs a dry-run upgrade for a package and returns the raw resolver
/// output. pip / uv emit a human-readable plan listing what would be
/// installed / replaced / dropped without touching the venv.
pub(crate) fn preview_upgrade_job(
    venv_path: String,
    package: String,
    engine: String,
    job: &BackgroundJobHandle,
) -> Result<String, String> {
    preview_upgrade_with_runner(venv_path, package, engine, job, &RealCommandRunner)
}

fn preview_upgrade_with_runner(
    venv_path: String,
    package: String,
    engine: String,
    job: &BackgroundJobHandle,
    runner: &dyn CommandRunner,
) -> Result<String, String> {
    set_job_progress(
        job,
        format!("Previewing upgrade for {}...", package),
        Some(0.2),
    );
    let venv = ensure_venv_dir(&venv_path)?;
    let manager = manager_for_engine(&engine)?;
    let cmd = manager.upgrade_preview_command(&venv, &package);
    let out = runner.run_package_command(&cmd, 120, Some(job.cancel.as_ref()))?;
    set_job_progress(job, "Upgrade preview finished.", Some(0.95));
    Ok(out.combined_text())
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
    check_install_conflicts_with_runner(venv_path, package, engine, job, &RealCommandRunner)
}

fn check_install_conflicts_with_runner(
    venv_path: String,
    package: String,
    engine: String,
    job: &BackgroundJobHandle,
    runner: &dyn CommandRunner,
) -> Result<String, String> {
    set_job_progress(
        job,
        format!("Running dry-run install for {}...", package),
        Some(0.2),
    );
    let pb = ensure_venv_dir(&venv_path)?;
    let manager = manager_for_engine(&engine)?;
    let cmd = manager.install_preview_command(&pb, &package);

    let out = runner.run_package_command(&cmd, 120, Some(job.cancel.as_ref()))?;
    set_job_progress(job, "Conflict check finished.", Some(0.95));
    Ok(out.combined_text())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command_runner::tests_support::FakeCommandRunner;
    use crate::command_runner::CommandOutput;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fake_venv() -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("vorchestra-analysis-runner-{}", suffix));
        if cfg!(windows) {
            fs::create_dir_all(root.join("Scripts")).unwrap();
        } else {
            fs::create_dir_all(root.join("bin")).unwrap();
        }
        fs::write(root.join("pyvenv.cfg"), "home = /usr/bin\n").unwrap();
        root
    }

    #[test]
    fn preview_upgrade_uses_runner_and_combines_output() {
        let venv = fake_venv();
        let job = crate::jobs::test_job_handle();
        let runner = FakeCommandRunner::new(vec![Ok(CommandOutput {
            success: true,
            stdout: b"Would install httpx-1.0\n".to_vec(),
            stderr: b"Using cached metadata\n".to_vec(),
        })]);

        let out = preview_upgrade_with_runner(
            venv.to_string_lossy().to_string(),
            "httpx".to_string(),
            "pip".to_string(),
            &job,
            &runner,
        )
        .unwrap();

        assert!(out.contains("Using cached metadata"));
        assert!(out.contains("Would install httpx-1.0"));
        let calls = runner.calls.borrow();
        assert_eq!(calls.len(), 1);
        assert_eq!(
            calls[0].args,
            vec!["-m", "pip", "install", "--upgrade", "--dry-run", "httpx"]
        );
        let _ = fs::remove_dir_all(venv);
    }

    #[test]
    fn install_conflict_preview_uses_uv_dry_run_command() {
        let venv = fake_venv();
        let job = crate::jobs::test_job_handle();
        let runner = FakeCommandRunner::new(vec![Ok(CommandOutput::success(
            b"Resolved 3 packages\n".to_vec(),
        ))]);

        let out = check_install_conflicts_with_runner(
            venv.to_string_lossy().to_string(),
            "django".to_string(),
            "uv".to_string(),
            &job,
            &runner,
        )
        .unwrap();

        assert!(out.contains("Resolved 3 packages"));
        let calls = runner.calls.borrow();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].args[0], "pip");
        assert_eq!(calls[0].args[1], "install");
        assert!(calls[0].args.contains(&"--python".to_string()));
        assert!(calls[0].args.contains(&"--dry-run".to_string()));
        assert!(calls[0].env.iter().any(|(key, _)| key == "UV_CACHE_DIR"));
        let _ = fs::remove_dir_all(venv);
    }
}
