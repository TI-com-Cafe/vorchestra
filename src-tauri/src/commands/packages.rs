//! Package management commands: install / uninstall / update / dependency
//! tree / disk sizes / requirements export / PyPI search / conflict
//! preview. Includes the elevated retry path for permission failures.

use crate::helpers::ensure_venv_dir;
use crate::jobs::{
    append_job_log, create_background_job, set_job_progress, set_job_status, AppState,
};
use crate::package_analysis::{
    check_install_conflicts_job, preview_upgrade_job, why_is_installed_job,
};
use crate::package_catalog::search_pypi_package;
use crate::package_jobs::{
    analyze_package_hygiene_job, check_dependency_tree_prereq_impl, export_requirements_job,
    get_dependency_tree_job, get_package_sizes_job,
};
pub use crate::package_ops::{
    install_dependency_internal, install_dependency_with_cancel_and_output_internal,
    install_dependency_with_cancel_internal, install_dependency_with_options_internal,
    install_program_and_args, uninstall_package_internal, uninstall_package_with_output_internal,
    update_package_internal, update_package_with_output_internal, InstallOptions,
};
use crate::policy_engine::evaluate_install_policy_for_venv;
#[cfg(windows)]
use crate::process_utils::new_command;

#[tauri::command]
pub async fn evaluate_install_policy(
    venv_path: String,
    package: String,
) -> Result<crate::types::PolicyDecision, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let venv = ensure_venv_dir(&venv_path)?;
        evaluate_install_policy_for_venv(&venv, &package)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn start_install_dependency_job(
    venv_path: String,
    package: String,
    engine: String,
    index_url: Option<String>,
    extra_index_url: Option<String>,
    editable: Option<bool>,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let opts = InstallOptions {
        index_url,
        extra_index_url,
        editable: editable.unwrap_or(false),
    };
    let (job_id, job) = create_background_job(&state)?;
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            set_job_progress(
                &blocking_job,
                format!("Installing {}...", package),
                Some(0.2),
            );
            let _ = crate::commands::snapshots::create_snapshot_for_venv_path(
                &venv_path,
                &engine,
                &format!("before install {}", package),
                Some(blocking_job.cancel.as_ref()),
            )
            .map(|info| {
                append_job_log(
                    &blocking_job,
                    "stdout",
                    format!("Created rollback snapshot {}", info.id),
                )
            });
            install_dependency_with_cancel_and_output_internal(
                venv_path,
                package,
                engine,
                opts,
                Some(blocking_job.cancel.as_ref()),
                |stream, line| append_job_log(&blocking_job, stream, line),
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

#[tauri::command]
pub fn start_uninstall_package_job(
    venv_path: String,
    package: String,
    engine: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let (job_id, job) = create_background_job(&state)?;
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            set_job_progress(
                &blocking_job,
                format!("Uninstalling {}...", package),
                Some(0.2),
            );
            let _ = crate::commands::snapshots::create_snapshot_for_venv_path(
                &venv_path,
                &engine,
                &format!("before uninstall {}", package),
                Some(blocking_job.cancel.as_ref()),
            )
            .map(|info| {
                append_job_log(
                    &blocking_job,
                    "stdout",
                    format!("Created rollback snapshot {}", info.id),
                )
            });
            uninstall_package_with_output_internal(
                venv_path,
                package,
                engine,
                Some(blocking_job.cancel.as_ref()),
                |stream, line| append_job_log(&blocking_job, stream, line),
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

#[tauri::command]
pub fn start_update_package_job(
    venv_path: String,
    package: String,
    engine: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let (job_id, job) = create_background_job(&state)?;
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            set_job_progress(&blocking_job, format!("Updating {}...", package), Some(0.2));
            let _ = crate::commands::snapshots::create_snapshot_for_venv_path(
                &venv_path,
                &engine,
                &format!("before update {}", package),
                Some(blocking_job.cancel.as_ref()),
            )
            .map(|info| {
                append_job_log(
                    &blocking_job,
                    "stdout",
                    format!("Created rollback snapshot {}", info.id),
                )
            });
            update_package_with_output_internal(
                venv_path,
                package,
                engine,
                Some(blocking_job.cancel.as_ref()),
                |stream, line| append_job_log(&blocking_job, stream, line),
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

/// Re-run a pip / uv install with elevated privileges. Used as a follow-up
/// when a normal install returned a `NEEDS_ELEVATION:` error.
#[tauri::command]
pub async fn install_dependency_elevated(
    venv_path: String,
    package: String,
    engine: String,
    index_url: Option<String>,
    extra_index_url: Option<String>,
    editable: Option<bool>,
) -> Result<String, String> {
    let opts = InstallOptions {
        index_url,
        extra_index_url,
        editable: editable.unwrap_or(false),
    };
    tauri::async_runtime::spawn_blocking(move || {
        let (program, args) = install_program_and_args(&venv_path, &package, &engine, &opts)?;

        #[cfg(windows)]
        {
            ensure_venv_dir(&venv_path)?;
            let quoted_args = args
                .iter()
                .map(|a| format!("'{}'", a.replace('\'', "''")))
                .collect::<Vec<_>>()
                .join(",");
            let ps = format!(
                "$p = Start-Process -FilePath '{}' -ArgumentList {} -Verb RunAs -Wait -PassThru; \
                 if ($p.ExitCode -ne 0) {{ exit $p.ExitCode }}",
                program.replace('\'', "''"),
                quoted_args
            );
            let out = new_command("powershell.exe")
                .args(["-NoProfile", "-NonInteractive", "-Command", &ps])
                .output()
                .map_err(|e| format!("Failed to spawn powershell.exe: {}", e))?;

            if out.status.success() {
                return Ok(format!("Installed {} (with elevation)", package));
            }
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            if stderr.to_lowercase().contains("operation was canceled") {
                return Err(
                    "User declined the elevation prompt. Install was not performed.".to_string(),
                );
            }
            Err(format!("Elevated install failed: {}", stderr))
        }

        #[cfg(not(windows))]
        {
            use crate::helpers::{open_terminal_with_command_internal, shell_quote};
            let venv = ensure_venv_dir(&venv_path)?;
            let mut shell_cmd = String::from("sudo ");
            shell_cmd.push_str(&shell_quote(&program));
            for a in &args {
                shell_cmd.push(' ');
                shell_cmd.push_str(&shell_quote(a));
            }
            open_terminal_with_command_internal(&venv, &shell_cmd)?;
            Ok(format!(
                "Opened a terminal with `sudo` install for {}. Enter your password to proceed.",
                package
            ))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn start_get_dependency_tree_job(
    venv_path: String,
    engine: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let (job_id, job) = create_background_job(&state)?;
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            get_dependency_tree_job(venv_path, engine, &blocking_job)
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
pub async fn check_dependency_tree_prereq(
    venv_path: String,
    engine: String,
) -> Result<crate::types::DependencyTreePrereq, String> {
    tauri::async_runtime::spawn_blocking(move || {
        check_dependency_tree_prereq_impl(venv_path, engine)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn start_get_package_sizes_job(
    venv_path: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let (job_id, job) = create_background_job(&state)?;
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            let sizes = get_package_sizes_job(venv_path, &blocking_job)?;
            serde_json::to_value(sizes).map_err(|e| e.to_string())
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
pub fn start_export_requirements_job(
    venv_path: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let (job_id, job) = create_background_job(&state)?;
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            export_requirements_job(venv_path, &blocking_job).map(serde_json::Value::String)
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
pub fn start_search_pypi_job(
    query: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let (job_id, job) = create_background_job(&state)?;
    tauri::async_runtime::spawn(async move {
        set_job_progress(&job, format!("Searching PyPI for {}...", query), Some(0.2));
        if job.cancel.load(std::sync::atomic::Ordering::Relaxed) {
            set_job_status(&job, "cancelled", None, None);
            return;
        }

        let outcome = search_pypi_package(query).await.inspect(|_| {
            set_job_progress(&job, "PyPI metadata received.", Some(0.95));
        });

        if job.cancel.load(std::sync::atomic::Ordering::Relaxed) {
            set_job_status(&job, "cancelled", None, None);
            return;
        }

        match outcome {
            Ok(result) => set_job_status(&job, "success", Some(result), None),
            Err(err) => set_job_status(&job, "error", None, Some(err)),
        }
    });
    Ok(job_id)
}

#[tauri::command]
pub fn start_preview_upgrade_job(
    venv_path: String,
    package: String,
    engine: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let (job_id, job) = create_background_job(&state)?;
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            preview_upgrade_job(venv_path, package, engine, &blocking_job)
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

#[tauri::command]
pub fn start_why_is_installed_job(
    venv_path: String,
    package: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let (job_id, job) = create_background_job(&state)?;
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            why_is_installed_job(venv_path, package, &blocking_job)
                .and_then(|parents| serde_json::to_value(parents).map_err(|e| e.to_string()))
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
pub fn start_check_install_conflicts_job(
    venv_path: String,
    package: String,
    engine: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let (job_id, job) = create_background_job(&state)?;
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            check_install_conflicts_job(venv_path, package, engine, &blocking_job)
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

#[tauri::command]
pub fn start_analyze_package_hygiene_job(
    venv_path: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let (job_id, job) = create_background_job(&state)?;
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            analyze_package_hygiene_job(venv_path, &blocking_job)
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
