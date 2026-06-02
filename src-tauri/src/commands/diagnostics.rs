//! Diagnostics commands: pip check, outdated packages, security audit.
//! Includes the cancellable background-job orchestrators that the Studio
//! Diagnostics panel consumes through Tauri events with snapshot fallback.

use crate::helpers::{
    detect_manager_type, ensure_venv_dir, get_manager_path, get_python_path, new_command,
    parse_outdated_packages_json, parse_security_audit_json_from_output, run_command_with_timeout,
    run_command_with_timeout_cancel_and_output, stdout_or_stderr, uv_cache_dir_for,
};
use crate::jobs::{
    append_job_log, cleanup_finished_jobs, create_background_job, set_job_status, snapshot_json,
    AppState,
};
use crate::package_managers::{manager_for_engine, pip_audit_install_hint_for_engine};
use crate::policy_engine::{
    attach_policy_to_security_report, empty_decision, evaluate_metadata_policy,
    load_policy_for_project, project_root_from_venv,
};
use crate::types::{DeprecatedPackage, LicenseBucket, PackageMetadataAudit, SuspiciousPackage};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::Ordering;

// ---- Background job runners (Studio Diagnostics + Security panels) -------

#[tauri::command]
pub fn start_diagnostics_job(
    venv_path: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let (job_id, job) = create_background_job(&state)?;
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome =
            tauri::async_runtime::spawn_blocking(move || -> Result<serde_json::Value, String> {
                let venv = ensure_venv_dir(&venv_path)?;
                let manager = detect_manager_type(&venv);
                let python = get_python_path(&venv);

                let mut check_cmd = if matches!(manager.as_str(), "pip" | "uv") {
                    manager_for_engine(&manager)?
                        .check_command(&venv)
                        .to_command()
                } else {
                    let mut c = new_command(&python);
                    c.args(["-m", "pip", "check"]);
                    c
                };
                let health_out = run_command_with_timeout_cancel_and_output(
                    &mut check_cmd,
                    90,
                    blocking_job.cancel.as_ref(),
                    |stream, line| append_job_log(&blocking_job, stream, line),
                )?;
                let health = if health_out.status.success() {
                    "No conflicts found.".to_string()
                } else {
                    stdout_or_stderr(&health_out)
                };

                let mut outdated_cmd = if matches!(manager.as_str(), "pip" | "uv") {
                    manager_for_engine(&manager)?
                        .outdated_command(&venv)
                        .to_command()
                } else {
                    let mut c = new_command(&python);
                    c.args(["-m", "pip", "list", "--outdated", "--format=json"]);
                    c
                };
                let outdated_out = run_command_with_timeout_cancel_and_output(
                    &mut outdated_cmd,
                    120,
                    blocking_job.cancel.as_ref(),
                    |stream, line| append_job_log(&blocking_job, stream, line),
                )?;
                if !outdated_out.status.success() {
                    let raw = stdout_or_stderr(&outdated_out);
                    return Err(format!(
                        "Failed to list outdated packages: {}",
                        diagnostics_tool_failure_hint(&manager, raw.trim())
                    ));
                }
                let outdated = parse_outdated_packages_json(&outdated_out.stdout)?;

                Ok(serde_json::json!({
                    "health": health,
                    "outdated": outdated
                }))
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
pub fn start_security_audit_job(
    venv_path: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let (job_id, job) = create_background_job(&state)?;
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome =
            tauri::async_runtime::spawn_blocking(move || -> Result<serde_json::Value, String> {
                let venv = ensure_venv_dir(&venv_path)?;
                let manager = detect_manager_type(&venv);
                let python_path = get_python_path(&venv);
                let python_str = python_path.to_string_lossy().to_string();

                let mut cmd = new_command(&python_path);
                cmd.args(["-m", "pip_audit", "--format", "json"]);
                let out = run_command_with_timeout_cancel_and_output(
                    &mut cmd,
                    180,
                    blocking_job.cancel.as_ref(),
                    |stream, line| append_job_log(&blocking_job, stream, line),
                )?;

                let raw_report = if out.status.success() {
                    parse_security_audit_json_from_output(&out)
                } else {
                    let err_msg = String::from_utf8_lossy(&out.stderr).to_string();
                    if err_msg.contains("No module named pip_audit") {
                        if manager == "uv" {
                            let uv_path = get_manager_path("uv");
                            let mut uvx = new_command(uv_path);
                            uvx.env("UV_CACHE_DIR", uv_cache_dir_for(&venv));
                            uvx.args([
                                "tool",
                                "run",
                                "--from",
                                "pip-audit",
                                "pip-audit",
                                "--format",
                                "json",
                                "--python",
                                &python_str,
                            ]);
                            let uvx_out = run_command_with_timeout_cancel_and_output(
                                &mut uvx,
                                240,
                                blocking_job.cancel.as_ref(),
                                |stream, line| append_job_log(&blocking_job, stream, line),
                            )?;
                            if uvx_out.status.success() || !uvx_out.stdout.is_empty() {
                                parse_security_audit_json_from_output(&uvx_out)
                            } else {
                                Err(format!(
                                    "pip-audit not installed in this environment. Install with: {}",
                                    pip_audit_install_hint_for_engine(&manager, &python_str)
                                ))
                            }
                        } else {
                            Err(format!(
                                "pip-audit not installed in this environment. Install with: {}",
                                pip_audit_install_hint_for_engine(&manager, &python_str)
                            ))
                        }
                    } else if !out.stdout.is_empty() {
                        parse_security_audit_json_from_output(&out)
                    } else {
                        Err(err_msg)
                    }
                }?;
                attach_policy_to_security_report(&project_root_from_venv(&venv), raw_report)
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

fn diagnostics_tool_failure_hint(manager: &str, raw_error: &str) -> String {
    if matches!(manager, "conda" | "pixi")
        && raw_error.to_lowercase().contains("no module named pip")
    {
        return format!(
            "{} environment does not expose pip for this check. Use the native manager for outdated-package review.",
            manager
        );
    }

    raw_error.to_string()
}

fn parse_package_metadata_audit(raw: &str) -> Result<PackageMetadataAudit, String> {
    #[derive(serde::Deserialize)]
    struct RawPackage {
        name: String,
        license: Option<String>,
        deprecated_reason: Option<String>,
    }

    let rows: Vec<RawPackage> = serde_json::from_str(raw)
        .map_err(|e| format!("Failed to parse package metadata audit: {}", e))?;
    let mut licenses: BTreeMap<String, usize> = BTreeMap::new();
    let mut missing_license = Vec::new();
    let mut suspicious_packages = Vec::new();
    let mut deprecated_packages = Vec::new();

    for row in &rows {
        if let Some(reason) = suspicious_package_reason(&row.name) {
            suspicious_packages.push(SuspiciousPackage {
                name: row.name.clone(),
                reason,
            });
        }
        if let Some(reason) = row
            .deprecated_reason
            .as_deref()
            .map(str::trim)
            .filter(|reason| !reason.is_empty())
        {
            deprecated_packages.push(DeprecatedPackage {
                name: row.name.clone(),
                reason: reason.to_string(),
            });
        }
        let license = row.license.as_deref().map(str::trim).filter(|value| {
            !value.is_empty()
                && !matches!(
                    value.to_ascii_lowercase().as_str(),
                    "unknown" | "none" | "license"
                )
        });
        if let Some(license) = license {
            *licenses.entry(license.to_string()).or_insert(0) += 1;
        } else {
            missing_license.push(row.name.clone());
        }
    }

    let mut buckets: Vec<LicenseBucket> = licenses
        .into_iter()
        .map(|(license, count)| LicenseBucket { license, count })
        .collect();
    buckets.sort_by(|a, b| {
        b.count
            .cmp(&a.count)
            .then_with(|| a.license.cmp(&b.license))
    });
    missing_license.sort();
    suspicious_packages.sort_by(|a, b| a.name.cmp(&b.name));
    deprecated_packages.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(PackageMetadataAudit {
        total_packages: rows.len(),
        missing_license,
        licenses: buckets,
        suspicious_packages,
        deprecated_packages,
        policy: empty_decision(None),
    })
}

fn suspicious_package_reason(name: &str) -> Option<String> {
    let normalized = name.to_ascii_lowercase().replace(['_', '.', '-'], "");
    let common_typos = [
        ("reqeusts", "requests"),
        ("requsts", "requests"),
        ("numpi", "numpy"),
        ("nunpy", "numpy"),
        ("pandaz", "pandas"),
        ("panda", "pandas"),
        ("djangoo", "django"),
        ("djagno", "django"),
        ("flaks", "flask"),
        ("fastapii", "fastapi"),
        ("pytoch", "torch"),
        ("pytroch", "torch"),
        ("tensorfow", "tensorflow"),
        ("beatifulsoup4", "beautifulsoup4"),
        ("beautifulsoup", "beautifulsoup4"),
    ];

    for (typo, expected) in common_typos {
        if normalized == typo {
            return Some(format!(
                "Name resembles the popular package `{}`.",
                expected
            ));
        }
    }

    if normalized.contains("official") || normalized.contains("verified") {
        return Some("Name uses trust-marketing words such as official/verified.".to_string());
    }
    if normalized.starts_with("python") && normalized.len() > "python".len() {
        return Some(
            "Name starts with `python`, which is a common impersonation pattern.".to_string(),
        );
    }
    None
}

#[tauri::command]
pub fn start_package_metadata_audit_job(
    venv_path: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let (job_id, job) = create_background_job(&state)?;
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome =
            tauri::async_runtime::spawn_blocking(move || -> Result<serde_json::Value, String> {
                let venv = ensure_venv_dir(&venv_path)?;
                let python = get_python_path(&venv);
                let script = r#"import importlib.metadata as m, json
rows = []
for dist in m.distributions():
    meta = dist.metadata
    name = meta.get("Name") or meta.get("name") or dist.name
    license_value = meta.get("License") or ""
    classifiers = meta.get_all("Classifier") or []
    summary = meta.get("Summary") or ""
    license_classifiers = [
        c.split("::")[-1].strip()
        for c in classifiers
        if c.startswith("License ::")
    ]
    if (not license_value or license_value.lower() in {"unknown", "license"}) and license_classifiers:
        license_value = ", ".join(sorted(set(license_classifiers)))
    deprecated_reasons = []
    if any(c.strip() == "Development Status :: 7 - Inactive" for c in classifiers):
        deprecated_reasons.append("Classifier marks project inactive")
    if "deprecated" in summary.lower():
        deprecated_reasons.append("Summary mentions deprecated")
    rows.append({"name": name, "license": license_value, "deprecated_reason": "; ".join(deprecated_reasons)})
print(json.dumps(rows))
"#;
                let mut cmd = new_command(python);
                cmd.arg("-c").arg(script);
                let out = run_command_with_timeout_cancel_and_output(
                    &mut cmd,
                    120,
                    blocking_job.cancel.as_ref(),
                    |stream, line| append_job_log(&blocking_job, stream, line),
                )?;
                if !out.status.success() {
                    return Err(stdout_or_stderr(&out));
                }
                let raw = String::from_utf8_lossy(&out.stdout);
                let mut audit = parse_package_metadata_audit(&raw)?;
                let project_root = project_root_from_venv(&venv);
                if let Some((config, path)) = load_policy_for_project(&project_root)? {
                    let license_pairs: Vec<(String, usize)> = audit
                        .licenses
                        .iter()
                        .map(|bucket| (bucket.license.clone(), bucket.count))
                        .collect();
                    audit.policy = evaluate_metadata_policy(
                        &config,
                        Some(&path),
                        &audit.missing_license,
                        &license_pairs,
                        &audit.suspicious_packages,
                        &audit.deprecated_packages,
                    );
                }
                serde_json::to_value(audit).map_err(|e| e.to_string())
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
pub async fn export_package_sbom(venv_path: String, output_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let venv = ensure_venv_dir(&venv_path)?;
        let python = get_python_path(&venv);
        let script = r#"import datetime, importlib.metadata as m, json
components = []
for dist in m.distributions():
    meta = dist.metadata
    name = meta.get("Name") or meta.get("name") or dist.name
    version = dist.version or meta.get("Version") or ""
    license_value = meta.get("License") or ""
    classifiers = meta.get_all("Classifier") or []
    license_classifiers = [
        c.split("::")[-1].strip()
        for c in classifiers
        if c.startswith("License ::")
    ]
    if (not license_value or license_value.lower() in {"unknown", "license"}) and license_classifiers:
        license_value = ", ".join(sorted(set(license_classifiers)))
    component = {
        "type": "library",
        "name": name,
        "version": version,
        "purl": f"pkg:pypi/{name.lower().replace('_', '-')}@{version}" if version else f"pkg:pypi/{name.lower().replace('_', '-')}"
    }
    if license_value and license_value.lower() not in {"unknown", "none", "license"}:
        component["licenses"] = [{"license": {"name": license_value}}]
    components.append(component)
components.sort(key=lambda item: item["name"].lower())
bom = {
    "bomFormat": "CycloneDX",
    "specVersion": "1.5",
    "version": 1,
    "metadata": {
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "tools": {"components": [{"type": "application", "name": "VOrchestra"}]}
    },
    "components": components
}
print(json.dumps(bom))
"#;
        let mut cmd = new_command(python);
        cmd.arg("-c").arg(script);
        let out = run_command_with_timeout(&mut cmd, 120)?;
        if !out.status.success() {
            return Err(stdout_or_stderr(&out));
        }

        let bom: serde_json::Value = serde_json::from_slice(&out.stdout)
            .map_err(|e| format!("Failed to parse generated SBOM: {}", e))?;
        let content = serde_json::to_string_pretty(&bom)
            .map_err(|e| format!("Failed to serialize generated SBOM: {}", e))?;
        let target = PathBuf::from(&output_path);
        if let Some(parent) = target.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create output directory: {}", e))?;
            }
        }
        fs::write(&target, content).map_err(|e| format!("Failed to write SBOM: {}", e))?;
        Ok(format!("Wrote CycloneDX SBOM to {}", target.to_string_lossy()))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn get_background_job(
    job_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    cleanup_finished_jobs(&state, 10 * 60 * 1000)?;
    let handle = {
        let jobs = state
            .jobs
            .lock()
            .map_err(|_| "Failed to lock job store".to_string())?;
        jobs.get(&job_id).cloned()
    };
    let Some(handle) = handle else {
        return Err("Job not found".to_string());
    };
    snapshot_json(&handle)
}

#[tauri::command]
pub fn cancel_background_job(
    job_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    let handle = {
        let jobs = state
            .jobs
            .lock()
            .map_err(|_| "Failed to lock job store".to_string())?;
        jobs.get(&job_id).cloned()
    };
    let Some(handle) = handle else {
        return Ok(false);
    };
    handle.cancel.store(true, Ordering::Relaxed);
    set_job_status(&handle, "cancelling", None, None);
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metadata_audit_flags_suspicious_names_without_blocking() {
        let raw = r#"[
            {"name": "requests", "license": "Apache-2.0"},
            {"name": "reqeusts", "license": ""},
            {"name": "python-fastapi-official", "license": "MIT"},
            {"name": "oldlib", "license": "BSD", "deprecated_reason": "Classifier marks project inactive"}
        ]"#;

        let audit = parse_package_metadata_audit(raw).expect("valid audit");

        assert_eq!(audit.total_packages, 4);
        assert_eq!(audit.missing_license, vec!["reqeusts"]);
        assert_eq!(audit.licenses[0].license, "Apache-2.0");
        assert_eq!(audit.suspicious_packages.len(), 2);
        assert_eq!(audit.deprecated_packages.len(), 1);
        assert_eq!(audit.deprecated_packages[0].name, "oldlib");
        assert!(audit
            .suspicious_packages
            .iter()
            .any(|pkg| pkg.name == "reqeusts" && pkg.reason.contains("requests")));
        assert!(audit
            .suspicious_packages
            .iter()
            .any(|pkg| pkg.name == "python-fastapi-official"));
    }

    #[test]
    fn pip_audit_hint_matches_environment_manager() {
        assert_eq!(
            pip_audit_install_hint_for_engine("pip", "/venv/bin/python"),
            "pip install pip-audit"
        );
        assert_eq!(
            pip_audit_install_hint_for_engine("uv", "/venv/bin/python"),
            "uv pip install --python \"/venv/bin/python\" pip-audit"
        );
        assert_eq!(
            pip_audit_install_hint_for_engine("conda", "/venv/bin/python"),
            "conda install -c conda-forge pip-audit"
        );
        assert_eq!(
            pip_audit_install_hint_for_engine("pixi", "/venv/bin/python"),
            "pixi add pip-audit"
        );
    }

    #[test]
    fn native_manager_diagnostics_failure_hides_raw_missing_pip() {
        let hint = diagnostics_tool_failure_hint("conda", "/env/bin/python: No module named pip");
        assert!(hint.contains("native manager"));
        assert!(!hint.contains("/env/bin/python"));

        let pip_hint = diagnostics_tool_failure_hint("pip", "/env/bin/python: No module named pip");
        assert!(pip_hint.contains("/env/bin/python"));
    }
}
