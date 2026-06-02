//! Cross-cutting utilities used by command modules: path helpers, child
//! process spawning with platform-aware defaults, Python parser reexports, and
//! permission-error classification. Functions here have no Tauri or app
//! state dependency; they are pure utilities.

pub use crate::dependency_tree::{
    build_dependency_tree_with_python_and_cancel, parse_dependency_tree_json,
};
pub use crate::process_utils::{
    default_python_command, exe_name, new_command, run_command_with_timeout,
    run_command_with_timeout_and_cancel, stdout_or_stderr,
};
pub use crate::python_parsers::{
    normalize_package_name, parse_outdated_packages_json, parse_pip_freeze,
    parse_security_audit_json_from_output, parse_uv_python_list,
};
use crate::types::{VenvInfo, ENGINE_MARKER_FILE};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

// -- Venv paths -------------------------------------------------------------

pub fn get_pip_path(venv_path: &Path) -> PathBuf {
    let mut p = venv_path.to_path_buf();
    #[cfg(windows)]
    p.push("Scripts/pip.exe");
    #[cfg(not(windows))]
    p.push("bin/pip");
    p
}

pub fn get_python_path(venv_path: &Path) -> PathBuf {
    let mut p = venv_path.to_path_buf();
    #[cfg(windows)]
    p.push("Scripts/python.exe");
    #[cfg(not(windows))]
    p.push("bin/python");
    p
}

pub fn canonicalize_dir(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    let canon = fs::canonicalize(&p).map_err(|_| format!("Path not found: {}", path))?;
    if !canon.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }
    Ok(canon)
}

pub fn is_valid_venv_dir(path: &Path) -> bool {
    path.join("pyvenv.cfg").exists() || get_python_path(path).exists()
}

pub fn ensure_venv_dir(path: &str) -> Result<PathBuf, String> {
    let canon = canonicalize_dir(path)?;
    if !is_valid_venv_dir(&canon) {
        return Err("Invalid virtual environment path".to_string());
    }
    Ok(canon)
}

pub fn uv_cache_dir_for(base: &Path) -> String {
    base.join(".uv-cache").to_string_lossy().to_string()
}

pub fn persist_engine_marker(venv_path: &Path, engine: &str) {
    let marker = venv_path.join(ENGINE_MARKER_FILE);
    let _ = fs::write(marker, engine);
}

pub fn detect_manager_type(venv_path: &Path) -> String {
    let marker = venv_path.join(ENGINE_MARKER_FILE);
    if let Ok(raw) = fs::read_to_string(&marker) {
        let value = raw.trim().to_lowercase();
        if value == "uv" || value == "pip" {
            return value;
        }
    }

    if is_pixi_environment(venv_path) {
        return "pixi".to_string();
    }

    if venv_path.join("conda-meta").is_dir() {
        return "conda".to_string();
    }

    // uv-created venvs write "uv = <version>" into pyvenv.cfg.
    let cfg_path = venv_path.join("pyvenv.cfg");
    if let Ok(cfg) = fs::read_to_string(cfg_path) {
        if cfg
            .lines()
            .any(|line| line.trim_start().starts_with("uv ="))
        {
            return "uv".to_string();
        }
    }

    if venv_path.join("uv.lock").exists()
        || venv_path
            .parent()
            .is_some_and(|parent| parent.join("uv.lock").exists())
    {
        return "uv".to_string();
    }

    "pip".to_string()
}

fn is_pixi_environment(venv_path: &Path) -> bool {
    let mut saw_pixi_dir = false;
    for component in venv_path.components() {
        if component.as_os_str() == ".pixi" {
            saw_pixi_dir = true;
            break;
        }
    }
    if !saw_pixi_dir {
        return false;
    }

    if venv_path.join("conda-meta").is_dir() {
        return true;
    }

    venv_path
        .ancestors()
        .any(|ancestor| ancestor.join("pixi.toml").exists())
}

pub fn get_venv_info(p: &Path) -> Option<VenvInfo> {
    if !p.is_dir() {
        return None;
    }
    let cfg_path = p.join("pyvenv.cfg");
    let bin_path = get_python_path(p);

    if cfg_path.exists() || bin_path.exists() {
        let mut status = "Healthy".to_string();
        let mut issue = None;
        let mut version = "Unknown".to_string();
        let last_modified = p
            .metadata()
            .and_then(|m| m.modified())
            .map(|t| {
                t.duration_since(UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0)
            })
            .unwrap_or(0);

        if !bin_path.exists() {
            status = "Broken".to_string();
            issue = Some("Missing Python binary".to_string());
        } else {
            let version_output = new_command(&bin_path).arg("--version").output();
            match version_output {
                Ok(out) if out.status.success() => {
                    let parsed = if out.stdout.is_empty() {
                        String::from_utf8_lossy(&out.stderr).trim().to_string()
                    } else {
                        String::from_utf8_lossy(&out.stdout).trim().to_string()
                    };
                    if !parsed.is_empty() {
                        version = parsed;
                    }
                }
                _ => {
                    status = "Broken".to_string();
                    issue = Some("Interpreter corrupted".to_string());
                }
            }
        }
        let manager_type = detect_manager_type(p);

        return Some(VenvInfo {
            name: p
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string(),
            path: p.to_string_lossy().to_string(),
            version,
            status,
            issue,
            last_modified,
            manager_type,
            template_name: None,
        });
    }
    None
}

// -- Manager search & elevation classification ------------------------------

/// Common locations to look for managers (`uv`, `poetry`, `pdm`) when they
/// are not on `PATH`. Tailored per OS so a Brew-installed binary on Apple
/// Silicon (`/opt/homebrew/bin`) or a Windows binary in `~\.cargo\bin\uv.exe`
/// is found.
pub fn manager_search_dirs() -> Vec<PathBuf> {
    let mut dirs_list = Vec::new();

    #[cfg(unix)]
    {
        dirs_list.push(PathBuf::from("/usr/local/bin"));
        dirs_list.push(PathBuf::from("/usr/bin"));
        dirs_list.push(PathBuf::from("/bin"));
    }

    #[cfg(target_os = "macos")]
    {
        // Apple Silicon Homebrew default prefix.
        dirs_list.push(PathBuf::from("/opt/homebrew/bin"));
    }

    if let Some(home) = dirs::home_dir() {
        dirs_list.push(home.join(".local").join("bin"));
        dirs_list.push(home.join(".cargo").join("bin"));
        dirs_list.push(home.join("bin"));
        dirs_list.push(home.join(".local").join("share").join("uv").join("bin"));

        #[cfg(windows)]
        {
            dirs_list.push(home.join("scoop").join("shims"));
        }
    }

    dirs_list
}

pub fn get_manager_path(cmd: &str) -> String {
    // Check global PATH (Command::new respects PATHEXT on Windows, so
    // `new_command("uv")` resolves to `uv.exe` automatically.)
    if new_command(cmd).arg("--version").output().is_ok() {
        return cmd.to_string();
    }

    // Manual search through common install locations.
    for dir in manager_search_dirs() {
        let candidate = dir.join(exe_name(cmd));
        if candidate.exists() && new_command(&candidate).arg("--version").output().is_ok() {
            return candidate.to_string_lossy().to_string();
        }
    }
    cmd.to_string()
}

/// Heuristically detects "needs admin/sudo" failure patterns in command
/// output. pip / uv emit different strings depending on platform but they
/// converge on a small set of phrases when the OS denies a write.
pub fn looks_like_permission_error(text: &str) -> bool {
    let lower = text.to_lowercase();
    [
        "permission denied",
        "access is denied",
        "access denied",
        "[errno 13]",
        "[winerror 5]",
        "[winerror 32]",
        "operation not permitted",
        "could not install packages due to an environmenterror",
        "consider using the `--user`",
        "consider using the `--break-system-packages`",
        "errno 1] operation not permitted",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

/// Wraps a stderr blob with the `NEEDS_ELEVATION:` prefix when it looks
/// like a permission failure so the frontend can offer a retry-with-admin
/// path. Otherwise returns the original message untouched.
pub fn classify_install_error(stderr_text: String) -> String {
    if looks_like_permission_error(&stderr_text) {
        format!("NEEDS_ELEVATION: {}", stderr_text)
    } else {
        stderr_text
    }
}

// -- Disk size --------------------------------------------------------------

pub fn safe_dir_size_mb(root: &Path, max_entries: usize) -> f64 {
    let mut total_bytes: u64 = 0;

    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
        .take(max_entries)
    {
        let p = entry.path();
        if let Ok(meta) = fs::symlink_metadata(p) {
            if meta.file_type().is_file() {
                total_bytes = total_bytes.saturating_add(meta.len());
            }
        }
    }

    (total_bytes as f64) / 1024.0 / 1024.0
}

pub fn scan_max_depth() -> usize {
    std::env::var("VORCHESTRA_SCAN_MAX_DEPTH")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .map(|v| v.clamp(3, 64))
        .unwrap_or(16)
}

// -- Python introspection scripts (for package listing & dependency tree) ---

pub fn list_installed_packages(venv: &Path) -> Result<Vec<String>, String> {
    if matches!(detect_manager_type(venv).as_str(), "conda" | "pixi") {
        let native = list_conda_meta_packages(venv)?;
        if !native.is_empty() {
            return Ok(native);
        }
    }

    let python = get_python_path(venv);
    let script = r#"import importlib.metadata as m
import json
pkgs = []
for d in m.distributions():
    name = d.metadata.get("Name") or d.metadata.get("name") or d.name
    if name:
        suffix = ""
        try:
            direct_url_raw = d.read_text("direct_url.json")
            if direct_url_raw:
                direct_url = json.loads(direct_url_raw)
                if direct_url.get("dir_info", {}).get("editable"):
                    source = direct_url.get("url") or "local project"
                    if source.startswith("file://"):
                        source = source[7:]
                    suffix = f" (editable: {source})"
        except Exception:
            pass
        pkgs.append(f"{name}=={d.version}{suffix}")
for line in sorted(set(pkgs), key=lambda s: s.lower()):
    print(line)
"#;
    let mut cmd = new_command(python);
    cmd.args(["-c", script]);
    let output = run_command_with_timeout(&mut cmd, 120)?;
    if !output.status.success() {
        return Err(format!(
            "Failed to list packages: {}",
            stdout_or_stderr(&output).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|s| s.to_string())
        .collect())
}

fn list_conda_meta_packages(venv: &Path) -> Result<Vec<String>, String> {
    #[derive(serde::Deserialize)]
    struct CondaPackageMeta {
        name: Option<String>,
        version: Option<String>,
    }

    let meta_dir = venv.join("conda-meta");
    if !meta_dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut packages = Vec::new();
    let entries =
        fs::read_dir(&meta_dir).map_err(|e| format!("Failed to read conda metadata: {}", e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read conda metadata entry: {}", e))?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let raw = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read conda package metadata: {}", e))?;
        let meta: CondaPackageMeta = serde_json::from_str(&raw)
            .map_err(|e| format!("Failed to parse conda package metadata: {}", e))?;
        if let (Some(name), Some(version)) = (meta.name, meta.version) {
            if !name.trim().is_empty() && !version.trim().is_empty() {
                packages.push(format!("{}=={}", name.trim(), version.trim()));
            }
        }
    }

    packages.sort_by_key(|pkg| pkg.to_lowercase());
    packages.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    Ok(packages)
}

// -- Shell-quote helper used by integrations and elevated installs ----------

/// POSIX-style single-quote escape: wraps the string in single quotes,
/// escaping any embedded singles. Safe for `bash -c` argv passing.
#[cfg(not(windows))]
pub fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Helper used by elevated installs on Unix to open the user's preferred
/// terminal already cd'd into the venv parent and running the supplied
/// command. Mirrors the user-facing terminal launcher but is internal so
/// we can invoke it from non-command contexts.
#[cfg(not(windows))]
pub fn open_terminal_with_command_internal(venv: &Path, command: &str) -> Result<(), String> {
    let safe_path = venv.to_string_lossy().to_string();

    #[cfg(target_os = "linux")]
    {
        let script = r#"cd "$0" && source "$0/bin/activate" && eval "$1"; exec bash"#;
        let try_spawn = |bin: &str, prefix_args: &[&str]| -> bool {
            let mut cmd = new_command(bin);
            cmd.args(prefix_args);
            cmd.args(["bash", "-lc", script, &safe_path, command]);
            cmd.spawn().is_ok()
        };
        if try_spawn("gnome-terminal", &["--working-directory", &safe_path, "--"]) {
            return Ok(());
        }
        if try_spawn("konsole", &["--workdir", &safe_path, "-e"]) {
            return Ok(());
        }
        if new_command("xterm")
            .args(["-e", "bash", "-lc", script, &safe_path, command])
            .current_dir(&safe_path)
            .spawn()
            .is_ok()
        {
            return Ok(());
        }
        Err("No supported terminal emulator found on PATH".to_string())
    }

    #[cfg(target_os = "macos")]
    {
        let bash_oneliner = format!(
            "cd {p} && source {p}/bin/activate && {c}",
            p = shell_quote(&safe_path),
            c = command,
        );
        let escape = |s: &str| s.replace('\\', "\\\\").replace('"', "\\\"");
        let script = format!(
            "tell application \"Terminal\" to do script \"{}\"",
            escape(&bash_oneliner)
        );
        new_command("osascript")
            .arg("-e")
            .arg(script)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(test)]
#[path = "helpers_tests.rs"]
mod tests;
