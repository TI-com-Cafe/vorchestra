//! Cache hygiene: report disk usage of pip's cache, uv's cache, and the
//! per-venv `.uv-cache` directories VOrchestra creates, plus purge any
//! one of them. We never auto-purge — the user explicitly clicks.

use crate::helpers::{ensure_venv_dir, safe_dir_size_mb};
use crate::jobs::{create_background_job, set_job_progress, set_job_status, AppState};
use crate::types::{
    CacheEntry, CacheLocation, CacheSummary, DuplicateWheelGroup, VenvCleanupCandidate,
};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

const TOP_ENTRIES_PER_LOCATION: usize = 12;

/// Locates the OS-conventional pip cache directory.
fn pip_cache_dir() -> Option<PathBuf> {
    // pip honors PIP_CACHE_DIR first, then platform conventions.
    if let Ok(p) = std::env::var("PIP_CACHE_DIR") {
        if !p.is_empty() {
            return Some(PathBuf::from(p));
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(cache) = dirs::cache_dir() {
            return Some(cache.join("pip"));
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Some(home) = dirs::home_dir() {
            return Some(home.join("Library").join("Caches").join("pip"));
        }
    }
    #[cfg(windows)]
    {
        if let Some(local) = dirs::data_local_dir() {
            return Some(local.join("pip").join("Cache"));
        }
    }
    None
}

/// Locates the OS-conventional uv cache directory.
fn uv_cache_dir() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("UV_CACHE_DIR") {
        if !p.is_empty() {
            return Some(PathBuf::from(p));
        }
    }
    #[cfg(unix)]
    {
        if let Some(cache) = dirs::cache_dir() {
            return Some(cache.join("uv"));
        }
    }
    #[cfg(windows)]
    {
        if let Some(local) = dirs::data_local_dir() {
            return Some(local.join("uv").join("cache"));
        }
    }
    None
}

fn list_top_entries(root: &Path, max: usize) -> Vec<CacheEntry> {
    let Ok(read) = fs::read_dir(root) else {
        return Vec::new();
    };
    let mut entries: Vec<CacheEntry> = Vec::new();
    for entry in read.flatten() {
        let p = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let size = if p.is_dir() {
            safe_dir_size_mb(&p, 60_000)
        } else {
            entry
                .metadata()
                .map(|m| (m.len() as f64) / 1024.0 / 1024.0)
                .unwrap_or(0.0)
        };
        entries.push(CacheEntry {
            name,
            path: p.to_string_lossy().to_string(),
            size_mb: size,
        });
    }
    entries.sort_by(|a, b| {
        b.size_mb
            .partial_cmp(&a.size_mb)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    entries.truncate(max);
    entries
}

fn make_location(kind: &str, label: &str, path: PathBuf) -> CacheLocation {
    let exists = path.exists();
    let size_mb = if exists {
        safe_dir_size_mb(&path, 200_000)
    } else {
        0.0
    };
    let top = if exists {
        list_top_entries(&path, TOP_ENTRIES_PER_LOCATION)
    } else {
        Vec::new()
    };
    CacheLocation {
        kind: kind.to_string(),
        label: label.to_string(),
        path: path.to_string_lossy().to_string(),
        size_mb,
        exists,
        top_entries: top,
    }
}

fn find_duplicate_wheels(locations: &[CacheLocation]) -> Vec<DuplicateWheelGroup> {
    let mut by_name: HashMap<String, Vec<(String, f64)>> = HashMap::new();
    for loc in locations.iter().filter(|l| l.exists) {
        for entry in WalkDir::new(&loc.path)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
            .take(200_000)
        {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let Some(name) = path.file_name().map(|s| s.to_string_lossy().to_string()) else {
                continue;
            };
            if !name.ends_with(".whl") {
                continue;
            }
            let size_mb = entry
                .metadata()
                .map(|m| (m.len() as f64) / 1024.0 / 1024.0)
                .unwrap_or(0.0);
            by_name
                .entry(name)
                .or_default()
                .push((path.to_string_lossy().to_string(), size_mb));
        }
    }

    let mut duplicates: Vec<DuplicateWheelGroup> = by_name
        .into_iter()
        .filter_map(|(file_name, copies)| {
            if copies.len() < 2 {
                return None;
            }
            let total_mb = copies.iter().map(|(_, size)| *size).sum();
            Some(DuplicateWheelGroup {
                file_name,
                copies: copies.len(),
                total_mb,
                paths: copies.into_iter().map(|(path, _)| path).collect(),
            })
        })
        .collect();
    duplicates.sort_by(|a, b| {
        b.total_mb
            .partial_cmp(&a.total_mb)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    duplicates.truncate(20);
    duplicates
}

fn venv_cleanup_candidate(path: &str) -> VenvCleanupCandidate {
    let p = PathBuf::from(path);
    let name = p
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());
    let exists = p.exists();
    let size_mb = if exists {
        safe_dir_size_mb(&p, 200_000)
    } else {
        0.0
    };
    let last_modified = p
        .metadata()
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days_since_modified = if exists && last_modified > 0 && now >= last_modified {
        Some((now - last_modified) / 86_400)
    } else {
        None
    };

    let mut signals = Vec::new();
    if !exists {
        signals.push("missing".to_string());
    }
    if size_mb >= 1024.0 {
        signals.push("large".to_string());
    }
    if days_since_modified.is_some_and(|days| days >= 30) {
        signals.push("stale".to_string());
    }
    if signals.is_empty() {
        signals.push("normal".to_string());
    }

    VenvCleanupCandidate {
        name,
        path: path.to_string(),
        size_mb,
        exists,
        last_modified,
        days_since_modified,
        signals,
    }
}

fn cleanup_priority(candidate: &VenvCleanupCandidate) -> u8 {
    let missing = candidate.signals.iter().any(|s| s == "missing");
    let large = candidate.signals.iter().any(|s| s == "large");
    let stale = candidate.signals.iter().any(|s| s == "stale");
    match (missing, large, stale) {
        (true, _, _) => 0,
        (_, true, true) => 1,
        (_, true, false) => 2,
        (_, false, true) => 3,
        _ => 4,
    }
}

/// Returns sizes and top entries for pip cache, uv cache, and any
/// per-venv `.uv-cache` directories under the supplied venv paths.
fn cache_summary_job(
    venv_paths: Vec<String>,
    job: &crate::jobs::BackgroundJobHandle,
) -> Result<CacheSummary, String> {
    let mut locations: Vec<CacheLocation> = Vec::new();
    let mut venvs: Vec<VenvCleanupCandidate> = Vec::new();
    set_job_progress(job, "Inspecting pip cache...", Some(0.15));
    if let Some(p) = pip_cache_dir() {
        locations.push(make_location("pip", "pip cache", p));
    }
    set_job_progress(job, "Inspecting uv cache...", Some(0.35));
    if let Some(p) = uv_cache_dir() {
        locations.push(make_location("uv", "uv cache", p));
    }

    let total_venvs = venv_paths.len().max(1);
    for (idx, venv_path) in venv_paths.iter().enumerate() {
        if job.cancel.load(Ordering::Relaxed) {
            return Err("Cancelled by user".to_string());
        }
        set_job_progress(
            job,
            format!("Inspecting environments... {}/{}", idx + 1, total_venvs),
            Some(0.45 + (idx as f64 / total_venvs as f64) * 0.45),
        );
        venvs.push(venv_cleanup_candidate(venv_path));
        let Ok(venv) = ensure_venv_dir(venv_path) else {
            continue;
        };
        let inner = venv.join(".uv-cache");
        if inner.exists() {
            let label = format!(
                "{} (per-venv uv cache)",
                venv.file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| "venv".to_string())
            );
            locations.push(make_location("uv_per_venv", &label, inner));
        }
    }

    set_job_progress(job, "Detecting duplicate wheels...", Some(0.92));
    let duplicate_wheels = find_duplicate_wheels(&locations);
    let total_mb = locations.iter().map(|l| l.size_mb).sum();
    let total_venv_mb = venvs.iter().map(|v| v.size_mb).sum();
    venvs.sort_by(|a, b| {
        cleanup_priority(a).cmp(&cleanup_priority(b)).then_with(|| {
            b.size_mb
                .partial_cmp(&a.size_mb)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
    });
    set_job_progress(job, "Cache summary ready.", Some(0.95));
    Ok(CacheSummary {
        locations,
        total_mb,
        duplicate_wheels,
        venvs,
        total_venv_mb,
    })
}

#[tauri::command]
pub fn start_get_cache_summary_job(
    venv_paths: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let (job_id, job) = create_background_job(&state)?;
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            cache_summary_job(venv_paths, &blocking_job)
                .and_then(|summary| serde_json::to_value(summary).map_err(|e| e.to_string()))
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

/// Removes the contents of a cache directory previously surfaced by
/// `get_cache_summary`. We re-create the directory afterwards so pip /
/// uv don't stumble on the missing path. Defensive: only paths whose
/// final segment matches a known cache name are accepted, so a
/// malicious frontend payload can't aim this at a user folder.
fn purge_cache_at_job(
    path: String,
    job: &crate::jobs::BackgroundJobHandle,
) -> Result<String, String> {
    set_job_progress(job, "Validating cache path...", Some(0.1));
    let target = PathBuf::from(&path);
    let canon = fs::canonicalize(&target).map_err(|e| format!("Path not found: {}", e))?;

    let allowed = is_allowed_cache_path(&canon);
    if !allowed {
        return Err(format!(
            "Refusing to purge a path that does not look like a known cache directory: {}",
            canon.to_string_lossy()
        ));
    }

    let entries = fs::read_dir(&canon)
        .map_err(|e| e.to_string())?
        .flatten()
        .collect::<Vec<_>>();
    let total = entries.len().max(1);
    let mut removed: u64 = 0;
    let mut errors: Vec<String> = Vec::new();

    for (idx, entry) in entries.into_iter().enumerate() {
        if job.cancel.load(Ordering::Relaxed) {
            return Err("Cancelled by user".to_string());
        }

        let p = entry.path();
        set_job_progress(
            job,
            format!(
                "Removing {}",
                p.file_name().unwrap_or_default().to_string_lossy()
            ),
            Some(0.2 + ((idx as f64 / total as f64) * 0.7)),
        );
        let res = if p.is_dir() {
            fs::remove_dir_all(&p)
        } else {
            fs::remove_file(&p)
        };
        match res {
            Ok(_) => removed += 1,
            Err(e) => errors.push(format!("{}: {}", p.to_string_lossy(), e)),
        }
    }

    if errors.is_empty() {
        set_job_progress(job, "Cache purge finished.", Some(0.95));
        Ok(format!(
            "Cleared {} entries from {}",
            removed,
            canon.to_string_lossy()
        ))
    } else {
        Err(format!(
            "Removed {} entries; {} failed: {}",
            removed,
            errors.len(),
            errors.join("; ")
        ))
    }
}

#[tauri::command]
pub fn start_purge_cache_job(
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let (job_id, job) = create_background_job(&state)?;
    tauri::async_runtime::spawn(async move {
        let blocking_job = job.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            purge_cache_at_job(path, &blocking_job).map(serde_json::Value::String)
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

/// Allow-list check: the canonical path must be either a pip cache, a uv
/// cache, or a `.uv-cache` directory under some venv. We don't accept
/// arbitrary user-typed paths.
fn is_allowed_cache_path(canon: &Path) -> bool {
    if let Some(p) = pip_cache_dir() {
        if let Ok(c) = fs::canonicalize(&p) {
            if c == canon {
                return true;
            }
        }
    }
    if let Some(p) = uv_cache_dir() {
        if let Ok(c) = fs::canonicalize(&p) {
            if c == canon {
                return true;
            }
        }
    }
    canon.file_name().map(|s| s == ".uv-cache").unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn find_duplicate_wheels_groups_same_file_name_across_cache_dirs() {
        let root = tempdir();
        let cache_a = root.join("pip");
        let cache_b = root.join("uv");
        fs::create_dir_all(&cache_a).unwrap();
        fs::create_dir_all(&cache_b).unwrap();
        fs::write(cache_a.join("demo-1.0.0-py3-none-any.whl"), vec![1u8; 1024]).unwrap();
        fs::write(cache_b.join("demo-1.0.0-py3-none-any.whl"), vec![2u8; 2048]).unwrap();
        fs::write(
            cache_b.join("other-1.0.0-py3-none-any.whl"),
            vec![3u8; 1024],
        )
        .unwrap();

        let locations = vec![
            CacheLocation {
                kind: "pip".to_string(),
                label: "pip cache".to_string(),
                path: cache_a.to_string_lossy().to_string(),
                size_mb: 0.0,
                exists: true,
                top_entries: vec![],
            },
            CacheLocation {
                kind: "uv".to_string(),
                label: "uv cache".to_string(),
                path: cache_b.to_string_lossy().to_string(),
                size_mb: 0.0,
                exists: true,
                top_entries: vec![],
            },
        ];

        let duplicates = find_duplicate_wheels(&locations);

        assert_eq!(duplicates.len(), 1);
        assert_eq!(duplicates[0].file_name, "demo-1.0.0-py3-none-any.whl");
        assert_eq!(duplicates[0].copies, 2);
        assert_eq!(duplicates[0].paths.len(), 2);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cleanup_priority_orders_actionable_envs_before_normal_size() {
        let candidate = |name: &str, size_mb: f64, signals: Vec<&str>| VenvCleanupCandidate {
            name: name.to_string(),
            path: format!("/tmp/{}", name),
            size_mb,
            exists: !signals.contains(&"missing"),
            last_modified: 0,
            days_since_modified: None,
            signals: signals.into_iter().map(str::to_string).collect(),
        };

        let mut venvs = vec![
            candidate("normal-huge", 50_000.0, vec!["normal"]),
            candidate("stale-small", 10.0, vec!["stale"]),
            candidate("large-stale", 2048.0, vec!["large", "stale"]),
            candidate("missing", 0.0, vec!["missing"]),
            candidate("large", 4096.0, vec!["large"]),
        ];

        venvs.sort_by(|a, b| {
            cleanup_priority(a).cmp(&cleanup_priority(b)).then_with(|| {
                b.size_mb
                    .partial_cmp(&a.size_mb)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
        });

        let ordered: Vec<String> = venvs.into_iter().map(|v| v.name).collect();
        assert_eq!(
            ordered,
            vec![
                "missing",
                "large-stale",
                "large",
                "stale-small",
                "normal-huge"
            ]
        );
    }

    fn tempdir() -> PathBuf {
        let mut p = std::env::temp_dir();
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        p.push(format!(
            "vorchestra-cache-test-{}-{}",
            std::process::id(),
            nanos
        ));
        fs::create_dir_all(&p).unwrap();
        p
    }
}
