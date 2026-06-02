use super::*;
use std::env;
use std::fs;
use std::sync::{Mutex, OnceLock};

fn scan_depth_env_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(())).lock().unwrap()
}

#[test]
fn exe_name_appends_platform_suffix() {
    let got = exe_name("uv");
    if cfg!(windows) {
        assert_eq!(got, "uv.exe");
    } else {
        assert_eq!(got, "uv");
    }
}

#[test]
fn default_python_command_is_platform_aware() {
    let got = default_python_command();
    if cfg!(windows) {
        assert_eq!(got, "python");
    } else {
        assert_eq!(got, "python3");
    }
}

#[test]
fn manager_search_dirs_is_non_empty() {
    let dirs = manager_search_dirs();
    assert!(!dirs.is_empty());
}

#[cfg(target_os = "macos")]
#[test]
fn manager_search_dirs_includes_apple_silicon_brew() {
    let dirs = manager_search_dirs();
    assert!(dirs
        .iter()
        .any(|d| d == &PathBuf::from("/opt/homebrew/bin")));
}

#[test]
fn looks_like_permission_error_matches_common_patterns() {
    assert!(looks_like_permission_error(
        "PermissionError: [Errno 13] Permission denied"
    ));
    assert!(looks_like_permission_error(
        "ERROR: Could not install packages due to an EnvironmentError"
    ));
    assert!(looks_like_permission_error(
        "OSError: [WinError 5] Access is denied"
    ));
    assert!(looks_like_permission_error("error: failed: access denied"));
    assert!(!looks_like_permission_error(
        "ERROR: No matching distribution found"
    ));
    assert!(!looks_like_permission_error(""));
}

#[test]
fn classify_install_error_prefixes_only_permission_failures() {
    let permission =
        classify_install_error("PermissionError: [Errno 13] Permission denied".to_string());
    assert!(permission.starts_with("NEEDS_ELEVATION:"));

    let other = classify_install_error("No matching distribution found".to_string());
    assert_eq!(other, "No matching distribution found");
}

#[test]
fn parse_outdated_handles_pip_format() {
    let raw = br#"[
            {"name": "requests", "version": "2.30.0", "latest_version": "2.31.0"},
            {"name": "numpy", "version": "1.24.0", "latest_version": "1.26.0"}
        ]"#;
    let pkgs = parse_outdated_packages_json(raw).expect("parse ok");
    assert_eq!(pkgs.len(), 2);
    assert_eq!(pkgs[0].name, "requests");
    assert_eq!(pkgs[1].latest_version, "1.26.0");
}

#[test]
fn parse_outdated_handles_uv_kebab_format() {
    let raw = br#"[{"name": "flask", "version": "2.0.0", "latest-version": "3.0.0"}]"#;
    let pkgs = parse_outdated_packages_json(raw).expect("parse ok");
    assert_eq!(pkgs.len(), 1);
    assert_eq!(pkgs[0].latest_version, "3.0.0");
}

#[test]
fn parse_outdated_skips_unnamed_rows() {
    let raw =
        br#"[{"version": "1.0.0"}, {"name": "ok", "version": "1.0.0", "latest_version": "1.1.0"}]"#;
    let pkgs = parse_outdated_packages_json(raw).expect("parse ok");
    assert_eq!(pkgs.len(), 1);
    assert_eq!(pkgs[0].name, "ok");
}

#[test]
fn parse_outdated_rejects_non_array() {
    let raw = br#"{"not": "an array"}"#;
    assert!(parse_outdated_packages_json(raw).is_err());
}

#[test]
fn detect_manager_type_reads_marker_file() {
    let dir = tempdir();
    fs::write(dir.join(ENGINE_MARKER_FILE), "uv").unwrap();
    assert_eq!(detect_manager_type(&dir), "uv");

    fs::write(dir.join(ENGINE_MARKER_FILE), "pip").unwrap();
    assert_eq!(detect_manager_type(&dir), "pip");

    fs::write(dir.join(ENGINE_MARKER_FILE), "garbage").unwrap();
    assert_eq!(detect_manager_type(&dir), "pip");
}

#[test]
fn detect_manager_type_reads_pyvenv_cfg_uv_line() {
    let dir = tempdir();
    let cfg = "home = /usr/bin\nversion = 3.12\nuv = 0.4.0\n";
    fs::write(dir.join("pyvenv.cfg"), cfg).unwrap();
    assert_eq!(detect_manager_type(&dir), "uv");
}

#[test]
fn detect_manager_type_defaults_to_pip() {
    let dir = tempdir();
    assert_eq!(detect_manager_type(&dir), "pip");
}

#[test]
fn detect_manager_type_via_uv_lock() {
    let dir = tempdir();
    fs::write(dir.join("uv.lock"), "").unwrap();
    assert_eq!(detect_manager_type(&dir), "uv");
}

#[test]
fn detect_manager_type_reads_conda_meta() {
    let dir = tempdir();
    fs::create_dir_all(dir.join("conda-meta")).unwrap();
    assert_eq!(detect_manager_type(&dir), "conda");
}

#[test]
fn list_installed_packages_reads_conda_metadata_without_pip() {
    let dir = tempdir();
    fs::write(dir.join("pyvenv.cfg"), "home = /opt/conda\n").unwrap();
    let meta = dir.join("conda-meta");
    fs::create_dir_all(&meta).unwrap();
    fs::write(
        meta.join("numpy-2.0.0.json"),
        r#"{"name":"numpy","version":"2.0.0"}"#,
    )
    .unwrap();
    fs::write(
        meta.join("python-3.12.0.json"),
        r#"{"name":"python","version":"3.12.0"}"#,
    )
    .unwrap();

    let packages = list_installed_packages(&dir).unwrap();
    assert_eq!(
        packages,
        vec!["numpy==2.0.0".to_string(), "python==3.12.0".to_string()]
    );
}

#[test]
fn detect_manager_type_reads_pixi_environment_layout() {
    let dir = tempdir();
    let project = dir.join("project");
    let env = project.join(".pixi").join("envs").join("default");
    fs::create_dir_all(env.join("conda-meta")).unwrap();
    fs::write(project.join("pixi.toml"), "[project]\nname = \"demo\"\n").unwrap();
    assert_eq!(detect_manager_type(&env), "pixi");
}

#[test]
fn get_venv_info_marks_missing_python_binary_as_broken() {
    let dir = tempdir();
    fs::write(dir.join("pyvenv.cfg"), "home = /usr/bin\nversion = 3.12\n").unwrap();
    let info = get_venv_info(&dir).expect("pyvenv.cfg is enough to identify venv");
    assert_eq!(info.status, "Broken");
    assert_eq!(info.issue.as_deref(), Some("Missing Python binary"));
    assert_eq!(info.manager_type, "pip");
}

#[test]
fn scan_max_depth_clamps_low_values() {
    let _guard = scan_depth_env_lock();
    env::set_var("VORCHESTRA_SCAN_MAX_DEPTH", "1");
    assert_eq!(scan_max_depth(), 3);
    env::remove_var("VORCHESTRA_SCAN_MAX_DEPTH");
}

#[test]
fn scan_max_depth_clamps_high_values() {
    let _guard = scan_depth_env_lock();
    env::set_var("VORCHESTRA_SCAN_MAX_DEPTH", "9999");
    assert_eq!(scan_max_depth(), 64);
    env::remove_var("VORCHESTRA_SCAN_MAX_DEPTH");
}

#[test]
fn scan_max_depth_default_when_unset() {
    let _guard = scan_depth_env_lock();
    env::remove_var("VORCHESTRA_SCAN_MAX_DEPTH");
    assert_eq!(scan_max_depth(), 16);
}

#[test]
fn scan_max_depth_default_when_invalid() {
    let _guard = scan_depth_env_lock();
    env::set_var("VORCHESTRA_SCAN_MAX_DEPTH", "not-a-number");
    assert_eq!(scan_max_depth(), 16);
    env::remove_var("VORCHESTRA_SCAN_MAX_DEPTH");
}

#[test]
fn parse_pip_freeze_ignores_comments_and_editable() {
    let raw = "\
# top of file
requests==2.31.0
Numpy==1.26.0
-e /home/u/myproj
flask == 3.0.0  ; python_version >= '3.10'
";
    let map = parse_pip_freeze(raw);
    assert_eq!(map.len(), 3);
    assert_eq!(map.get("requests"), Some(&"2.31.0".to_string()));
    // Numpy normalized to numpy
    assert_eq!(map.get("numpy"), Some(&"1.26.0".to_string()));
    // Spaces around == are tolerated
    assert_eq!(map.get("flask"), Some(&"3.0.0".to_string()));
}

#[test]
fn parse_dependency_tree_json_accepts_nested_fixture() {
    let raw = include_bytes!("../test-fixtures/dependency_tree.json");
    let parsed = parse_dependency_tree_json(raw).expect("valid dependency tree");
    let root = parsed.as_array().unwrap().first().unwrap();
    assert_eq!(root["package_name"], "fastapi");
    assert_eq!(root["dependencies"].as_array().unwrap().len(), 2);
}

#[test]
fn parse_dependency_tree_json_rejects_missing_fields() {
    let err = parse_dependency_tree_json(br#"[{"package_name":"demo"}]"#).unwrap_err();
    assert!(err.contains("installed_version"));
}

#[test]
fn normalize_package_name_collapses_separators() {
    assert_eq!(normalize_package_name("Foo.Bar_baz"), "foo-bar-baz");
    assert_eq!(normalize_package_name("a__b--c"), "a-b-c");
    assert_eq!(normalize_package_name("-already-dash-"), "already-dash");
}

#[test]
fn parse_uv_python_list_marks_installed_vs_available() {
    let raw = "\
cpython-3.13.0-windows-x86_64-none      AppData/Roaming/uv/python/cpython-3.13.0/python.exe
cpython-3.12.7-windows-x86_64-none      <download available>
cpython-3.11.10-linux-x86_64-gnu        /home/u/.local/share/uv/python/cpython-3.11.10/bin/python
";
    let parsed = parse_uv_python_list(raw);
    assert_eq!(parsed.len(), 3);
    // Installed entries first.
    assert!(parsed[0].installed);
    assert!(parsed[1].installed);
    assert!(!parsed[2].installed);
    // Latest installed first.
    assert_eq!(parsed[0].version, "3.13.0");
    assert!(parsed[0].path.is_some());
    // Available entry has no path.
    assert_eq!(parsed[2].version, "3.12.7");
    assert!(parsed[2].path.is_none());
}

#[test]
fn parse_uv_python_list_dedupes_per_version_and_state() {
    // Two installed rows for 3.12.7 (different platform tags) should
    // collapse to one entry; one available row for 3.10.0.
    let raw = "\
cpython-3.12.7-linux-x86_64-gnu         /home/u/p1/python
cpython-3.12.7-linux-aarch64-gnu        /home/u/p2/python
cpython-3.10.0-linux-x86_64-gnu         <download available>
";
    let parsed = parse_uv_python_list(raw);
    assert_eq!(parsed.len(), 2);
    assert_eq!(parsed[0].version, "3.12.7");
    assert_eq!(parsed[1].version, "3.10.0");
}

#[test]
fn parse_uv_python_list_skips_garbage_lines() {
    let raw =
        "\n# comment\nnot-a-python-line\ncpython-3.12.0-linux-x86_64-gnu         /opt/python\n";
    let parsed = parse_uv_python_list(raw);
    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].version, "3.12.0");
}

#[test]
fn parse_security_audit_empty_stdout_returns_clean_error() {
    let out = std::process::Output {
        status: ok_status(),
        stdout: vec![],
        stderr: b"some warning".to_vec(),
    };
    let err = parse_security_audit_json_from_output(&out).unwrap_err();
    assert!(err.contains("no JSON output") || err.contains("no output"));
}

#[test]
fn parse_security_audit_valid_payload() {
    let out = std::process::Output {
        status: ok_status(),
        stdout: br#"{"dependencies": []}"#.to_vec(),
        stderr: vec![],
    };
    let val = parse_security_audit_json_from_output(&out).expect("parse ok");
    assert!(val.get("dependencies").is_some());
}

#[cfg(unix)]
fn ok_status() -> std::process::ExitStatus {
    use std::os::unix::process::ExitStatusExt;
    std::process::ExitStatus::from_raw(0)
}

#[cfg(windows)]
fn ok_status() -> std::process::ExitStatus {
    use std::os::windows::process::ExitStatusExt;
    std::process::ExitStatus::from_raw(0)
}

fn tempdir() -> PathBuf {
    let mut p = env::temp_dir();
    let pid = std::process::id();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    p.push(format!("vorchestra-test-{}-{}", pid, nanos));
    fs::create_dir_all(&p).unwrap();
    p
}
