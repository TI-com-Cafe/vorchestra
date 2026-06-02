//! `pip freeze` helpers shared by venv clone and diff workflows.

use std::path::Path;
use std::sync::atomic::AtomicBool;

use crate::helpers::{
    run_command_with_timeout, run_command_with_timeout_and_cancel, stdout_or_stderr,
};
use crate::package_managers::manager_for_engine;

/// Captures `pip freeze` output for the given venv using the engine that owns it.
pub fn freeze_venv(venv: &Path, engine: &str) -> Result<String, String> {
    freeze_venv_with_cancel(venv, engine, None)
}

pub fn freeze_venv_with_cancel(
    venv: &Path,
    engine: &str,
    cancel: Option<&AtomicBool>,
) -> Result<String, String> {
    let manager = manager_for_engine(engine)?;
    let mut cmd = manager.freeze_command(venv).to_command();
    let out = match cancel {
        Some(cancel) => run_command_with_timeout_and_cancel(&mut cmd, 60, cancel)?,
        None => run_command_with_timeout(&mut cmd, 60)?,
    };
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
