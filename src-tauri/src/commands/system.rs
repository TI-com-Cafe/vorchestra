//! System & global commands: hygiene audit (DB ↔ disk), cache cleanup,
//! and ad-hoc tool/script runners inside virtual environments.

use crate::helpers::{
    canonicalize_dir, ensure_venv_dir, exe_name, get_manager_path, get_python_path, get_venv_info,
    new_command, run_command_with_timeout_cancel_and_output, scan_max_depth,
};
use crate::jobs::{
    append_job_log, create_background_job, set_job_progress, set_job_status, AppState,
};
use crate::types::{AuditReport, ToolRunResult, VenvInfo};
use std::collections::HashSet;
use std::path::Path;
use std::sync::atomic::Ordering;
use walkdir::WalkDir;

fn audit_environments_job(
    workspace_paths: Vec<String>,
    registered_paths: Vec<String>,
    job: &crate::jobs::BackgroundJobHandle,
) -> Result<AuditReport, String> {
    set_job_progress(job, "Checking registered environments...", Some(0.1));
    let mut broken_links = Vec::new();
    let mut untracked_venvs: Vec<VenvInfo> = Vec::new();
    let registered_set: HashSet<&String> = registered_paths.iter().collect();

    for path in &registered_paths {
        if job.cancel.load(Ordering::Relaxed) {
            return Err("Cancelled by user".to_string());
        }
        if !Path::new(path).exists() {
            broken_links.push(path.clone());
        }
    }

    let total_workspaces = workspace_paths.len().max(1);
    for (index, ws) in workspace_paths.into_iter().enumerate() {
        if job.cancel.load(Ordering::Relaxed) {
            return Err("Cancelled by user".to_string());
        }
        set_job_progress(
            job,
            format!("Scanning workspace {}...", ws),
            Some(0.2 + (index as f64 / total_workspaces as f64) * 0.7),
        );
        let Ok(root) = canonicalize_dir(&ws) else {
            continue;
        };

        let walker = WalkDir::new(&root)
            .max_depth(scan_max_depth())
            .into_iter()
            .filter_entry(|e| {
                let name = e.file_name().to_string_lossy();
                !["node_modules", "target", "__pycache__", ".git"].contains(&name.as_ref())
            });

        for entry in walker.filter_map(|e| e.ok()) {
            if job.cancel.load(Ordering::Relaxed) {
                return Err("Cancelled by user".to_string());
            }
            let p = entry.path();
            if let Some(info) = get_venv_info(p) {
                if !registered_set.contains(&info.path) {
                    untracked_venvs.push(info);
                }
            }
        }
    }

    set_job_progress(job, "Environment audit finished.", Some(0.95));
    Ok(AuditReport {
        broken_links,
        untracked_venvs,
    })
}

#[tauri::command]
pub fn start_audit_environments_job(
    workspace_paths: Vec<String>,
    registered_paths: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let (job_id, job) = create_background_job(&state)?;
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            audit_environments_job(workspace_paths, registered_paths, &blocking_job)
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

/// Generic "run a tool installed inside the venv" command. The tool is
/// resolved against the venv's `bin/` (Linux/macOS) or `Scripts/`
/// (Windows) directory; if it isn't there, we return early with
/// `tool_missing: true` so the frontend can offer to install it.
///
/// Working directory defaults to the project root (the venv's parent).
/// stdout / stderr come back separately so the UI can show them in
/// distinct panels.
fn run_in_venv_job(
    venv_path: String,
    program: String,
    args: Vec<String>,
    timeout: u64,
    job: &crate::jobs::BackgroundJobHandle,
) -> Result<ToolRunResult, String> {
    set_job_progress(job, format!("Preparing {}...", program), Some(0.1));
    let venv = ensure_venv_dir(&venv_path)?;
    let bin_dir = if cfg!(windows) {
        venv.join("Scripts")
    } else {
        venv.join("bin")
    };
    let exe = bin_dir.join(exe_name(&program));
    if !exe.exists() {
        return Ok(ToolRunResult {
            stdout: String::new(),
            stderr: format!(
                "`{}` is not installed in this venv. Install it first.",
                program
            ),
            exit_code: None,
            success: false,
            tool_missing: true,
        });
    }

    let project_root = venv.parent().unwrap_or(&venv).to_path_buf();
    let mut cmd = new_command(&exe);
    cmd.current_dir(&project_root);
    for a in &args {
        cmd.arg(a);
    }
    set_job_progress(job, format!("Running {}...", program), Some(0.35));
    let out = run_command_with_timeout_cancel_and_output(
        &mut cmd,
        timeout,
        job.cancel.as_ref(),
        |stream, line| append_job_log(job, stream, line),
    )?;
    set_job_progress(job, format!("{} finished.", program), Some(0.95));
    Ok(ToolRunResult {
        stdout: String::from_utf8_lossy(&out.stdout).to_string(),
        stderr: String::from_utf8_lossy(&out.stderr).to_string(),
        exit_code: out.status.code(),
        success: out.status.success(),
        tool_missing: false,
    })
}

#[tauri::command]
pub fn start_run_in_venv_job(
    venv_path: String,
    program: String,
    args: Vec<String>,
    timeout_secs: Option<u64>,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let (job_id, job) = create_background_job(&state)?;
    let timeout = timeout_secs.unwrap_or(300);
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            let result = run_in_venv_job(venv_path, program, args, timeout, &blocking_job)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
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

fn validate_uv_sync_args(args: &[String]) -> Result<Vec<String>, String> {
    let mut validated = Vec::new();
    let mut index = 0;

    while index < args.len() {
        match args[index].as_str() {
            "--all-groups" | "--all-extras" | "--dev" | "--no-dev" | "--frozen" | "--locked" => {
                validated.push(args[index].clone());
                index += 1;
            }
            "--group" | "--extra" => {
                let Some(value) = args.get(index + 1) else {
                    return Err(format!("{} requires a value.", args[index]));
                };
                if value.trim().is_empty() || value.starts_with('-') {
                    return Err(format!("{} requires a non-empty value.", args[index]));
                }
                validated.push(args[index].clone());
                validated.push(value.clone());
                index += 2;
            }
            other => {
                return Err(format!(
                    "Unsupported uv sync option `{}`. Use the structured sync controls.",
                    other
                ));
            }
        }
    }

    Ok(validated)
}

fn run_uv_project_job(
    venv_path: String,
    action: String,
    run_args: Vec<String>,
    timeout: u64,
    job: &crate::jobs::BackgroundJobHandle,
) -> Result<ToolRunResult, String> {
    set_job_progress(job, "Preparing uv project command...", Some(0.1));
    let venv = ensure_venv_dir(&venv_path)?;
    let project_root = venv.parent().unwrap_or(&venv).to_path_buf();
    if !project_root.join("pyproject.toml").exists() {
        return Ok(ToolRunResult {
            stdout: String::new(),
            stderr: "pyproject.toml not found in the project root.".to_string(),
            exit_code: None,
            success: false,
            tool_missing: false,
        });
    }

    let uv = get_manager_path("uv");
    let mut cmd = new_command(uv);
    cmd.current_dir(&project_root);
    cmd.env("UV_PROJECT_ENVIRONMENT", &venv);

    match action.as_str() {
        "sync" => {
            cmd.arg("sync");
            for arg in validate_uv_sync_args(&run_args)? {
                cmd.arg(arg);
            }
        }
        "lock" => {
            cmd.arg("lock");
        }
        "run" => {
            if run_args.is_empty() || run_args.iter().any(|arg| arg.trim().is_empty()) {
                return Err("uv run requires explicit arguments.".to_string());
            }
            cmd.arg("run");
            for arg in &run_args {
                cmd.arg(arg);
            }
        }
        "add" | "remove" => {
            if run_args.is_empty() || run_args.iter().any(|arg| arg.trim().is_empty()) {
                return Err(format!("uv {} requires at least one package spec.", action));
            }
            cmd.arg(&action);
            for arg in &run_args {
                cmd.arg(arg);
            }
        }
        _ => return Err("Unsupported uv project action.".to_string()),
    }

    set_job_progress(job, format!("Running uv {}...", action), Some(0.35));
    let out = run_command_with_timeout_cancel_and_output(
        &mut cmd,
        timeout,
        job.cancel.as_ref(),
        |stream, line| append_job_log(job, stream, line),
    )?;
    set_job_progress(job, "uv command finished.", Some(0.95));
    Ok(ToolRunResult {
        stdout: String::from_utf8_lossy(&out.stdout).to_string(),
        stderr: String::from_utf8_lossy(&out.stderr).to_string(),
        exit_code: out.status.code(),
        success: out.status.success(),
        tool_missing: false,
    })
}

#[tauri::command]
pub fn start_run_uv_project_job(
    venv_path: String,
    action: String,
    run_args: Vec<String>,
    timeout_secs: Option<u64>,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let (job_id, job) = create_background_job(&state)?;
    let timeout = timeout_secs.unwrap_or(600);
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            let result = run_uv_project_job(venv_path, action, run_args, timeout, &blocking_job)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
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

fn run_venv_script_job(
    venv_path: String,
    command: String,
    job: &crate::jobs::BackgroundJobHandle,
) -> Result<String, String> {
    set_job_progress(job, "Preparing Python snippet...", Some(0.1));
    let venv = ensure_venv_dir(&venv_path)?;
    let python = get_python_path(&venv);
    let mut cmd = new_command(python);
    cmd.arg("-c").arg(&command);
    set_job_progress(job, "Running Python snippet...", Some(0.35));
    let out = run_command_with_timeout_cancel_and_output(
        &mut cmd,
        120,
        job.cancel.as_ref(),
        |stream, line| append_job_log(job, stream, line),
    )?;
    if out.status.success() {
        set_job_progress(job, "Python snippet finished.", Some(0.95));
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).to_string())
    }
}

#[tauri::command]
pub fn start_run_venv_script_job(
    venv_path: String,
    command: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let (job_id, job) = create_background_job(&state)?;
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            run_venv_script_job(venv_path, command, &blocking_job).map(serde_json::Value::String)
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
    use super::validate_uv_sync_args;

    #[test]
    fn validate_uv_sync_args_allows_structured_scope_flags() {
        let args = vec![
            "--all-groups".to_string(),
            "--all-extras".to_string(),
            "--group".to_string(),
            "dev".to_string(),
            "--extra".to_string(),
            "postgres".to_string(),
        ];

        assert_eq!(validate_uv_sync_args(&args).unwrap(), args);
    }

    #[test]
    fn validate_uv_sync_args_rejects_unstructured_options() {
        let args = vec!["--config-setting".to_string(), "x=y".to_string()];

        assert!(validate_uv_sync_args(&args).is_err());
    }
}
