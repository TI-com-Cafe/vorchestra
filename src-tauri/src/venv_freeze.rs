//! `pip freeze` helpers shared by venv clone and diff workflows.

use std::path::Path;
use std::sync::atomic::AtomicBool;

use crate::helpers::{
    get_manager_path, get_python_path, new_command, run_command_with_timeout,
    run_command_with_timeout_and_cancel, stdout_or_stderr, uv_cache_dir_for,
};

/// Captures `pip freeze` output for the given venv using the engine that owns it.
pub fn freeze_venv(venv: &Path, engine: &str) -> Result<String, String> {
    freeze_venv_with_cancel(venv, engine, None)
}

pub fn freeze_venv_with_cancel(
    venv: &Path,
    engine: &str,
    cancel: Option<&AtomicBool>,
) -> Result<String, String> {
    if engine == "uv" {
        let uv_path = get_manager_path("uv");
        let python = get_python_path(venv);
        let mut cmd = new_command(uv_path);
        cmd.env("UV_CACHE_DIR", uv_cache_dir_for(venv));
        cmd.args(["pip", "freeze", "--python"]).arg(&python);
        let out = match cancel {
            Some(cancel) => run_command_with_timeout_and_cancel(&mut cmd, 60, cancel)?,
            None => run_command_with_timeout(&mut cmd, 60)?,
        };
        if out.status.success() {
            Ok(String::from_utf8_lossy(&out.stdout).to_string())
        } else {
            Err(format!(
                "uv pip freeze failed: {}",
                stdout_or_stderr(&out).trim()
            ))
        }
    } else {
        let python = get_python_path(venv);
        let mut cmd = new_command(python);
        cmd.args(["-m", "pip", "freeze"]);
        let out = match cancel {
            Some(cancel) => run_command_with_timeout_and_cancel(&mut cmd, 60, cancel)?,
            None => run_command_with_timeout(&mut cmd, 60)?,
        };
        if out.status.success() {
            Ok(String::from_utf8_lossy(&out.stdout).to_string())
        } else {
            Err(format!(
                "pip freeze failed: {}",
                stdout_or_stderr(&out).trim()
            ))
        }
    }
}
