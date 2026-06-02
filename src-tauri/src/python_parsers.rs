//! Pure parsers for Python tool output.
//!
//! This module intentionally has no filesystem, process, or Tauri
//! dependencies. It keeps command helpers focused on orchestration while
//! making parser behavior easier to test in isolation.

use crate::types::{OutdatedPackage, PythonVersion};
use std::collections::{HashMap, HashSet};
use std::process::Output;

pub fn parse_outdated_packages_json(raw: &[u8]) -> Result<Vec<OutdatedPackage>, String> {
    let value: serde_json::Value = serde_json::from_slice(raw).map_err(|e| e.to_string())?;
    let arr = value
        .as_array()
        .ok_or_else(|| "Invalid outdated packages response format".to_string())?;
    let mut items = Vec::with_capacity(arr.len());
    for row in arr {
        let name = row
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let version = row
            .get("version")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let latest_version = row
            .get("latest_version")
            .or_else(|| row.get("latest-version"))
            .or_else(|| row.get("latest"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if !name.is_empty() {
            items.push(OutdatedPackage {
                name,
                version,
                latest_version,
            });
        }
    }
    Ok(items)
}

/// Parses a `pip freeze` style text body into a map of normalized package
/// name -> version. Empty lines and comments (`#`) are skipped, and entries
/// without `==` are ignored.
pub fn parse_pip_freeze(text: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with("-e ") {
            continue;
        }
        // Strip pip freeze inline comments / VCS specs after the version.
        let core = line.split(';').next().unwrap_or(line).trim();
        if let Some((name, version)) = core.split_once("==") {
            let name_norm = normalize_package_name(name);
            if !name_norm.is_empty() {
                map.insert(name_norm, version.trim().to_string());
            }
        }
    }
    map
}

/// PEP 503 style canonical name: lowercased, runs of `[._-]` collapsed
/// into a single `-`.
pub fn normalize_package_name(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut last_was_sep = false;
    for ch in raw.trim().chars() {
        let is_sep = ch == '_' || ch == '.' || ch == '-';
        if is_sep {
            if !last_was_sep && !out.is_empty() {
                out.push('-');
            }
            last_was_sep = true;
        } else {
            out.extend(ch.to_lowercase());
            last_was_sep = false;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    out
}

pub fn parse_security_audit_json_from_output(out: &Output) -> Result<serde_json::Value, String> {
    if out.stdout.is_empty() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "pip-audit produced no output. Verify it is installed in this environment.".to_string()
        } else {
            format!("pip-audit produced no JSON output. Stderr: {}", stderr)
        });
    }
    serde_json::from_slice(&out.stdout).map_err(|e| {
        let preview: String = String::from_utf8_lossy(&out.stdout)
            .chars()
            .take(200)
            .collect();
        format!("Failed to parse pip-audit output ({}): {}", e, preview)
    })
}

/// Parse the text output of `uv python list [--all-versions]` into a
/// deduplicated list of Python versions.
pub fn parse_uv_python_list(text: &str) -> Vec<PythonVersion> {
    let mut versions: Vec<PythonVersion> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }

        let mut parts = line.splitn(2, char::is_whitespace);
        let key = match parts.next() {
            Some(k) if !k.is_empty() => k,
            _ => continue,
        };
        let rest = parts.next().unwrap_or("").trim();

        // Extract bare version: cpython-3.13.0-... -> 3.13.0
        let stripped = key
            .strip_prefix("cpython-")
            .or_else(|| key.strip_prefix("pypy-"))
            .or_else(|| key.strip_prefix("graalpy-"))
            .unwrap_or(key);
        let version = stripped
            .split_once('-')
            .map(|(v, _)| v)
            .unwrap_or(stripped)
            .to_string();
        if version.is_empty() || !version.chars().next().is_some_and(|c| c.is_ascii_digit()) {
            continue;
        }

        let installed = !rest.is_empty() && !rest.starts_with("<download");
        let path = if installed {
            rest.split_whitespace().next().map(|s| s.to_string())
        } else {
            None
        };

        let dedupe_key = format!("{}::{}", version, installed);
        if seen.contains(&dedupe_key) {
            continue;
        }
        seen.insert(dedupe_key);

        versions.push(PythonVersion {
            version: version.clone(),
            key: format!("cpython-{}", version),
            installed,
            path,
        });
    }

    versions.sort_by(|a, b| {
        b.installed
            .cmp(&a.installed)
            .then_with(|| compare_versions_desc(&a.version, &b.version))
    });
    versions
}

/// Compare semver-ish strings in descending order.
fn compare_versions_desc(a: &str, b: &str) -> std::cmp::Ordering {
    let parts = |s: &str| -> Vec<u32> {
        s.split('.')
            .map(|p| p.parse::<u32>().unwrap_or(0))
            .collect()
    };
    let pa = parts(a);
    let pb = parts(b);
    pb.cmp(&pa)
}
