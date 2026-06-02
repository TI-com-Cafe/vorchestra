//! Package manager command builders.
//!
//! This module keeps manager-specific command shapes in one place. Execution
//! stays in `package_ops.rs`, so adding a manager later does not require
//! scattering `engine == ...` branches across package mutation code.

use crate::helpers::{get_manager_path, get_python_path, uv_cache_dir_for};
use std::path::{Path, PathBuf};
use std::process::Command;

/// Optional flags accepted by package install. Unknown / missing fields
/// default safely (no extra args appended).
#[derive(Default, Clone, Debug, PartialEq, Eq)]
pub struct InstallOptions {
    pub index_url: Option<String>,
    pub extra_index_url: Option<String>,
    pub editable: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PackageCommand {
    pub program: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

impl PackageCommand {
    fn new(program: impl Into<String>, args: Vec<String>) -> Self {
        Self {
            program: program.into(),
            args,
            env: Vec::new(),
        }
    }

    fn with_env(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.env.push((key.into(), value.into()));
        self
    }

    pub fn to_command(&self) -> Command {
        let mut cmd = crate::helpers::new_command(&self.program);
        cmd.args(&self.args);
        for (key, value) in &self.env {
            cmd.env(key, value);
        }
        cmd
    }
}

pub trait PackageManager {
    fn install_command(&self, venv: &Path, package: &str, opts: &InstallOptions) -> PackageCommand;
    fn uninstall_command(&self, venv: &Path, package: &str) -> PackageCommand;
    fn update_command(&self, venv: &Path, package: &str) -> PackageCommand;
    fn check_command(&self, venv: &Path) -> PackageCommand;
    fn outdated_command(&self, venv: &Path) -> PackageCommand;
    fn freeze_command(&self, venv: &Path) -> PackageCommand;
    fn install_requirements_command(&self, venv: &Path, requirements_path: &Path)
        -> PackageCommand;
    fn install_success_message(&self, package: &str) -> String;
    fn uninstall_success_message(&self, package: &str) -> String;
    fn update_success_message(&self, package: &str) -> String;
    fn freeze_failure_prefix(&self) -> &'static str;
}

pub struct PipManager;
pub struct UvManager;

impl PackageManager for PipManager {
    fn install_command(&self, venv: &Path, package: &str, opts: &InstallOptions) -> PackageCommand {
        let mut args = vec!["-m".into(), "pip".into(), "install".into()];
        append_install_options(&mut args, opts);
        args.push(package.to_string());
        PackageCommand::new(path_string(get_python_path(venv)), args)
    }

    fn uninstall_command(&self, venv: &Path, package: &str) -> PackageCommand {
        PackageCommand::new(
            path_string(get_python_path(venv)),
            vec![
                "-m".into(),
                "pip".into(),
                "uninstall".into(),
                "-y".into(),
                package.into(),
            ],
        )
    }

    fn update_command(&self, venv: &Path, package: &str) -> PackageCommand {
        PackageCommand::new(
            path_string(get_python_path(venv)),
            vec![
                "-m".into(),
                "pip".into(),
                "install".into(),
                "--upgrade".into(),
                package.into(),
            ],
        )
    }

    fn check_command(&self, venv: &Path) -> PackageCommand {
        PackageCommand::new(
            path_string(get_python_path(venv)),
            vec!["-m".into(), "pip".into(), "check".into()],
        )
    }

    fn outdated_command(&self, venv: &Path) -> PackageCommand {
        PackageCommand::new(
            path_string(get_python_path(venv)),
            vec![
                "-m".into(),
                "pip".into(),
                "list".into(),
                "--outdated".into(),
                "--format=json".into(),
            ],
        )
    }

    fn freeze_command(&self, venv: &Path) -> PackageCommand {
        PackageCommand::new(
            path_string(get_python_path(venv)),
            vec!["-m".into(), "pip".into(), "freeze".into()],
        )
    }

    fn install_requirements_command(
        &self,
        venv: &Path,
        requirements_path: &Path,
    ) -> PackageCommand {
        PackageCommand::new(
            path_string(get_python_path(venv)),
            vec![
                "-m".into(),
                "pip".into(),
                "install".into(),
                "-r".into(),
                path_string(requirements_path.to_path_buf()),
            ],
        )
    }

    fn install_success_message(&self, package: &str) -> String {
        format!("Installed {}", package)
    }

    fn uninstall_success_message(&self, package: &str) -> String {
        format!("Uninstalled {}", package)
    }

    fn update_success_message(&self, package: &str) -> String {
        format!("Updated {}", package)
    }

    fn freeze_failure_prefix(&self) -> &'static str {
        "pip freeze failed"
    }
}

impl PackageManager for UvManager {
    fn install_command(&self, venv: &Path, package: &str, opts: &InstallOptions) -> PackageCommand {
        let mut args = vec![
            "pip".into(),
            "install".into(),
            "--python".into(),
            path_string(get_python_path(venv)),
        ];
        append_install_options(&mut args, opts);
        args.push(package.to_string());
        uv_command(venv, args)
    }

    fn uninstall_command(&self, venv: &Path, package: &str) -> PackageCommand {
        uv_command(
            venv,
            vec![
                "pip".into(),
                "uninstall".into(),
                "--python".into(),
                path_string(get_python_path(venv)),
                "-y".into(),
                package.into(),
            ],
        )
    }

    fn update_command(&self, venv: &Path, package: &str) -> PackageCommand {
        uv_command(
            venv,
            vec![
                "pip".into(),
                "install".into(),
                "--upgrade".into(),
                "--python".into(),
                path_string(get_python_path(venv)),
                package.into(),
            ],
        )
    }

    fn check_command(&self, venv: &Path) -> PackageCommand {
        uv_command(
            venv,
            vec![
                "pip".into(),
                "check".into(),
                "--python".into(),
                path_string(get_python_path(venv)),
            ],
        )
    }

    fn outdated_command(&self, venv: &Path) -> PackageCommand {
        uv_command(
            venv,
            vec![
                "pip".into(),
                "list".into(),
                "--outdated".into(),
                "--format".into(),
                "json".into(),
                "--python".into(),
                path_string(get_python_path(venv)),
            ],
        )
    }

    fn freeze_command(&self, venv: &Path) -> PackageCommand {
        uv_command(
            venv,
            vec![
                "pip".into(),
                "freeze".into(),
                "--python".into(),
                path_string(get_python_path(venv)),
            ],
        )
    }

    fn install_requirements_command(
        &self,
        venv: &Path,
        requirements_path: &Path,
    ) -> PackageCommand {
        uv_command(
            venv,
            vec![
                "pip".into(),
                "install".into(),
                "--python".into(),
                path_string(get_python_path(venv)),
                "-r".into(),
                path_string(requirements_path.to_path_buf()),
            ],
        )
    }

    fn install_success_message(&self, package: &str) -> String {
        format!("uv installed {}", package)
    }

    fn uninstall_success_message(&self, package: &str) -> String {
        format!("uv uninstalled {}", package)
    }

    fn update_success_message(&self, package: &str) -> String {
        format!("uv updated {}", package)
    }

    fn freeze_failure_prefix(&self) -> &'static str {
        "uv pip freeze failed"
    }
}

pub fn manager_for_engine(engine: &str) -> Result<Box<dyn PackageManager>, String> {
    match engine {
        "pip" => Ok(Box::new(PipManager)),
        "uv" => Ok(Box::new(UvManager)),
        other => Err(format!(
            "{} environments are read-only in VOrchestra. Use the native manager for package changes.",
            other
        )),
    }
}

pub fn pip_audit_install_hint_for_engine(engine: &str, python_path: &str) -> String {
    match engine {
        "uv" => format!("uv pip install --python \"{}\" pip-audit", python_path),
        "conda" => "conda install -c conda-forge pip-audit".to_string(),
        "pixi" => "pixi add pip-audit".to_string(),
        _ => "pip install pip-audit".to_string(),
    }
}

fn append_install_options(args: &mut Vec<String>, opts: &InstallOptions) {
    if let Some(url) = opts.index_url.as_deref().filter(|s| !s.is_empty()) {
        args.push("--index-url".into());
        args.push(url.into());
    }
    if let Some(url) = opts.extra_index_url.as_deref().filter(|s| !s.is_empty()) {
        args.push("--extra-index-url".into());
        args.push(url.into());
    }
    if opts.editable {
        args.push("-e".into());
    }
}

fn uv_command(venv: &Path, args: Vec<String>) -> PackageCommand {
    PackageCommand::new(get_manager_path("uv"), args)
        .with_env("UV_CACHE_DIR", uv_cache_dir_for(venv))
}

fn path_string(path: PathBuf) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fake_venv() -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("vorchestra-package-manager-{}", suffix));
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
    fn pip_install_command_accepts_indexes_and_editable() {
        let venv = fake_venv();
        let opts = InstallOptions {
            index_url: Some("https://pypi.org/simple".to_string()),
            extra_index_url: Some("https://example.test/simple".to_string()),
            editable: true,
        };
        let command = PipManager.install_command(&venv, "../project", &opts);

        assert!(command.program.ends_with(expected_python_suffix()));
        assert_eq!(
            command.args,
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
        assert!(command.env.is_empty());
        let _ = fs::remove_dir_all(venv);
    }

    #[test]
    fn uv_install_command_targets_venv_python_and_cache() {
        let venv = fake_venv();
        let command = UvManager.install_command(&venv, "django", &InstallOptions::default());

        assert_eq!(command.args[0], "pip");
        assert_eq!(command.args[1], "install");
        assert_eq!(command.args[2], "--python");
        assert!(command.args[3].ends_with(expected_python_suffix()));
        assert_eq!(command.args[4], "django");
        assert!(command.env.iter().any(|(k, _)| k == "UV_CACHE_DIR"));
        let _ = fs::remove_dir_all(venv);
    }

    #[test]
    fn read_only_managers_are_rejected() {
        match manager_for_engine("conda") {
            Ok(_) => panic!("conda should be read-only"),
            Err(err) => assert!(err.contains("read-only")),
        }
    }
}
