//! User-facing system integrations: open external terminal at the venv,
//! open VS Code on the project root.

use crate::helpers::{ensure_venv_dir, get_python_path, new_command};
use std::path::Path;

#[tauri::command]
pub fn open_terminal(path: String) -> Result<(), String> {
    let venv = ensure_venv_dir(&path)?;
    let safe_path = venv.to_string_lossy().to_string();
    #[cfg(target_os = "linux")]
    {
        let terminal_commands = [
            ("gnome-terminal", vec!["--working-directory"]),
            ("konsole", vec!["--workdir"]),
            ("xfce4-terminal", vec!["--working-directory"]),
            ("xterm", vec!["-cd"]),
        ];
        let mut started = false;
        for (term, args) in terminal_commands {
            let mut cmd = new_command(term);
            for arg in &args {
                cmd.arg(arg);
            }
            cmd.arg(&safe_path);
            if cmd.spawn().is_ok() {
                started = true;
                break;
            }
        }
        if !started {
            return Err(
                "No supported terminal emulator found on PATH. Install one of: \
                        gnome-terminal, konsole, xfce4-terminal, xterm."
                    .to_string(),
            );
        }
    }
    #[cfg(target_os = "windows")]
    {
        new_command("cmd")
            .args(["/c", "start", "cmd.exe", "/k", "cd", "/d", &safe_path])
            .spawn()
            .map_err(|e| format!("Failed to launch cmd.exe: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        new_command("open")
            .args(["-a", "Terminal", &safe_path])
            .spawn()
            .map_err(|e| format!("Failed to launch Terminal.app: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
#[allow(clippy::needless_return)] // multi-cfg branches require explicit returns
pub fn open_terminal_with_venv_command(path: String, command: String) -> Result<(), String> {
    let venv = ensure_venv_dir(&path)?;
    let terminal_command = validate_terminal_venv_command(&venv, &command)?;
    let safe_path = venv.to_string_lossy().to_string();

    #[cfg(target_os = "linux")]
    {
        // bash -c "$SCRIPT" ARG0 ARG1 ... — positional args avoid interpolating
        // `command` into the script string. The command is still shell-evaluated
        // (that is the purpose of this function), but cannot break out of the
        // wrapper or be smuggled into other terminal arguments.
        let script = r#"cd "$0" && source "$0/bin/activate" && eval "$1"; exec bash"#;

        let try_spawn = |bin: &str, prefix_args: &[&str]| -> bool {
            let mut cmd = new_command(bin);
            cmd.args(prefix_args);
            cmd.args(["bash", "-lc", script, &safe_path, &terminal_command]);
            cmd.spawn().is_ok()
        };

        if try_spawn("gnome-terminal", &["--working-directory", &safe_path, "--"]) {
            return Ok(());
        }
        if try_spawn("konsole", &["--workdir", &safe_path, "-e"]) {
            return Ok(());
        }
        if new_command("xfce4-terminal")
            .args(["--working-directory", &safe_path, "--disable-server", "-e"])
            .args(["bash", "-lc", script, &safe_path, &terminal_command])
            .spawn()
            .is_ok()
        {
            return Ok(());
        }
        if new_command("xterm")
            .args(["-e", "bash", "-lc", script, &safe_path, &terminal_command])
            .current_dir(&safe_path)
            .spawn()
            .is_ok()
        {
            return Ok(());
        }
        return Err("No supported terminal emulator found on PATH".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let activate = format!("{}\\Scripts\\activate.bat", safe_path);
        new_command("cmd")
            .args(["/c", "start", "", "cmd.exe", "/k"])
            .arg(format!("\"{}\" && {}", activate, terminal_command))
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        let sq_escape = |s: &str| -> String { format!("'{}'", s.replace('\'', "'\\''")) };
        let quoted_path = sq_escape(&safe_path);
        let bash_oneliner = format!(
            "cd {p} && source {p}/bin/activate && {c}",
            p = quoted_path,
            c = terminal_command,
        );
        let escape_for_applescript =
            |s: &str| -> String { s.replace('\\', "\\\\").replace('"', "\\\"") };
        let script = format!(
            "tell application \"Terminal\" to do script \"{}\"",
            escape_for_applescript(&bash_oneliner)
        );
        new_command("osascript")
            .arg("-e")
            .arg(script)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
}

fn validate_terminal_venv_command(venv: &Path, command: &str) -> Result<String, String> {
    let trimmed = command.trim();
    if matches!(trimmed, "pip install pipdeptree" | "pip install pip-audit") {
        return Ok(trimmed.to_string());
    }

    let python = get_python_path(venv).to_string_lossy().to_string();
    for tool in ["pipdeptree", "pip-audit"] {
        let expected_uv = format!("uv pip install --python \"{}\" {}", python, tool);
        if trimmed == expected_uv {
            return Ok(expected_uv);
        }
    }

    Err("Refusing to open a terminal with an unsupported command.".to_string())
}

/// Opens the user's preferred terminal already cd'd into the venv parent
/// with the venv activated and an interactive shell ready. Mirrors
/// `poetry shell` / `pipenv shell`. No command is executed beyond the
/// activation script — useful for "Activate" buttons.
#[tauri::command]
#[allow(clippy::needless_return)] // multi-cfg branches require explicit returns
pub fn open_terminal_activated(path: String) -> Result<(), String> {
    let venv = ensure_venv_dir(&path)?;
    let safe_path = venv.to_string_lossy().to_string();

    #[cfg(target_os = "linux")]
    {
        let script = r#"cd "$0" && source "$0/bin/activate"; exec bash"#;
        let try_spawn = |bin: &str, prefix_args: &[&str]| -> bool {
            let mut cmd = new_command(bin);
            cmd.args(prefix_args);
            cmd.args(["bash", "-lc", script, &safe_path]);
            cmd.spawn().is_ok()
        };
        if try_spawn("gnome-terminal", &["--working-directory", &safe_path, "--"]) {
            return Ok(());
        }
        if try_spawn("konsole", &["--workdir", &safe_path, "-e"]) {
            return Ok(());
        }
        if new_command("xfce4-terminal")
            .args(["--working-directory", &safe_path, "--disable-server", "-e"])
            .args(["bash", "-lc", script, &safe_path])
            .spawn()
            .is_ok()
        {
            return Ok(());
        }
        if new_command("xterm")
            .args(["-e", "bash", "-lc", script, &safe_path])
            .current_dir(&safe_path)
            .spawn()
            .is_ok()
        {
            return Ok(());
        }
        return Err("No supported terminal emulator found on PATH".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let activate = format!("{}\\Scripts\\activate.bat", safe_path);
        new_command("cmd")
            .args(["/c", "start", "", "cmd.exe", "/k"])
            .arg(format!("\"{}\"", activate))
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        let sq_escape = |s: &str| -> String { format!("'{}'", s.replace('\'', "'\\''")) };
        let bash_oneliner = format!(
            "cd {p} && source {p}/bin/activate",
            p = sq_escape(&safe_path),
        );
        let escape_for_applescript =
            |s: &str| -> String { s.replace('\\', "\\\\").replace('"', "\\\"") };
        let script = format!(
            "tell application \"Terminal\" to do script \"{}\"",
            escape_for_applescript(&bash_oneliner)
        );
        new_command("osascript")
            .arg("-e")
            .arg(script)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
}

fn normalize_docker_image_tag(raw: &str) -> String {
    let mut tag = String::new();
    let mut last_was_sep = false;

    for ch in raw.trim().chars().flat_map(|ch| ch.to_lowercase()) {
        let mapped = if ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-' {
            ch
        } else {
            '-'
        };

        if mapped == '-' || mapped == '.' || mapped == '_' {
            if tag.is_empty() || last_was_sep {
                continue;
            }
            last_was_sep = true;
        } else {
            last_was_sep = false;
        }
        tag.push(mapped);
    }

    let trimmed = tag.trim_matches(['-', '.', '_']).to_string();
    if trimmed.is_empty() {
        "vorchestra-app".to_string()
    } else {
        trimmed.chars().take(128).collect()
    }
}

/// Opens the user's terminal at the project root with a docker
/// build-and-run pipeline ready to execute. Mirrors what a developer
/// would type by hand:
///
///   docker build -t <image_tag> .
///   docker run --rm -it <image_tag>
///
/// The command is built but run inside the terminal so the user sees
/// the build output and can ctrl-c. We do not require docker to be
/// installed up-front; the terminal will report the error if it is
/// missing.
#[tauri::command]
#[allow(clippy::needless_return)] // multi-cfg branches require explicit returns
pub fn run_docker_for_venv(path: String, image_tag: String) -> Result<(), String> {
    let venv = ensure_venv_dir(&path)?;
    let project_root = venv.parent().unwrap_or(&venv).to_path_buf();
    let project_path = project_root.to_string_lossy().to_string();
    let raw_tag = if image_tag.trim().is_empty() {
        venv.file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "vorchestra-app".to_string())
    } else {
        image_tag.trim().to_string()
    };
    let tag = normalize_docker_image_tag(&raw_tag);

    #[cfg(target_os = "linux")]
    {
        // bash -c '<script>' ARG_PATH ARG_TAG — positional args avoid
        // interpolating image-tag / paths into the literal.
        let script = r#"cd "$0" && echo "Building docker image $1..." && docker build -t "$1" . && echo "Running $1..." && docker run --rm -it "$1"; exec bash"#;
        let try_spawn = |bin: &str, prefix_args: &[&str]| -> bool {
            let mut cmd = new_command(bin);
            cmd.args(prefix_args);
            cmd.args(["bash", "-lc", script, &project_path, &tag]);
            cmd.spawn().is_ok()
        };
        if try_spawn(
            "gnome-terminal",
            &["--working-directory", &project_path, "--"],
        ) {
            return Ok(());
        }
        if try_spawn("konsole", &["--workdir", &project_path, "-e"]) {
            return Ok(());
        }
        if new_command("xterm")
            .args(["-e", "bash", "-lc", script, &project_path, &tag])
            .current_dir(&project_path)
            .spawn()
            .is_ok()
        {
            return Ok(());
        }
        return Err("No supported terminal emulator found on PATH".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let cmdline = format!(
            "cd /d \"{}\" && docker build -t {} . && docker run --rm -it {}",
            project_path, tag, tag
        );
        new_command("cmd")
            .args(["/c", "start", "", "cmd.exe", "/k", &cmdline])
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        let sq = |s: &str| format!("'{}'", s.replace('\'', "'\\''"));
        let inner = format!(
            "cd {p} && docker build -t {t} . && docker run --rm -it {t}",
            p = sq(&project_path),
            t = sq(&tag),
        );
        let escape = |s: &str| s.replace('\\', "\\\\").replace('"', "\\\"");
        let script = format!(
            "tell application \"Terminal\" to do script \"{}\"",
            escape(&inner)
        );
        new_command("osascript")
            .arg("-e")
            .arg(script)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
}

#[tauri::command]
pub fn open_in_vscode(path: String) -> Result<(), String> {
    let pb = ensure_venv_dir(&path)?;
    let parent = pb.parent().unwrap_or(&pb).to_string_lossy().to_string();

    let spawn_result = {
        #[cfg(target_os = "windows")]
        {
            new_command("cmd").args(["/c", "code", &parent]).spawn()
        }
        #[cfg(not(target_os = "windows"))]
        {
            new_command("code").arg(&parent).spawn()
        }
    };

    spawn_result.map_err(|e| {
        format!(
            "Could not launch VS Code: {}. Make sure the `code` CLI is installed and on PATH \
             (in VS Code: Command Palette \u{2192} \"Shell Command: Install 'code' command in PATH\").",
            e
        )
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_docker_image_tag_sanitizes_invalid_names() {
        assert_eq!(normalize_docker_image_tag("My Env 3.12"), "my-env-3.12");
        assert_eq!(normalize_docker_image_tag("__demo__"), "demo");
        assert_eq!(normalize_docker_image_tag("!!!"), "vorchestra-app");
    }

    #[test]
    fn normalize_docker_image_tag_limits_length() {
        let raw = "a".repeat(200);
        assert_eq!(normalize_docker_image_tag(&raw).len(), 128);
    }

    #[test]
    fn validate_terminal_venv_command_allows_known_install_helpers() {
        let venv = std::path::Path::new("/tmp/demo/.venv");
        assert_eq!(
            validate_terminal_venv_command(venv, "  pip install pipdeptree  ").unwrap(),
            "pip install pipdeptree"
        );
        assert_eq!(
            validate_terminal_venv_command(venv, "pip install pip-audit").unwrap(),
            "pip install pip-audit"
        );
        assert_eq!(
            validate_terminal_venv_command(
                venv,
                "uv pip install --python \"/tmp/demo/.venv/bin/python\" pip-audit"
            )
            .unwrap(),
            "uv pip install --python \"/tmp/demo/.venv/bin/python\" pip-audit"
        );
        assert_eq!(
            validate_terminal_venv_command(
                venv,
                "uv pip install --python \"/tmp/demo/.venv/bin/python\" pipdeptree"
            )
            .unwrap(),
            "uv pip install --python \"/tmp/demo/.venv/bin/python\" pipdeptree"
        );
    }

    #[test]
    fn validate_terminal_venv_command_rejects_unknown_shell() {
        let venv = std::path::Path::new("/tmp/demo/.venv");
        assert!(
            validate_terminal_venv_command(venv, "pip install pipdeptree && rm -rf /").is_err()
        );
        assert!(validate_terminal_venv_command(venv, "python -c 'print(1)'").is_err());
    }
}
