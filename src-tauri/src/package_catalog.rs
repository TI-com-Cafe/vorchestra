//! Package catalog helpers for PyPI lookups.

use std::time::Duration;

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
    let url = format!("https://pypi.org/pypi/{}/json", package);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(url).send().await.map_err(|e| {
        if e.is_timeout() {
            "PyPI search timed out. Check your connection and try again.".to_string()
        } else {
            e.to_string()
        }
    })?;
    if resp.status().is_success() {
        let mut json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        if let Some(releases) = json.get("releases") {
            if let Some(obj) = releases.as_object() {
                let mut versions: Vec<String> = obj.keys().cloned().collect();
                versions.sort_by(|a, b| b.cmp(a));
                json["version_list"] = serde_json::json!(versions);
            }
        }
        Ok(json)
    } else if resp.status().as_u16() == 404 {
        Err(format!("Package not found: {}", package))
    } else {
        Err(format!("PyPI returned HTTP {}", resp.status()))
    }
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
}
