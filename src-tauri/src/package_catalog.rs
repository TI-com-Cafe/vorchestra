//! Package catalog helpers for PyPI lookups.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};

const PYPI_CACHE_TTL_SECS: u64 = 6 * 60 * 60;

#[derive(Debug, Serialize, Deserialize)]
struct CachedPyPiResponse {
    package: String,
    cached_at_unix: u64,
    value: serde_json::Value,
}

pub(crate) fn normalize_pypi_query(query: &str) -> Result<String, String> {
    let normalized = query.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return Err("Type a package name to search.".to_string());
    }
    if normalized.len() > 214
        || !normalized
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        return Err(
            "PyPI package names can only contain letters, numbers, dot, dash and underscore."
                .to_string(),
        );
    }
    Ok(normalized)
}

pub(crate) async fn search_pypi_package(query: String) -> Result<serde_json::Value, String> {
    let package = normalize_pypi_query(&query)?;
    if let Some(cached) = read_cached_pypi_package(&package, false) {
        return Ok(mark_cached(cached, false));
    }

    let url = format!("https://pypi.org/pypi/{}/json", package);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = match client.get(url).send().await {
        Ok(resp) => resp,
        Err(e) => {
            if let Some(cached) = read_cached_pypi_package(&package, true) {
                return Ok(mark_cached(cached, true));
            }
            return Err(if e.is_timeout() {
                "PyPI search timed out. Check your connection and try again.".to_string()
            } else {
                format!("PyPI search failed: {}", e)
            });
        }
    };
    let status = resp.status();
    if status.is_success() {
        let mut json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        if let Some(releases) = json.get("releases") {
            if let Some(obj) = releases.as_object() {
                let mut versions: Vec<String> = obj.keys().cloned().collect();
                versions.sort_by(|a, b| b.cmp(a));
                json["version_list"] = serde_json::json!(versions);
            }
        }
        write_cached_pypi_package(&package, &json);
        Ok(json)
    } else if status.as_u16() == 404 {
        Err(format!("Package not found: {}", package))
    } else if let Some(cached) = read_cached_pypi_package(&package, true) {
        Ok(mark_cached(cached, true))
    } else {
        Err(format!("PyPI returned HTTP {}", status))
    }
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn pypi_cache_file(package: &str) -> PathBuf {
    let base = dirs::cache_dir().unwrap_or_else(std::env::temp_dir);
    base.join("vorchestra")
        .join("pypi")
        .join(format!("{package}.json"))
}

fn read_cached_pypi_package(package: &str, allow_stale: bool) -> Option<serde_json::Value> {
    let path = pypi_cache_file(package);
    let raw = fs::read_to_string(path).ok()?;
    let cached: CachedPyPiResponse = serde_json::from_str(&raw).ok()?;
    if cached.package != package {
        return None;
    }
    let age = now_unix().saturating_sub(cached.cached_at_unix);
    if !allow_stale && age > PYPI_CACHE_TTL_SECS {
        return None;
    }
    Some(cached.value)
}

fn write_cached_pypi_package(package: &str, value: &serde_json::Value) {
    let path = pypi_cache_file(package);
    let Some(parent) = path.parent() else {
        return;
    };
    if fs::create_dir_all(parent).is_err() {
        return;
    }
    let cached = CachedPyPiResponse {
        package: package.to_string(),
        cached_at_unix: now_unix(),
        value: value.clone(),
    };
    if let Ok(raw) = serde_json::to_string(&cached) {
        let _ = fs::write(path, raw);
    }
}

fn mark_cached(mut value: serde_json::Value, stale: bool) -> serde_json::Value {
    value["_vorchestra_cache"] = serde_json::json!({
        "source": "pypi-cache",
        "stale": stale
    });
    value
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_pypi_query_accepts_valid_names() {
        assert_eq!(
            normalize_pypi_query(" Requests-Tool_2 ").unwrap(),
            "requests-tool_2"
        );
        assert_eq!(normalize_pypi_query("my.pkg").unwrap(), "my.pkg");
    }

    #[test]
    fn normalize_pypi_query_rejects_empty_and_path_like_values() {
        assert!(normalize_pypi_query("   ").is_err());
        assert!(normalize_pypi_query("../requests").is_err());
        assert!(normalize_pypi_query("requests?q=x").is_err());
    }

    #[test]
    fn mark_cached_adds_cache_metadata_without_dropping_payload() {
        let value = serde_json::json!({
            "info": { "name": "requests" },
            "version_list": ["2.32.0"]
        });

        let cached = mark_cached(value, true);

        assert_eq!(cached["info"]["name"], "requests");
        assert_eq!(cached["_vorchestra_cache"]["source"], "pypi-cache");
        assert_eq!(cached["_vorchestra_cache"]["stale"], true);
    }
}
