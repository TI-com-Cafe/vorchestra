//! Runtime discovery and installers for Python / uv.
//!
//! Kept separate from system commands so heavyweight installer orchestration
//! and version discovery do not turn `commands/system.rs` into a catch-all.

use crate::helpers::{
    classify_install_error, exe_name, get_manager_path, manager_search_dirs, new_command,
    parse_uv_python_list, run_command_with_timeout_and_cancel, stdout_or_stderr,
};
use crate::jobs::{create_background_job, set_job_progress, set_job_status, AppState};
use crate::types::{ManagerStatus, PythonVersion};
use std::collections::HashMap;
use std::fs;

#[tauri::command]
pub async fn list_system_pythons() -> Vec<String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut found_versions = HashMap::new();

        let path_var = std::env::var_os("PATH").unwrap_or_default();
        let paths = std::env::split_paths(&path_var);

        for dir in paths {
            if let Ok(entries) = fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    let name_low = name.to_lowercase();

                    let is_python = (name_low == "python"
                        || name_low == "python.exe"
                        || name_low == "python3"
                        || name_low == "python3.exe"
                        || (name_low.starts_with("python3.")
                            && name_low.chars().nth(8).is_some_and(|c| c.is_ascii_digit())))
                        && !name_low.contains("-config");

                    if is_python {
                        let p = entry.path();
                        if let Ok(out) = new_command(&p).arg("--version").output() {
                            if out.status.success() {
                                let version = if out.stdout.is_empty() {
                                    String::from_utf8_lossy(&out.stderr)
                                } else {
                                    String::from_utf8_lossy(&out.stdout)
                                }
                                .trim()
                                .to_string();

                                if !version.is_empty() {
                                    let current_path = p.to_string_lossy().to_string();
                                    if !found_versions.contains_key(&version)
                                        || current_path.contains('.')
                                    {
                                        found_versions.insert(version, current_path);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        found_versions
            .into_iter()
            .map(|(v, p)| format!("{}|{}", p, v))
            .collect()
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub async fn check_managers() -> ManagerStatus {
    tauri::async_runtime::spawn_blocking(|| {
        let mut uv = false;
        let mut poetry = false;
        let mut pdm = false;
        let mut conda = false;
        let mut pixi = false;

        if new_command("uv").arg("--version").output().is_ok() {
            uv = true;
        }
        if new_command("poetry").arg("--version").output().is_ok() {
            poetry = true;
        }
        if new_command("pdm").arg("--version").output().is_ok() {
            pdm = true;
        }
        if new_command("conda").arg("--version").output().is_ok() {
            conda = true;
        }
        if new_command("pixi").arg("--version").output().is_ok() {
            pixi = true;
        }

        if !uv || !poetry || !pdm || !conda || !pixi {
            let search_dirs = manager_search_dirs();
            for dir in search_dirs {
                if !uv {
                    let candidate = dir.join(exe_name("uv"));
                    if candidate.exists()
                        && new_command(&candidate).arg("--version").output().is_ok()
                    {
                        uv = true;
                    }
                }
                if !poetry {
                    let candidate = dir.join(exe_name("poetry"));
                    if candidate.exists()
                        && new_command(&candidate).arg("--version").output().is_ok()
                    {
                        poetry = true;
                    }
                }
                if !pdm {
                    let candidate = dir.join(exe_name("pdm"));
                    if candidate.exists()
                        && new_command(&candidate).arg("--version").output().is_ok()
                    {
                        pdm = true;
                    }
                }
                if !conda {
                    let candidate = dir.join(exe_name("conda"));
                    if candidate.exists()
                        && new_command(&candidate).arg("--version").output().is_ok()
                    {
                        conda = true;
                    }
                }
                if !pixi {
                    let candidate = dir.join(exe_name("pixi"));
                    if candidate.exists()
                        && new_command(&candidate).arg("--version").output().is_ok()
                    {
                        pixi = true;
                    }
                }
            }
        }

        ManagerStatus {
            uv,
            poetry,
            pdm,
            conda,
            pixi,
        }
    })
    .await
    .unwrap_or(ManagerStatus {
        uv: false,
        poetry: false,
        pdm: false,
        conda: false,
        pixi: false,
    })
}

/// Returns the shell command line that the user (or `install_uv`) runs to
/// install uv via the official installer.
#[tauri::command]
pub fn uv_install_command() -> String {
    uv_install_command_for_platform(cfg!(windows))
}

fn uv_install_command_for_platform(windows: bool) -> String {
    if windows {
        "powershell -ExecutionPolicy ByPass -NoProfile -Command \"irm https://astral.sh/uv/install.ps1 | iex\"".to_string()
    } else {
        "curl -LsSf https://astral.sh/uv/install.sh | sh".to_string()
    }
}

/// Runs the official uv installer (Astral). On Windows this invokes the
/// PowerShell installer; on macOS / Linux the shell installer.
fn install_uv_job(job: &crate::jobs::BackgroundJobHandle) -> Result<String, String> {
    set_job_progress(job, "Starting uv installer...", Some(0.1));
    #[cfg(windows)]
    {
        let mut cmd = new_command("powershell.exe");
        cmd.args([
            "-ExecutionPolicy",
            "ByPass",
            "-NoProfile",
            "-Command",
            "irm https://astral.sh/uv/install.ps1 | iex",
        ]);
        let out = run_command_with_timeout_and_cancel(&mut cmd, 300, job.cancel.as_ref())?;
        if out.status.success() {
            set_job_progress(job, "uv install finished.", Some(0.95));
            return Ok("uv installed successfully.".to_string());
        }
        let stderr = stdout_or_stderr(&out);
        Err(classify_install_error(format!(
            "uv installer failed: {}",
            stderr.trim()
        )))
    }

    #[cfg(unix)]
    {
        let mut cmd = new_command("sh");
        cmd.args(["-c", "curl -LsSf https://astral.sh/uv/install.sh | sh"]);
        let out = run_command_with_timeout_and_cancel(&mut cmd, 300, job.cancel.as_ref())?;
        if out.status.success() {
            set_job_progress(job, "uv install finished.", Some(0.95));
            return Ok("uv installed successfully.".to_string());
        }
        let stderr = stdout_or_stderr(&out);
        Err(classify_install_error(format!(
            "uv installer failed: {}",
            stderr.trim()
        )))
    }
}

#[tauri::command]
pub fn start_install_uv_job(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let (job_id, job) = create_background_job(&state)?;
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            install_uv_job(&blocking_job).map(serde_json::Value::String)
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

/// Re-run the uv installer with OS-level elevation. UAC on Windows,
/// terminal-with-sudo on macOS / Linux.
#[tauri::command]
#[allow(clippy::needless_return)] // multi-cfg branches require explicit returns
pub async fn install_uv_elevated() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(windows)]
        {
            let inner = "irm https://astral.sh/uv/install.ps1 | iex";
            let outer = format!(
                "$p = Start-Process -FilePath 'powershell.exe' -ArgumentList \
                 '-ExecutionPolicy','ByPass','-NoProfile','-Command','{}' \
                 -Verb RunAs -Wait -PassThru; \
                 if ($p.ExitCode -ne 0) {{ exit $p.ExitCode }}",
                inner.replace('\'', "''")
            );
            let out = new_command("powershell.exe")
                .args(["-NoProfile", "-NonInteractive", "-Command", &outer])
                .output()
                .map_err(|e| format!("Failed to spawn powershell.exe: {}", e))?;
            if out.status.success() {
                return Ok("uv installed successfully (with elevation).".to_string());
            }
            let err = String::from_utf8_lossy(&out.stderr).to_string();
            if err.to_lowercase().contains("operation was canceled") {
                return Err("User declined the elevation prompt. uv was not installed.".to_string());
            }
            return Err(format!("Elevated uv install failed: {}", err.trim()));
        }

        #[cfg(unix)]
        {
            #[cfg(target_os = "linux")]
            let temp_dir = std::env::temp_dir();
            #[cfg(target_os = "linux")]
            let safe_path = temp_dir.to_string_lossy().to_string();

            #[cfg(target_os = "linux")]
            {
                let script = "echo 'Installing uv with sudo...'; sudo sh -c \"curl -LsSf https://astral.sh/uv/install.sh | sh\"; exec bash";
                if new_command("gnome-terminal")
                    .args(["--working-directory", &safe_path, "--", "bash", "-lc", script])
                    .spawn()
                    .is_ok()
                {
                    return Ok("Opened a terminal with sudo. Enter your password to finish installing uv.".to_string());
                }
                if new_command("konsole")
                    .args(["--workdir", &safe_path, "-e", "bash", "-lc", script])
                    .spawn()
                    .is_ok()
                {
                    return Ok("Opened a terminal with sudo. Enter your password to finish installing uv.".to_string());
                }
                if new_command("xterm")
                    .args(["-e", "bash", "-lc", script])
                    .spawn()
                    .is_ok()
                {
                    return Ok("Opened a terminal with sudo. Enter your password to finish installing uv.".to_string());
                }
                return Err(
                    "No supported terminal emulator found on PATH; cannot prompt for sudo.".to_string(),
                );
            }

            #[cfg(target_os = "macos")]
            {
                let inner = "sudo sh -c 'curl -LsSf https://astral.sh/uv/install.sh | sh'";
                let escape_for_applescript = |s: &str| -> String {
                    s.replace('\\', "\\\\").replace('"', "\\\"")
                };
                let script = format!(
                    "tell application \"Terminal\" to do script \"{}\"",
                    escape_for_applescript(inner)
                );
                new_command("osascript")
                    .arg("-e")
                    .arg(script)
                    .spawn()
                    .map_err(|e| format!("Failed to launch Terminal.app: {}", e))?;
                return Ok("Opened Terminal.app with sudo. Enter your password to finish installing uv.".to_string());
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Lists Python versions known to uv: both already-installed and available.
fn list_python_versions_job(
    job: &crate::jobs::BackgroundJobHandle,
) -> Result<Vec<PythonVersion>, String> {
    set_job_progress(job, "Listing Python versions from uv...", Some(0.2));
    let uv_path = get_manager_path("uv");
    let mut cmd = new_command(&uv_path);
    cmd.args(["python", "list", "--all-versions"]);
    let out = match run_command_with_timeout_and_cancel(&mut cmd, 30, job.cancel.as_ref()) {
        Ok(o) => o,
        Err(e) => {
            return Err(format!(
                "uv is required to list Python versions for download. Install uv from the engine selector. ({})",
                e
            ));
        }
    };
    if !out.status.success() {
        return Err(format!(
            "uv python list failed: {}",
            stdout_or_stderr(&out).trim()
        ));
    }
    let text = String::from_utf8_lossy(&out.stdout).to_string();
    set_job_progress(job, "Python version list ready.", Some(0.95));
    Ok(parse_uv_python_list(&text))
}

#[tauri::command]
pub fn start_list_python_versions_job(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let (job_id, job) = create_background_job(&state)?;
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            list_python_versions_job(&blocking_job)
                .and_then(|versions| serde_json::to_value(versions).map_err(|e| e.to_string()))
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

/// Downloads and installs a Python version via `uv python install <version>`.
fn install_python_job(
    version: String,
    job: &crate::jobs::BackgroundJobHandle,
) -> Result<String, String> {
    set_job_progress(job, format!("Installing Python {}...", version), Some(0.1));
    let uv_path = get_manager_path("uv");
    let mut cmd = new_command(&uv_path);
    cmd.args(["python", "install", &version]);
    let out = run_command_with_timeout_and_cancel(&mut cmd, 600, job.cancel.as_ref())?;
    if out.status.success() {
        set_job_progress(
            job,
            format!("Python {} install finished.", version),
            Some(0.95),
        );
        Ok(format!("Python {} installed.", version))
    } else {
        let stderr = stdout_or_stderr(&out);
        Err(classify_install_error(format!(
            "uv python install failed: {}",
            stderr.trim()
        )))
    }
}

#[tauri::command]
pub fn start_install_python_job(
    version: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let (job_id, job) = create_background_job(&state)?;
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            install_python_job(version, &blocking_job).map(serde_json::Value::String)
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

/// Re-run `uv python install` with OS-level elevation. UAC on Windows,
/// terminal-with-sudo on macOS / Linux. Same retry contract as the
/// elevated package installer.
#[tauri::command]
#[allow(clippy::needless_return)] // multi-cfg branches require explicit returns
pub async fn install_python_elevated(version: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let uv_path = get_manager_path("uv");

        #[cfg(windows)]
        {
            let ps = format!(
                "$p = Start-Process -FilePath '{}' -ArgumentList 'python','install','{}' \
                 -Verb RunAs -Wait -PassThru; \
                 if ($p.ExitCode -ne 0) {{ exit $p.ExitCode }}",
                uv_path.replace('\'', "''"),
                version.replace('\'', "''")
            );
            let out = new_command("powershell.exe")
                .args(["-NoProfile", "-NonInteractive", "-Command", &ps])
                .output()
                .map_err(|e| format!("Failed to spawn powershell.exe: {}", e))?;
            if out.status.success() {
                return Ok(format!("Python {} installed (with elevation).", version));
            }
            let err = String::from_utf8_lossy(&out.stderr).to_string();
            if err.to_lowercase().contains("operation was canceled") {
                return Err(
                    "User declined the elevation prompt. Python was not installed.".to_string(),
                );
            }
            return Err(format!("Elevated Python install failed: {}", err.trim()));
        }

        #[cfg(unix)]
        {
            #[cfg(target_os = "linux")]
            let temp_dir = std::env::temp_dir();
            #[cfg(target_os = "linux")]
            let safe_path = temp_dir.to_string_lossy().to_string();

            #[cfg(target_os = "linux")]
            {
                let script = format!(
                    "echo 'Installing Python {ver} with sudo...'; sudo {uv} python install {ver}; exec bash",
                    uv = uv_path.replace(' ', "\\ "),
                    ver = version.replace(' ', "\\ ")
                );
                if new_command("gnome-terminal")
                    .args([
                        "--working-directory",
                        &safe_path,
                        "--",
                        "bash",
                        "-lc",
                        &script,
                    ])
                    .spawn()
                    .is_ok()
                {
                    return Ok("Opened a terminal with sudo. Enter your password to finish installing Python.".to_string());
                }
                if new_command("konsole")
                    .args(["--workdir", &safe_path, "-e", "bash", "-lc", &script])
                    .spawn()
                    .is_ok()
                {
                    return Ok("Opened a terminal with sudo. Enter your password to finish installing Python.".to_string());
                }
                if new_command("xterm")
                    .args(["-e", "bash", "-lc", &script])
                    .spawn()
                    .is_ok()
                {
                    return Ok("Opened a terminal with sudo. Enter your password to finish installing Python.".to_string());
                }
                return Err(
                    "No supported terminal emulator found on PATH; cannot prompt for sudo.".to_string(),
                );
            }

            #[cfg(target_os = "macos")]
            {
                let inner = format!("sudo {} python install {}", uv_path, version);
                let escape = |s: &str| s.replace('\\', "\\\\").replace('"', "\\\"");
                let script = format!(
                    "tell application \"Terminal\" to do script \"{}\"",
                    escape(&inner)
                );
                new_command("osascript")
                    .arg("-e")
                    .arg(script)
                    .spawn()
                    .map_err(|e| format!("Failed to launch Terminal.app: {}", e))?;
                return Ok("Opened Terminal.app with sudo. Enter your password to finish installing Python.".to_string());
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::uv_install_command_for_platform;

    #[test]
    fn uv_install_command_matches_platform_shape() {
        assert!(uv_install_command_for_platform(false).contains("curl -LsSf"));
        assert!(uv_install_command_for_platform(true).contains("powershell"));
        assert!(uv_install_command_for_platform(true).contains("install.ps1"));
    }
}
