//! IDE / notebook integrations beyond opening a window. Each command is
//! idempotent: re-running it produces the same effect (file overwritten
//! with merged content; kernel re-registered with the same name).

use crate::helpers::{
    classify_install_error, ensure_venv_dir, get_python_path, new_command,
    run_command_with_timeout_and_cancel, run_command_with_timeout_cancel_and_output,
    stdout_or_stderr,
};
use crate::jobs::{
    append_job_log, create_background_job, set_job_progress, set_job_status, AppState,
};
use std::fs;

#[derive(serde::Serialize)]
pub struct VscodeInterpreterStatus {
    pub settings_path: String,
    pub exists: bool,
    pub expected_interpreter: String,
    pub configured_interpreter: Option<String>,
    pub terminal_activation: Option<bool>,
    pub env_file: Option<String>,
    pub in_sync: bool,
    pub issue: Option<String>,
}

#[tauri::command]
pub async fn get_vscode_interpreter_status(
    venv_path: String,
) -> Result<VscodeInterpreterStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let venv = ensure_venv_dir(&venv_path)?;
        let python = get_python_path(&venv).to_string_lossy().to_string();
        let project_root = venv.parent().unwrap_or(&venv).to_path_buf();
        let settings_path = project_root.join(".vscode").join("settings.json");
        let settings_path_str = settings_path.to_string_lossy().to_string();

        if !settings_path.exists() {
            return Ok(VscodeInterpreterStatus {
                settings_path: settings_path_str,
                exists: false,
                expected_interpreter: python,
                configured_interpreter: None,
                terminal_activation: None,
                env_file: None,
                in_sync: false,
                issue: Some(".vscode/settings.json does not exist yet.".to_string()),
            });
        }

        let raw = fs::read_to_string(&settings_path)
            .map_err(|e| format!("Failed to read VS Code settings: {}", e))?;
        let parsed: serde_json::Value = serde_json::from_str(&raw)
            .map_err(|e| format!("VS Code settings.json is not valid JSON: {}", e))?;
        let Some(obj) = parsed.as_object() else {
            return Ok(VscodeInterpreterStatus {
                settings_path: settings_path_str,
                exists: true,
                expected_interpreter: python,
                configured_interpreter: None,
                terminal_activation: None,
                env_file: None,
                in_sync: false,
                issue: Some("VS Code settings.json is not a JSON object.".to_string()),
            });
        };

        let configured = obj
            .get("python.defaultInterpreterPath")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let terminal_activation = obj
            .get("python.terminal.activateEnvironment")
            .and_then(|v| v.as_bool());
        let env_file = obj
            .get("python.envFile")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let interpreter_ok = configured.as_deref() == Some(python.as_str());
        let activation_ok = terminal_activation == Some(true);
        let env_file_ok = env_file.as_deref() == Some("${workspaceFolder}/.env");
        let in_sync = interpreter_ok && activation_ok && env_file_ok;
        let issue = if in_sync {
            None
        } else if configured.is_none() {
            Some("No python.defaultInterpreterPath configured.".to_string())
        } else if !interpreter_ok {
            Some("Configured interpreter does not match this environment.".to_string())
        } else if !activation_ok {
            Some("Terminal environment activation is disabled or missing.".to_string())
        } else {
            Some("python.envFile is missing or points somewhere else.".to_string())
        };

        Ok(VscodeInterpreterStatus {
            settings_path: settings_path_str,
            exists: true,
            expected_interpreter: python,
            configured_interpreter: configured,
            terminal_activation,
            env_file,
            in_sync,
            issue,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Writes (or merges into) `<project>/.vscode/settings.json` so VS Code
/// picks the venv's interpreter automatically. Existing keys we don't
/// own are preserved; only the python-related entries are touched. If
/// the file is not valid JSON we report it and write a fresh document
/// rather than corrupting the original.
fn generate_vscode_config_job(
    venv_path: String,
    job: &crate::jobs::BackgroundJobHandle,
) -> Result<String, String> {
    set_job_progress(job, "Preparing VS Code configuration...", Some(0.2));
    let venv = ensure_venv_dir(&venv_path)?;
    let python = get_python_path(&venv);
    let project_root = venv.parent().unwrap_or(&venv).to_path_buf();
    let vscode_dir = project_root.join(".vscode");
    fs::create_dir_all(&vscode_dir)
        .map_err(|e| format!("Failed to create .vscode directory: {}", e))?;
    let settings_path = vscode_dir.join("settings.json");

    // Our authoritative keys.
    let our_keys = [
        (
            "python.defaultInterpreterPath",
            serde_json::Value::String(python.to_string_lossy().to_string()),
        ),
        (
            "python.terminal.activateEnvironment",
            serde_json::Value::Bool(true),
        ),
        (
            "python.envFile",
            serde_json::Value::String("${workspaceFolder}/.env".to_string()),
        ),
    ];

    set_job_progress(job, "Merging .vscode/settings.json...", Some(0.45));
    let mut merged_warning: Option<String> = None;
    let final_value = if settings_path.exists() {
        let raw = fs::read_to_string(&settings_path)
            .map_err(|e| format!("Failed to read existing settings: {}", e))?;
        match serde_json::from_str::<serde_json::Value>(&raw) {
            Ok(serde_json::Value::Object(mut map)) => {
                for (k, v) in our_keys {
                    map.insert(k.to_string(), v);
                }
                serde_json::Value::Object(map)
            }
            Ok(_) => {
                merged_warning =
                    Some("Existing settings.json was not a JSON object; replacing it.".to_string());
                let mut map = serde_json::Map::new();
                for (k, v) in our_keys {
                    map.insert(k.to_string(), v);
                }
                serde_json::Value::Object(map)
            }
            Err(e) => {
                merged_warning = Some(format!(
                        "Existing settings.json could not be parsed ({}). Replacing with VOrchestra defaults; back up the original if you need it.",
                        e
                    ));
                let mut map = serde_json::Map::new();
                for (k, v) in our_keys {
                    map.insert(k.to_string(), v);
                }
                serde_json::Value::Object(map)
            }
        }
    } else {
        let mut map = serde_json::Map::new();
        for (k, v) in our_keys {
            map.insert(k.to_string(), v);
        }
        serde_json::Value::Object(map)
    };

    let pretty = serde_json::to_string_pretty(&final_value)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    fs::write(&settings_path, pretty)
        .map_err(|e| format!("Failed to write settings.json: {}", e))?;

    set_job_progress(job, "VS Code configuration written.", Some(0.95));
    if let Some(warn) = merged_warning {
        Ok(format!(
            "Wrote {} ({})",
            settings_path.to_string_lossy(),
            warn
        ))
    } else {
        Ok(format!(
            "Wrote {} (interpreter pinned to {})",
            settings_path.to_string_lossy(),
            python.to_string_lossy()
        ))
    }
}

#[tauri::command]
pub fn start_generate_vscode_config_job(
    venv_path: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let (job_id, job) = create_background_job(&state)?;
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            generate_vscode_config_job(venv_path, &blocking_job).map(serde_json::Value::String)
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

/// Registers the venv as a Jupyter kernel via `ipykernel install --user`.
/// `--user` writes to ~/.local/share/jupyter/kernels (or AppData on
/// Windows), so elevation is normally not required. If the elevated
/// install path is needed, the standard NEEDS_ELEVATION pattern kicks
/// in via `classify_install_error`.
///
/// `name` is the kernel id (no spaces). `display_name` is what shows up
/// in JupyterLab's launcher. Both default to the venv folder name.
fn register_jupyter_kernel_job(
    venv_path: String,
    name: Option<String>,
    display_name: Option<String>,
    job: &crate::jobs::BackgroundJobHandle,
) -> Result<String, String> {
    use crate::helpers::detect_manager_type;
    set_job_progress(job, "Preparing Jupyter kernel registration...", Some(0.2));
    let venv = ensure_venv_dir(&venv_path)?;
    let engine = detect_manager_type(&venv);
    let python = get_python_path(&venv);

    let venv_basename = venv
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "vorchestra-venv".to_string());

    let kernel_id = name
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| sanitize_kernel_id(&venv_basename));
    let display = display_name
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| format!("Python ({})", venv_basename));

    let mut cmd = new_command(&python);
    cmd.args([
        "-m",
        "ipykernel",
        "install",
        "--user",
        "--name",
        &kernel_id,
        "--display-name",
        &display,
    ]);
    set_job_progress(job, "Running ipykernel install...", Some(0.55));
    let out = run_command_with_timeout_and_cancel(&mut cmd, 60, job.cancel.as_ref())?;

    if out.status.success() {
        set_job_progress(job, "Jupyter kernel registered.", Some(0.95));
        return Ok(format!(
            "Registered kernel `{}` (display: \"{}\"). It now appears in JupyterLab.",
            kernel_id, display
        ));
    }

    let stderr = stdout_or_stderr(&out);
    if stderr.to_lowercase().contains("no module named ipykernel")
        || stderr.contains("ModuleNotFoundError")
    {
        return Err(format!(
            "ipykernel is not installed in this environment. Install it first with `{}` and run registration again: {}",
            ipykernel_install_hint(&engine),
            stderr.trim()
        ));
    }
    Err(classify_install_error(stderr))
}

fn ipykernel_install_hint(engine: &str) -> &'static str {
    match engine {
        "uv" => "uv pip install ipykernel",
        "conda" => "conda install -c conda-forge ipykernel",
        "pixi" => "pixi add ipykernel",
        _ => "pip install ipykernel",
    }
}

#[tauri::command]
pub fn start_register_jupyter_kernel_job(
    venv_path: String,
    name: Option<String>,
    display_name: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let (job_id, job) = create_background_job(&state)?;
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            register_jupyter_kernel_job(venv_path, name, display_name, &blocking_job)
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

/// Sets up `pre-commit` for the project that owns this venv:
///   1. pip-installs pre-commit if missing (best effort; failure is
///      surfaced and the user can install manually).
///   2. writes a starter `.pre-commit-config.yaml` if the project root
///      doesn't already have one.
///   3. runs `pre-commit install` to wire the git hooks.
///
/// Step 3 only succeeds when the project root is inside a git repo;
/// when it isn't, the error message points the user at `git init`.
fn install_precommit_hooks_job(
    venv_path: String,
    job: &crate::jobs::BackgroundJobHandle,
) -> Result<String, String> {
    use crate::helpers::detect_manager_type;
    let venv = ensure_venv_dir(&venv_path)?;
    let engine = detect_manager_type(&venv);
    ensure_mutable_integration_engine(&engine)?;
    let project_root = venv.parent().unwrap_or(&venv).to_path_buf();
    let bin_dir = if cfg!(windows) {
        venv.join("Scripts")
    } else {
        venv.join("bin")
    };

    // 1. Install pre-commit in the venv if it isn't already there.
    let pre_commit = bin_dir.join(crate::helpers::exe_name("pre-commit"));
    if !pre_commit.exists() {
        set_job_progress(
            job,
            "Installing pre-commit in the environment...",
            Some(0.25),
        );
        crate::commands::packages::install_dependency_with_cancel_and_output_internal(
            venv_path.clone(),
            "pre-commit".to_string(),
            engine,
            crate::commands::packages::InstallOptions::default(),
            Some(job.cancel.as_ref()),
            |stream, line| append_job_log(job, stream, line),
        )
        .map_err(|e| classify_install_error(format!("Failed to install pre-commit: {}", e)))?;
    }

    // 2. Seed a config file if the project doesn't have one.
    set_job_progress(job, "Preparing .pre-commit-config.yaml...", Some(0.65));
    let config_path = project_root.join(".pre-commit-config.yaml");
    let mut wrote_config = false;
    if !config_path.exists() {
        let template = r#"# Generated by VOrchestra. Tweak as your project grows.
repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.6.0
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-yaml
      - id: check-merge-conflict
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.6.9
    hooks:
      - id: ruff
        args: ["--fix"]
      - id: ruff-format
"#;
        fs::write(&config_path, template)
            .map_err(|e| format!("Failed to write .pre-commit-config.yaml: {}", e))?;
        wrote_config = true;
    }

    // 3. Wire the git hooks.
    set_job_progress(job, "Installing git hooks...", Some(0.82));
    let mut cmd = new_command(&pre_commit);
    cmd.current_dir(&project_root);
    cmd.args(["install"]);
    let out = run_command_with_timeout_cancel_and_output(
        &mut cmd,
        60,
        job.cancel.as_ref(),
        |stream, line| append_job_log(job, stream, line),
    )?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).to_string();
        if err.to_lowercase().contains("not a git repository") {
            return Err("Project root is not a git repository. Run `git init` first.".to_string());
        }
        return Err(format!("pre-commit install failed: {}", err.trim()));
    }

    set_job_progress(job, "pre-commit hooks installed.", Some(0.95));
    Ok(if wrote_config {
        format!(
            "Wrote .pre-commit-config.yaml and installed git hooks in {}.",
            project_root.to_string_lossy()
        )
    } else {
        format!(
            "Installed git hooks in {} (existing config kept).",
            project_root.to_string_lossy()
        )
    })
}

#[tauri::command]
pub fn start_install_precommit_hooks_job(
    venv_path: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let (job_id, job) = create_background_job(&state)?;
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            install_precommit_hooks_job(venv_path, &blocking_job).map(serde_json::Value::String)
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

fn ensure_mutable_integration_engine(engine: &str) -> Result<(), String> {
    if matches!(engine, "pip" | "uv") {
        return Ok(());
    }

    Err(format!(
        "{} environments are read-only in VOrchestra. Use the native manager for project tool installation.",
        engine
    ))
}

fn sanitize_kernel_id(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "vorchestra-venv".to_string()
    } else {
        trimmed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_kernel_id_replaces_special_chars() {
        assert_eq!(sanitize_kernel_id("My Project"), "My-Project");
        assert_eq!(sanitize_kernel_id("a/b\\c"), "a-b-c");
        assert_eq!(sanitize_kernel_id("---"), "vorchestra-venv");
    }

    #[test]
    fn precommit_install_rejects_read_only_native_managers() {
        assert!(ensure_mutable_integration_engine("pip").is_ok());
        assert!(ensure_mutable_integration_engine("uv").is_ok());

        let err = ensure_mutable_integration_engine("conda").unwrap_err();
        assert!(err.contains("read-only"));
    }

    #[test]
    fn jupyter_missing_ipykernel_hint_matches_manager() {
        assert_eq!(ipykernel_install_hint("pip"), "pip install ipykernel");
        assert_eq!(ipykernel_install_hint("uv"), "uv pip install ipykernel");
        assert_eq!(
            ipykernel_install_hint("conda"),
            "conda install -c conda-forge ipykernel"
        );
        assert_eq!(ipykernel_install_hint("pixi"), "pixi add ipykernel");
    }
}
