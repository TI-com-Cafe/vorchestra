//! pip/uv package mutation primitives shared by package commands and venv setup.

use std::sync::atomic::AtomicBool;

use crate::helpers::{
    classify_install_error, ensure_venv_dir, get_manager_path, get_python_path, new_command,
    run_command_with_timeout, run_command_with_timeout_and_cancel, uv_cache_dir_for,
};

/// Optional flags accepted by package install. Unknown / missing fields
/// default safely (no extra args appended).
#[derive(Default, Clone)]
pub struct InstallOptions {
    pub index_url: Option<String>,
    pub extra_index_url: Option<String>,
    pub editable: bool,
}

pub fn install_dependency_internal(
    venv_path: String,
    package: String,
    engine: String,
) -> Result<String, String> {
    install_dependency_with_options_internal(venv_path, package, engine, InstallOptions::default())
}

pub fn install_dependency_with_options_internal(
    venv_path: String,
    package: String,
    engine: String,
    opts: InstallOptions,
) -> Result<String, String> {
    install_dependency_with_cancel_internal(venv_path, package, engine, opts, None)
}

pub fn install_dependency_with_cancel_internal(
    venv_path: String,
    package: String,
    engine: String,
    opts: InstallOptions,
    cancel: Option<&AtomicBool>,
) -> Result<String, String> {
    let venv = ensure_venv_dir(&venv_path)?;
    ensure_mutable_engine(&engine)?;

    if engine == "uv" {
        let uv_path = get_manager_path("uv");
        let python_path = get_python_path(&venv);
        let mut cmd = new_command(uv_path);
        cmd.env("UV_CACHE_DIR", uv_cache_dir_for(&venv));
        cmd.args(["pip", "install", "--python"]).arg(&python_path);
        append_install_options(&mut cmd, &opts);
        cmd.arg(&package);

        let output = run_with_optional_cancel(&mut cmd, 600, cancel)?;
        if output.status.success() {
            return Ok(format!("uv installed {}", package));
        }
        return Err(classify_install_error(
            String::from_utf8_lossy(&output.stderr).to_string(),
        ));
    }

    let python = get_python_path(&venv);
    let mut cmd = new_command(python);
    cmd.args(["-m", "pip", "install"]);
    append_install_options(&mut cmd, &opts);
    cmd.arg(&package);

    let output = run_with_optional_cancel(&mut cmd, 600, cancel)?;
    if output.status.success() {
        Ok(format!("Installed {}", package))
    } else {
        Err(classify_install_error(
            String::from_utf8_lossy(&output.stderr).to_string(),
        ))
    }
}

pub fn uninstall_package_internal(
    venv_path: String,
    package: String,
    engine: String,
    cancel: Option<&AtomicBool>,
) -> Result<String, String> {
    let venv = ensure_venv_dir(&venv_path)?;
    ensure_mutable_engine(&engine)?;
    if engine == "uv" {
        let uv_path = get_manager_path("uv");
        let python_path = get_python_path(&venv);
        let mut cmd = new_command(uv_path);
        cmd.env("UV_CACHE_DIR", uv_cache_dir_for(&venv));
        cmd.args(["pip", "uninstall", "--python"])
            .arg(&python_path)
            .args(["-y", &package]);
        let out = run_with_optional_cancel(&mut cmd, 300, cancel)?;
        if out.status.success() {
            return Ok(format!("uv uninstalled {}", package));
        }
        return Err(classify_install_error(
            String::from_utf8_lossy(&out.stderr).to_string(),
        ));
    }

    let python = get_python_path(&venv);
    let mut cmd = new_command(python);
    cmd.args(["-m", "pip", "uninstall", "-y", &package]);
    let out = run_with_optional_cancel(&mut cmd, 300, cancel)?;
    if out.status.success() {
        Ok(format!("Uninstalled {}", package))
    } else {
        Err(classify_install_error(
            String::from_utf8_lossy(&out.stderr).to_string(),
        ))
    }
}

pub fn update_package_internal(
    venv_path: String,
    package: String,
    engine: String,
    cancel: Option<&AtomicBool>,
) -> Result<String, String> {
    let venv = ensure_venv_dir(&venv_path)?;
    ensure_mutable_engine(&engine)?;
    if engine == "uv" {
        let uv_path = get_manager_path("uv");
        let python_path = get_python_path(&venv);
        let mut cmd = new_command(uv_path);
        cmd.env("UV_CACHE_DIR", uv_cache_dir_for(&venv));
        cmd.args(["pip", "install", "--upgrade", "--python"])
            .arg(&python_path)
            .arg(&package);
        let out = run_with_optional_cancel(&mut cmd, 600, cancel)?;
        if out.status.success() {
            return Ok(format!("uv updated {}", package));
        }
        return Err(classify_install_error(
            String::from_utf8_lossy(&out.stderr).to_string(),
        ));
    }

    let python = get_python_path(&venv);
    let mut cmd = new_command(python);
    cmd.args(["-m", "pip", "install", "--upgrade", &package]);
    let out = run_with_optional_cancel(&mut cmd, 600, cancel)?;
    if out.status.success() {
        Ok(format!("Updated {}", package))
    } else {
        Err(classify_install_error(
            String::from_utf8_lossy(&out.stderr).to_string(),
        ))
    }
}

pub fn install_program_and_args(
    venv_path: &str,
    package: &str,
    engine: &str,
    opts: &InstallOptions,
) -> Result<(String, Vec<String>), String> {
    let venv = ensure_venv_dir(venv_path)?;
    ensure_mutable_engine(engine)?;
    let mut common: Vec<String> = Vec::new();
    if let Some(url) = opts.index_url.as_deref().filter(|s| !s.is_empty()) {
        common.push("--index-url".into());
        common.push(url.into());
    }
    if let Some(url) = opts.extra_index_url.as_deref().filter(|s| !s.is_empty()) {
        common.push("--extra-index-url".into());
        common.push(url.into());
    }
    if opts.editable {
        common.push("-e".into());
    }

    if engine == "uv" {
        let uv = get_manager_path("uv");
        let py = get_python_path(&venv);
        let mut args = vec![
            "pip".into(),
            "install".into(),
            "--python".into(),
            py.to_string_lossy().into_owned(),
        ];
        args.extend(common);
        args.push(package.to_string());
        Ok((uv, args))
    } else {
        let python = get_python_path(&venv);
        let mut args: Vec<String> = vec!["-m".into(), "pip".into(), "install".into()];
        args.extend(common);
        args.push(package.to_string());
        Ok((python.to_string_lossy().into_owned(), args))
    }
}

fn ensure_mutable_engine(engine: &str) -> Result<(), String> {
    if engine == "pip" || engine == "uv" {
        Ok(())
    } else {
        Err(format!(
            "{} environments are read-only in VOrchestra. Use the native manager for package changes.",
            engine
        ))
    }
}

fn append_install_options(cmd: &mut std::process::Command, opts: &InstallOptions) {
    if let Some(url) = opts.index_url.as_deref().filter(|s| !s.is_empty()) {
        cmd.args(["--index-url", url]);
    }
    if let Some(url) = opts.extra_index_url.as_deref().filter(|s| !s.is_empty()) {
        cmd.args(["--extra-index-url", url]);
    }
    if opts.editable {
        cmd.arg("-e");
    }
}

fn run_with_optional_cancel(
    cmd: &mut std::process::Command,
    timeout_secs: u64,
    cancel: Option<&AtomicBool>,
) -> Result<std::process::Output, String> {
    if let Some(cancel) = cancel {
        run_command_with_timeout_and_cancel(cmd, timeout_secs, cancel)
    } else {
        run_command_with_timeout(cmd, timeout_secs)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fake_venv() -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("vorchestra-package-ops-{}", suffix));
        if cfg!(windows) {
            fs::create_dir_all(root.join("Scripts")).unwrap();
        } else {
            fs::create_dir_all(root.join("bin")).unwrap();
        }
        fs::write(root.join("pyvenv.cfg"), "home = /usr/bin\n").unwrap();
        root
    }

    fn expected_python_suffix() -> &'static str {
        if cfg!(windows) {
            "Scripts\\python.exe"
        } else {
            "bin/python"
        }
    }

    #[test]
    fn install_program_and_args_builds_pip_command_with_indexes() {
        let venv = fake_venv();
        let opts = InstallOptions {
            index_url: Some("https://pypi.org/simple".to_string()),
            extra_index_url: Some("https://example.test/simple".to_string()),
            editable: true,
        };

        let (program, args) =
            install_program_and_args(venv.to_str().unwrap(), "../project", "pip", &opts).unwrap();

        assert!(program.ends_with(expected_python_suffix()));
        assert_eq!(
            args,
            vec![
                "-m",
                "pip",
                "install",
                "--index-url",
                "https://pypi.org/simple",
                "--extra-index-url",
                "https://example.test/simple",
                "-e",
                "../project"
            ]
        );
        let _ = fs::remove_dir_all(venv);
    }

    #[test]
    fn install_program_and_args_builds_uv_command_with_python_target() {
        let venv = fake_venv();
        let opts = InstallOptions::default();

        let (_program, args) =
            install_program_and_args(venv.to_str().unwrap(), "django", "uv", &opts).unwrap();

        assert_eq!(args[0], "pip");
        assert_eq!(args[1], "install");
        assert_eq!(args[2], "--python");
        assert!(args[3].ends_with(expected_python_suffix()));
        assert_eq!(args[4], "django");
        let _ = fs::remove_dir_all(venv);
    }

    #[test]
    fn install_program_and_args_rejects_read_only_managers() {
        let venv = fake_venv();
        let err = install_program_and_args(
            venv.to_str().unwrap(),
            "django",
            "conda",
            &InstallOptions::default(),
        )
        .unwrap_err();
        assert!(err.contains("read-only"));
        let _ = fs::remove_dir_all(venv);
    }
}
