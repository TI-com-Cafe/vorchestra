//! pip/uv package mutation primitives shared by package commands and venv setup.

use std::sync::atomic::AtomicBool;

use crate::helpers::{
    classify_install_error, ensure_venv_dir, run_command_with_timeout,
    run_command_with_timeout_and_cancel,
};
use crate::package_managers::manager_for_engine;
pub use crate::package_managers::InstallOptions;
use crate::process_utils::run_command_with_timeout_cancel_and_output;

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
    install_dependency_with_cancel_and_output_internal(
        venv_path,
        package,
        engine,
        opts,
        cancel,
        |_, _| {},
    )
}

pub fn install_dependency_with_cancel_and_output_internal<F>(
    venv_path: String,
    package: String,
    engine: String,
    opts: InstallOptions,
    cancel: Option<&AtomicBool>,
    on_output_line: F,
) -> Result<String, String>
where
    F: FnMut(&str, &str),
{
    let venv = ensure_venv_dir(&venv_path)?;
    let manager = manager_for_engine(&engine)?;
    let package_command = manager.install_command(&venv, &package, &opts);
    let mut cmd = package_command.to_command();

    let output = run_with_optional_cancel_and_output(&mut cmd, 600, cancel, on_output_line)?;
    if output.status.success() {
        Ok(manager.install_success_message(&package))
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
    let manager = manager_for_engine(&engine)?;
    let package_command = manager.uninstall_command(&venv, &package);
    let mut cmd = package_command.to_command();
    let out = run_with_optional_cancel(&mut cmd, 300, cancel)?;
    if out.status.success() {
        Ok(manager.uninstall_success_message(&package))
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
    let manager = manager_for_engine(&engine)?;
    let package_command = manager.update_command(&venv, &package);
    let mut cmd = package_command.to_command();
    let out = run_with_optional_cancel(&mut cmd, 600, cancel)?;
    if out.status.success() {
        Ok(manager.update_success_message(&package))
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
    let manager = manager_for_engine(engine)?;
    let command = manager.install_command(&venv, package, opts);
    Ok((command.program, command.args))
}

fn run_with_optional_cancel_and_output<F>(
    cmd: &mut std::process::Command,
    timeout_secs: u64,
    cancel: Option<&AtomicBool>,
    on_output_line: F,
) -> Result<std::process::Output, String>
where
    F: FnMut(&str, &str),
{
    if let Some(cancel) = cancel {
        run_command_with_timeout_cancel_and_output(cmd, timeout_secs, cancel, on_output_line)
    } else {
        run_command_with_timeout(cmd, timeout_secs)
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
