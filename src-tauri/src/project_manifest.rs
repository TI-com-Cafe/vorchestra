//! Python project manifest parsers used by project autodetection.
//!
//! These helpers are intentionally tolerant: they never execute project
//! code and return notes when a manifest exists but cannot be parsed with
//! confidence.

use std::collections::HashSet;
use std::fs;
use std::path::Path;

use crate::types::{ProjectManifest, ProjectWorkspaceInfo};

pub fn read_requirements_txt(path: &Path) -> (Vec<String>, Option<String>) {
    let raw = match fs::read_to_string(path) {
        Ok(s) => s,
        Err(e) => return (Vec::new(), Some(format!("Could not read file: {}", e))),
    };
    let mut pkgs = Vec::new();
    let mut had_includes = false;
    for line in raw.lines() {
        let line = line.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            continue;
        }
        if line.starts_with("-r ") || line.starts_with("--requirement") {
            had_includes = true;
            continue;
        }
        if line.starts_with("-e ") || line.starts_with("--editable") {
            // Editable installs need a path argument; surface them as-is.
            pkgs.push(line.to_string());
            continue;
        }
        if line.starts_with('-') {
            // Other pip flags (-c, --index-url, etc.) are not packages.
            continue;
        }
        pkgs.push(line.to_string());
    }
    let note = if had_includes {
        Some(
            "File references other requirements via -r; nested files were not expanded."
                .to_string(),
        )
    } else {
        None
    };
    (pkgs, note)
}

pub fn read_pyproject(path: &Path) -> (Vec<String>, Option<String>) {
    let raw = match fs::read_to_string(path) {
        Ok(s) => s,
        Err(e) => return (Vec::new(), Some(format!("Could not read file: {}", e))),
    };
    let parsed: toml::Value = match toml::from_str(&raw) {
        Ok(v) => v,
        Err(e) => return (Vec::new(), Some(format!("Invalid TOML: {}", e))),
    };

    let mut pkgs: Vec<String> = Vec::new();
    let mut found_optional = false;

    if let Some(deps) = parsed
        .get("project")
        .and_then(|p| p.get("dependencies"))
        .and_then(|d| d.as_array())
    {
        for v in deps {
            if let Some(s) = v.as_str() {
                pkgs.push(s.to_string());
            }
        }
    }

    if parsed
        .get("project")
        .and_then(|p| p.get("optional-dependencies"))
        .is_some()
    {
        found_optional = true;
    }

    if pkgs.is_empty() {
        if let Some(table) = parsed
            .get("tool")
            .and_then(|t| t.get("poetry"))
            .and_then(|p| p.get("dependencies"))
            .and_then(|d| d.as_table())
        {
            for (name, spec) in table {
                if name == "python" {
                    continue;
                }
                let version = match spec {
                    toml::Value::String(s) => s.clone(),
                    toml::Value::Table(t) => t
                        .get("version")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    _ => String::new(),
                };
                if version.is_empty() || version == "*" {
                    pkgs.push(name.clone());
                } else {
                    pkgs.push(format!("{}{}", name, normalize_caret(&version)));
                }
            }
        }
    }

    let note = if found_optional && !pkgs.is_empty() {
        Some(
            "Optional dependency groups exist in this project; only the main set was extracted."
                .to_string(),
        )
    } else if pkgs.is_empty() {
        Some(
            "No PEP 621 [project.dependencies] or [tool.poetry.dependencies] block found."
                .to_string(),
        )
    } else {
        None
    };
    (pkgs, note)
}

/// Poetry uses "^1.2" / "~1.2". Convert to pip-friendly suggestions.
fn normalize_caret(v: &str) -> String {
    let trimmed = v.trim();
    if let Some(rest) = trimmed.strip_prefix('^') {
        format!(">={}", rest)
    } else if let Some(rest) = trimmed.strip_prefix('~') {
        format!("~={}", rest)
    } else if trimmed.starts_with(|c: char| c.is_ascii_digit()) {
        format!("=={}", trimmed)
    } else {
        trimmed.to_string()
    }
}

pub fn read_pipfile(path: &Path) -> (Vec<String>, Option<String>) {
    let raw = match fs::read_to_string(path) {
        Ok(s) => s,
        Err(e) => return (Vec::new(), Some(format!("Could not read file: {}", e))),
    };
    let parsed: toml::Value = match toml::from_str(&raw) {
        Ok(v) => v,
        Err(e) => return (Vec::new(), Some(format!("Invalid TOML: {}", e))),
    };

    let mut pkgs: Vec<String> = Vec::new();
    if let Some(table) = parsed.get("packages").and_then(|p| p.as_table()) {
        for (name, spec) in table {
            let version = match spec {
                toml::Value::String(s) => s.clone(),
                toml::Value::Table(t) => t
                    .get("version")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                _ => String::new(),
            };
            if version.is_empty() || version == "*" {
                pkgs.push(name.clone());
            } else {
                pkgs.push(format!("{}{}", name, normalize_caret(&version)));
            }
        }
    }
    let note = if parsed.get("dev-packages").is_some() {
        Some("Pipfile [dev-packages] block exists; not included in the suggestion.".to_string())
    } else {
        None
    };
    (pkgs, note)
}

pub fn read_setup_cfg(path: &Path) -> (Vec<String>, Option<String>) {
    let raw = match fs::read_to_string(path) {
        Ok(s) => s,
        Err(e) => return (Vec::new(), Some(format!("Could not read file: {}", e))),
    };
    let mut pkgs: Vec<String> = Vec::new();
    let mut in_block = false;
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("install_requires") {
            in_block = true;
            if let Some((_, rhs)) = trimmed.split_once('=') {
                let rhs = rhs.trim();
                if !rhs.is_empty() && !rhs.starts_with('#') {
                    pkgs.push(rhs.to_string());
                }
            }
            continue;
        }
        if in_block {
            if !line.starts_with([' ', '\t']) {
                in_block = false;
                continue;
            }
            let val = trimmed.split('#').next().unwrap_or("").trim();
            if !val.is_empty() {
                pkgs.push(val.to_string());
            }
        }
    }
    let note = if pkgs.is_empty() {
        Some("No install_requires entries found in setup.cfg.".to_string())
    } else {
        None
    };
    (pkgs, note)
}

pub fn read_setup_py(_path: &Path) -> (Vec<String>, Option<String>) {
    // VOrchestra never executes Python build files during detection.
    (
        Vec::new(),
        Some(
            "setup.py was not parsed. VOrchestra never executes Python build files; \
             paste the dependencies manually if needed."
                .to_string(),
        ),
    )
}

pub fn read_conda_environment(path: &Path) -> (Vec<String>, Option<String>) {
    let raw = match fs::read_to_string(path) {
        Ok(s) => s,
        Err(e) => return (Vec::new(), Some(format!("Could not read file: {}", e))),
    };
    let mut pkgs = Vec::new();
    let mut in_dependencies = false;
    let mut in_pip = false;
    let mut saw_conda_only = false;

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if !line.starts_with([' ', '\t']) {
            in_dependencies = trimmed == "dependencies:";
            in_pip = false;
            continue;
        }
        if !in_dependencies {
            continue;
        }
        if trimmed == "- pip:" {
            in_pip = true;
            continue;
        }
        if let Some(value) = trimmed.strip_prefix("- ") {
            let value = value.split('#').next().unwrap_or("").trim();
            if value.is_empty() {
                continue;
            }
            if in_pip {
                pkgs.push(value.to_string());
            } else if value != "pip" && !value.starts_with("python") {
                saw_conda_only = true;
            }
        }
    }

    let note = if saw_conda_only {
        Some(
            "Conda dependencies are shown as read-only; only nested pip dependencies are installable in VOrchestra venvs."
                .to_string(),
        )
    } else if pkgs.is_empty() {
        Some("No nested pip dependencies found in environment.yml.".to_string())
    } else {
        Some("Conda environment.yml detected as read-only inventory.".to_string())
    };
    (pkgs, note)
}

pub fn read_pixi_toml(path: &Path) -> (Vec<String>, Option<String>) {
    let raw = match fs::read_to_string(path) {
        Ok(s) => s,
        Err(e) => return (Vec::new(), Some(format!("Could not read file: {}", e))),
    };
    let parsed: toml::Value = match toml::from_str(&raw) {
        Ok(v) => v,
        Err(e) => return (Vec::new(), Some(format!("Invalid TOML: {}", e))),
    };

    let mut pkgs = Vec::new();
    if let Some(table) = parsed
        .get("pypi-dependencies")
        .and_then(|deps| deps.as_table())
    {
        for (name, spec) in table {
            let version = match spec {
                toml::Value::String(s) => s.clone(),
                toml::Value::Table(t) => t
                    .get("version")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                _ => String::new(),
            };
            if version.is_empty() || version == "*" {
                pkgs.push(name.clone());
            } else {
                pkgs.push(format!("{}{}", name, normalize_caret(&version)));
            }
        }
    }

    let note = if parsed.get("dependencies").is_some() {
        Some(
            "Pixi conda dependencies are read-only; only [pypi-dependencies] are shown as Python package specs."
                .to_string(),
        )
    } else if pkgs.is_empty() {
        Some("No [pypi-dependencies] block found in pixi.toml.".to_string())
    } else {
        Some("pixi.toml detected as read-only inventory.".to_string())
    };
    (pkgs, note)
}

pub fn merge_packages(manifests: &[ProjectManifest]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for m in manifests {
        if matches!(
            &m.kind,
            crate::types::ManifestKind::CondaEnvironment | crate::types::ManifestKind::PixiToml
        ) {
            continue;
        }
        for p in &m.packages {
            let key = p
                .split(['=', '<', '>', '~', '!', ' ', ';'].as_ref())
                .next()
                .unwrap_or(p)
                .to_lowercase();
            if seen.insert(key) {
                out.push(p.clone());
            }
        }
    }
    out
}

pub fn read_uv_workspace_info(path: &Path) -> Option<ProjectWorkspaceInfo> {
    let raw = fs::read_to_string(path).ok()?;
    let parsed: toml::Value = toml::from_str(&raw).ok()?;
    let workspace = parsed
        .get("tool")
        .and_then(|tool| tool.get("uv"))
        .and_then(|uv| uv.get("workspace"))?;

    let members = workspace
        .get("members")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let excludes = workspace
        .get("exclude")
        .or_else(|| workspace.get("excludes"))
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Some(ProjectWorkspaceInfo {
        manager: "uv".to_string(),
        members,
        excludes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::ManifestKind;

    fn write_tmp(name: &str, content: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("vorchestra-detect-{}-{}", std::process::id(), name));
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join(name);
        fs::write(&p, content).unwrap();
        p
    }

    #[test]
    fn requirements_txt_skips_comments_and_includes() {
        let p = write_tmp(
            "a-requirements.txt",
            "\
# header
requests>=2.0
flask  # web
-r other.txt
-e ./local
--index-url https://example.com
",
        );
        let (pkgs, note) = read_requirements_txt(&p);
        assert!(pkgs.contains(&"requests>=2.0".to_string()));
        assert!(pkgs.contains(&"flask".to_string()));
        assert!(pkgs.iter().any(|x| x.starts_with("-e ")));
        assert!(note.unwrap().contains("nested"));
    }

    #[test]
    fn pyproject_extracts_pep621_dependencies() {
        let p = write_tmp(
            "b-pyproject.toml",
            r#"
[project]
name = "demo"
dependencies = ["requests>=2.0", "flask"]

[project.optional-dependencies]
test = ["pytest"]
"#,
        );
        let (pkgs, note) = read_pyproject(&p);
        assert_eq!(pkgs, vec!["requests>=2.0", "flask"]);
        assert!(note.is_some());
    }

    #[test]
    fn pyproject_falls_back_to_poetry_block() {
        let p = write_tmp(
            "c-pyproject.toml",
            r#"
[tool.poetry]
name = "demo"

[tool.poetry.dependencies]
python = "^3.10"
requests = "^2.30"
flask = { version = "~3.0" }
django = "*"
"#,
        );
        let (pkgs, _) = read_pyproject(&p);
        assert!(pkgs.contains(&"requests>=2.30".to_string()));
        assert!(pkgs.contains(&"flask~=3.0".to_string()));
        assert!(pkgs.contains(&"django".to_string()));
        assert!(!pkgs.iter().any(|p| p.starts_with("python")));
    }

    #[test]
    fn pipfile_extracts_packages_block() {
        let p = write_tmp(
            "d-Pipfile",
            r#"
[packages]
requests = "==2.31.0"
django = "*"

[dev-packages]
pytest = "*"
"#,
        );
        let (pkgs, note) = read_pipfile(&p);
        assert!(pkgs.contains(&"requests==2.31.0".to_string()));
        assert!(pkgs.contains(&"django".to_string()));
        assert!(note.unwrap().contains("dev-packages"));
    }

    #[test]
    fn setup_cfg_reads_install_requires_block() {
        let p = write_tmp(
            "e-setup.cfg",
            "[options]\ninstall_requires =\n    requests>=2.0\n    flask  # web\n",
        );
        let (pkgs, _) = read_setup_cfg(&p);
        assert!(pkgs.contains(&"requests>=2.0".to_string()));
        assert!(pkgs.contains(&"flask".to_string()));
    }

    #[test]
    fn conda_environment_reads_nested_pip_dependencies_only() {
        let p = write_tmp(
            "environment.yml",
            "\
name: demo
dependencies:
  - python=3.12
  - numpy
  - pip:
    - fastapi>=0.110
    - uvicorn
",
        );
        let (pkgs, note) = read_conda_environment(&p);
        assert_eq!(pkgs, vec!["fastapi>=0.110", "uvicorn"]);
        assert!(note.unwrap().contains("Conda dependencies"));
    }

    #[test]
    fn pixi_toml_reads_pypi_dependencies() {
        let p = write_tmp(
            "pixi.toml",
            r#"
[dependencies]
python = "3.12.*"
numpy = "*"

[pypi-dependencies]
fastapi = ">=0.110"
uvicorn = "*"
"#,
        );
        let (pkgs, note) = read_pixi_toml(&p);
        assert!(pkgs.contains(&"fastapi>=0.110".to_string()));
        assert!(pkgs.contains(&"uvicorn".to_string()));
        assert!(note.unwrap().contains("Pixi conda dependencies"));
    }

    #[test]
    fn merge_packages_dedupes_case_insensitively() {
        let manifests = vec![
            ProjectManifest {
                kind: ManifestKind::RequirementsTxt,
                path: "x".into(),
                packages: vec!["Requests==2.0".into(), "Flask".into()],
                note: None,
            },
            ProjectManifest {
                kind: ManifestKind::Pyproject,
                path: "y".into(),
                packages: vec!["requests>=2.0".into(), "django".into()],
                note: None,
            },
        ];
        let merged = merge_packages(&manifests);
        let lower: Vec<String> = merged.iter().map(|s| s.to_lowercase()).collect();
        assert!(lower.iter().any(|p| p.starts_with("requests")));
        assert!(lower.iter().any(|p| p.starts_with("flask")));
        assert!(lower.iter().any(|p| p.starts_with("django")));
        let unique_names: HashSet<String> = lower
            .iter()
            .map(|p| {
                p.split(['=', '<', '>', '~'].as_ref())
                    .next()
                    .unwrap_or(p)
                    .to_string()
            })
            .collect();
        assert_eq!(unique_names.len(), 3);
    }

    #[test]
    fn merge_packages_skips_conda_and_pixi_inventory() {
        let manifests = vec![
            ProjectManifest {
                kind: ManifestKind::RequirementsTxt,
                path: "requirements.txt".into(),
                packages: vec!["fastapi".into()],
                note: None,
            },
            ProjectManifest {
                kind: ManifestKind::CondaEnvironment,
                path: "environment.yml".into(),
                packages: vec!["numpy".into()],
                note: None,
            },
            ProjectManifest {
                kind: ManifestKind::PixiToml,
                path: "pixi.toml".into(),
                packages: vec!["polars".into()],
                note: None,
            },
        ];
        assert_eq!(merge_packages(&manifests), vec!["fastapi"]);
    }

    #[test]
    fn read_uv_workspace_info_extracts_members_and_excludes() {
        let p = write_tmp(
            "workspace-pyproject.toml",
            r#"
[project]
name = "monorepo"
dependencies = []

[tool.uv.workspace]
members = ["packages/*", "apps/api"]
exclude = ["packages/legacy"]
"#,
        );
        let info = read_uv_workspace_info(&p).expect("workspace info");
        assert_eq!(info.manager, "uv");
        assert_eq!(info.members, vec!["packages/*", "apps/api"]);
        assert_eq!(info.excludes, vec!["packages/legacy"]);
    }
}
