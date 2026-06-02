//! File-oriented commands: project-root .env, pyvenv.cfg, save-to-project,
//! Dockerfile / docker-compose generators, and sanitized support exports.

use crate::helpers::{
    detect_manager_type, ensure_venv_dir, get_python_path, list_installed_packages, new_command,
    run_command_with_timeout, stdout_or_stderr,
};
use crate::project_manifest::{
    merge_packages, read_conda_environment, read_pipfile, read_pixi_toml, read_pyproject,
    read_requirements_txt, read_setup_cfg, read_setup_py,
};
use crate::types::{ManifestKind, ProjectManifest};
use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path};
use std::time::{SystemTime, UNIX_EPOCH};

#[tauri::command]
pub async fn read_env_file(venv_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let pb = ensure_venv_dir(&venv_path)?;
        let project_root = pb.parent().unwrap_or(&pb);
        let env_path = project_root.join(".env");
        if env_path.exists() {
            fs::read_to_string(env_path).map_err(|e| e.to_string())
        } else {
            Ok("".to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct EnvEntry {
    pub key: String,
    pub value: String,
    pub from_example: bool,
}

/// Parses a single line from a `.env` file. We strip surrounding quotes
/// and recognise `export KEY=VALUE` for shell-style files. Comment lines
/// and lines without `=` are ignored.
fn parse_env_line(line: &str) -> Option<(String, String)> {
    let mut trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return None;
    }
    if let Some(rest) = trimmed.strip_prefix("export ") {
        trimmed = rest.trim_start();
    }
    let (k, v) = trimmed.split_once('=')?;
    let key = k.trim().to_string();
    if key.is_empty() {
        return None;
    }
    let mut value = v.trim().to_string();
    if ((value.starts_with('"') && value.ends_with('"'))
        || (value.starts_with('\'') && value.ends_with('\'')))
        && value.len() >= 2
    {
        value = value[1..value.len() - 1].to_string();
    }
    Some((key, value))
}

fn read_env_map(path: &std::path::Path) -> std::collections::BTreeMap<String, String> {
    let mut map = std::collections::BTreeMap::new();
    if let Ok(raw) = fs::read_to_string(path) {
        for line in raw.lines() {
            if let Some((k, v)) = parse_env_line(line) {
                map.insert(k, v);
            }
        }
    }
    map
}

/// Returns the structured contents of `.env` plus any keys declared in
/// `.env.example` (or `.env.template`) but missing from the live file.
/// Missing keys come back with `from_example = true` and an empty value
/// so the UI can highlight them as "declared but not set".
#[tauri::command]
pub async fn read_env_entries(venv_path: String) -> Result<Vec<EnvEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let pb = ensure_venv_dir(&venv_path)?;
        let project_root = pb.parent().unwrap_or(&pb);
        let env_path = project_root.join(".env");
        let example_paths = [
            project_root.join(".env.example"),
            project_root.join(".env.template"),
        ];

        let live = read_env_map(&env_path);

        let mut example_keys: std::collections::BTreeSet<String> =
            std::collections::BTreeSet::new();
        for p in example_paths {
            if p.exists() {
                for k in read_env_map(&p).keys() {
                    example_keys.insert(k.clone());
                }
            }
        }

        let mut entries: Vec<EnvEntry> = Vec::new();
        for (k, v) in &live {
            entries.push(EnvEntry {
                key: k.clone(),
                value: v.clone(),
                from_example: false,
            });
        }
        for k in &example_keys {
            if !live.contains_key(k) {
                entries.push(EnvEntry {
                    key: k.clone(),
                    value: String::new(),
                    from_example: true,
                });
            }
        }
        Ok(entries)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Writes a structured env map back to `.env`. Keys are sorted
/// alphabetically and serialized as `KEY=VALUE`. Values containing
/// spaces, quotes, or shell metacharacters are double-quoted with
/// inner double-quotes escaped.
#[tauri::command]
pub async fn save_env_entries(venv_path: String, entries: Vec<EnvEntry>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let pb = ensure_venv_dir(&venv_path)?;
        let project_root = pb.parent().unwrap_or(&pb);
        let env_path = project_root.join(".env");

        // Deduplicate by key, preserving the latest value for each key.
        let mut map: std::collections::BTreeMap<String, String> = std::collections::BTreeMap::new();
        for e in entries {
            let key = e.key.trim().to_string();
            if key.is_empty() {
                continue;
            }
            map.insert(key, e.value);
        }

        let needs_quoting =
            |v: &str| v.contains(' ') || v.contains('"') || v.contains('#') || v.contains('$');

        let mut body = String::from("# Managed by VOrchestra. Edit through the Config tab.\n");
        for (k, v) in &map {
            if needs_quoting(v) {
                body.push_str(&format!("{}=\"{}\"\n", k, v.replace('"', "\\\"")));
            } else {
                body.push_str(&format!("{}={}\n", k, v));
            }
        }
        fs::write(env_path, body).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_env_file(venv_path: String, content: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let pb = ensure_venv_dir(&venv_path)?;
        let project_root = pb.parent().unwrap_or(&pb);
        let env_path = project_root.join(".env");
        fs::write(env_path, content).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_pyvenv_cfg(venv_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let venv = ensure_venv_dir(&venv_path)?;
        let path = venv.join("pyvenv.cfg");
        if path.exists() {
            fs::read_to_string(path).map_err(|e| e.to_string())
        } else {
            Err("pyvenv.cfg not found".into())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

fn validate_project_file_name(file_name: &str) -> Result<&str, String> {
    let trimmed = file_name.trim();
    if trimmed.is_empty() {
        return Err("File name cannot be empty.".to_string());
    }
    let path = Path::new(trimmed);
    if path.is_absolute()
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("File name must be a plain project-root file name.".to_string());
    }
    Ok(trimmed)
}

#[tauri::command]
pub async fn save_project_file(
    venv_path: String,
    file_name: String,
    content: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let venv = ensure_venv_dir(&venv_path)?;
        let project_root = venv.parent().unwrap_or(&venv);
        let safe_file_name = validate_project_file_name(&file_name)?;
        let target = project_root.join(safe_file_name);
        fs::write(&target, content).map_err(|e| e.to_string())?;
        Ok(format!("Saved {} to project root.", safe_file_name))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn export_support_bundle(
    venv_path: String,
    output_path: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let venv = ensure_venv_dir(&venv_path)?;
        let project_root = venv.parent().unwrap_or(&venv).to_path_buf();
        let python = get_python_path(&venv);
        let engine = detect_manager_type(&venv);

        let mut version_cmd = new_command(&python);
        version_cmd.arg("--version");
        let version_out = run_command_with_timeout(&mut version_cmd, 20)?;
        let python_version = if version_out.status.success() {
            stdout_or_stderr(&version_out).trim().to_string()
        } else {
            "Python version unavailable".to_string()
        };

        let packages = support_package_rows(&venv)?;

        let pyvenv_cfg = fs::read_to_string(venv.join("pyvenv.cfg")).unwrap_or_default();
        let env_keys: Vec<String> = read_env_map(&project_root.join(".env"))
            .keys()
            .cloned()
            .collect();
        let manifests = detect_manifest_summaries(&project_root);
        let merged_packages = merge_packages(&manifests);
        let created_at_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_secs())
            .unwrap_or(0);

        let bundle = serde_json::json!({
            "format": "vorchestra-support-bundle",
            "format_version": 1,
            "created_at_unix": created_at_unix,
            "venv": {
                "name": venv.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_else(|| "venv".to_string()),
                "path": venv.to_string_lossy(),
                "project_root": project_root.to_string_lossy(),
                "engine": engine,
                "python": python.to_string_lossy(),
                "python_version": python_version,
                "pyvenv_cfg": pyvenv_cfg,
                "native_manager": native_manager_support_metadata(&engine),
            },
            "project": {
                "env_keys": env_keys,
                "manifests": manifests,
                "merged_manifest_packages": merged_packages,
            },
            "packages": packages,
            "privacy_note": "Generated by VOrchestra. .env values are intentionally omitted; only variable names are included."
        });
        let content = serde_json::to_string_pretty(&bundle)
            .map_err(|e| format!("Failed to serialize support bundle: {}", e))?;
        let target = std::path::PathBuf::from(&output_path);
        if let Some(parent) = target.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create output directory: {}", e))?;
            }
        }
        fs::write(&target, content).map_err(|e| format!("Failed to write support bundle: {}", e))?;
        Ok(format!(
            "Wrote sanitized support bundle to {}",
            target.to_string_lossy()
        ))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn support_package_rows(venv: &Path) -> Result<serde_json::Value, String> {
    let rows: Vec<serde_json::Value> = list_installed_packages(venv)?
        .into_iter()
        .map(|spec| {
            if let Some((name, version)) = spec.split_once("==") {
                serde_json::json!({ "name": name, "version": version })
            } else {
                serde_json::json!({ "name": spec, "version": null })
            }
        })
        .collect();
    Ok(serde_json::json!(rows))
}

fn native_manager_support_metadata(engine: &str) -> serde_json::Value {
    match engine {
        "conda" => serde_json::json!({
            "read_only": true,
            "reason": "Conda environments are inventoried read-only to preserve native metadata.",
            "suggested_commands": ["conda list", "conda env export", "conda update --all --dry-run"]
        }),
        "pixi" => serde_json::json!({
            "read_only": true,
            "reason": "Pixi environments are inventoried read-only to preserve native metadata.",
            "suggested_commands": ["pixi list", "pixi lock", "pixi install"]
        }),
        _ => serde_json::json!({
            "read_only": false,
            "reason": null,
            "suggested_commands": []
        }),
    }
}

fn detect_manifest_summaries(project_root: &Path) -> Vec<ProjectManifest> {
    let mut manifests = Vec::new();

    let req_path = project_root.join("requirements.txt");
    if req_path.exists() {
        let (packages, note) = read_requirements_txt(&req_path);
        manifests.push(ProjectManifest {
            kind: ManifestKind::RequirementsTxt,
            path: req_path.to_string_lossy().to_string(),
            packages,
            note,
        });
    }

    let pyproject = project_root.join("pyproject.toml");
    if pyproject.exists() {
        let (packages, note) = read_pyproject(&pyproject);
        manifests.push(ProjectManifest {
            kind: ManifestKind::Pyproject,
            path: pyproject.to_string_lossy().to_string(),
            packages,
            note,
        });
    }

    let pipfile = project_root.join("Pipfile");
    if pipfile.exists() {
        let (packages, note) = read_pipfile(&pipfile);
        manifests.push(ProjectManifest {
            kind: ManifestKind::Pipfile,
            path: pipfile.to_string_lossy().to_string(),
            packages,
            note,
        });
    }

    let setup_cfg = project_root.join("setup.cfg");
    if setup_cfg.exists() {
        let (packages, note) = read_setup_cfg(&setup_cfg);
        manifests.push(ProjectManifest {
            kind: ManifestKind::SetupCfg,
            path: setup_cfg.to_string_lossy().to_string(),
            packages,
            note,
        });
    }

    let setup_py = project_root.join("setup.py");
    if setup_py.exists() {
        let (packages, note) = read_setup_py(&setup_py);
        manifests.push(ProjectManifest {
            kind: ManifestKind::SetupPy,
            path: setup_py.to_string_lossy().to_string(),
            packages,
            note,
        });
    }

    let conda_env = project_root.join("environment.yml");
    if conda_env.exists() {
        let (packages, note) = read_conda_environment(&conda_env);
        manifests.push(ProjectManifest {
            kind: ManifestKind::CondaEnvironment,
            path: conda_env.to_string_lossy().to_string(),
            packages,
            note,
        });
    }

    let pixi_toml = project_root.join("pixi.toml");
    if pixi_toml.exists() {
        let (packages, note) = read_pixi_toml(&pixi_toml);
        manifests.push(ProjectManifest {
            kind: ManifestKind::PixiToml,
            path: pixi_toml.to_string_lossy().to_string(),
            packages,
            note,
        });
    }

    manifests
}

#[tauri::command]
pub fn generate_docker_files(
    _venv_path: String,
    python_version: String,
) -> HashMap<String, String> {
    let mut files = HashMap::new();
    let version = python_version.split(' ').next_back().unwrap_or("3.12");

    let dockerfile = format!(
        r#"# Generated by VOrchestra
FROM python:{}-slim

WORKDIR /app

# Install system dependencies if needed
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy project code
COPY . .

# Default execution
CMD ["python", "main.py"]
"#,
        version
    );

    let compose = r#"# Generated by VOrchestra
services:
  app:
    build: .
    volumes:
      - .:/app
    environment:
      - PYTHONUNBUFFERED=1
"#;

    files.insert("Dockerfile".to_string(), dockerfile);
    files.insert("docker-compose.yml".to_string(), compose.to_string());
    files
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_project_file_name_accepts_plain_names() {
        assert_eq!(
            validate_project_file_name("Dockerfile").unwrap(),
            "Dockerfile"
        );
        assert_eq!(
            validate_project_file_name(" docker-compose.yml ").unwrap(),
            "docker-compose.yml"
        );
    }

    #[test]
    fn validate_project_file_name_rejects_path_traversal() {
        assert!(validate_project_file_name("").is_err());
        assert!(validate_project_file_name("../Dockerfile").is_err());
        assert!(validate_project_file_name("subdir/Dockerfile").is_err());
        assert!(validate_project_file_name("/tmp/Dockerfile").is_err());
        assert!(validate_project_file_name(r"subdir\Dockerfile").is_err());
    }

    #[test]
    fn generate_docker_files_pins_requested_python_version() {
        let files = generate_docker_files("unused".to_string(), "Python 3.11.9".to_string());
        let dockerfile = files.get("Dockerfile").unwrap();
        let compose = files.get("docker-compose.yml").unwrap();

        assert!(dockerfile.contains("FROM python:3.11.9-slim"));
        assert!(dockerfile.contains("COPY requirements.txt ."));
        assert!(compose.contains("PYTHONUNBUFFERED=1"));
    }

    #[test]
    fn support_bundle_marks_native_managers_read_only() {
        let conda = native_manager_support_metadata("conda");
        assert_eq!(conda["read_only"], true);
        assert!(conda["reason"].as_str().unwrap().contains("Conda"));
        assert!(conda["suggested_commands"]
            .as_array()
            .unwrap()
            .iter()
            .any(|cmd| cmd == "conda env export"));

        let pip = native_manager_support_metadata("pip");
        assert_eq!(pip["read_only"], false);
        assert!(pip["suggested_commands"].as_array().unwrap().is_empty());
    }
}
