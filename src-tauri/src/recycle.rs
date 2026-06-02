//! Recoverable filesystem deletion helpers.
//!
//! VOrchestra moves environment folders into a workspace-local trash folder
//! instead of deleting them immediately. This keeps the operation fast,
//! same-filesystem, and reversible without pulling platform-specific deps.

use std::fs;
use std::path::{Path, PathBuf};

use crate::jobs::now_ms;

pub fn recycle_dir(path: &Path) -> Result<PathBuf, String> {
    if !path.exists() {
        return Err("Path not found".to_string());
    }
    if !path.is_dir() {
        return Err("Path is not a directory".to_string());
    }

    let parent = path
        .parent()
        .ok_or_else(|| "Cannot recycle a directory without a parent".to_string())?;
    let trash_root = parent.join(".vorchestra-trash");
    fs::create_dir_all(&trash_root).map_err(|e| format!("Failed to create trash: {}", e))?;

    let original_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "venv".to_string());
    let mut target = trash_root.join(format!("{}-{}", original_name, now_ms()));
    let mut suffix = 1usize;
    while target.exists() {
        target = trash_root.join(format!("{}-{}-{}", original_name, now_ms(), suffix));
        suffix += 1;
    }

    fs::rename(path, &target).map_err(|e| format!("Failed to move to trash: {}", e))?;
    Ok(target)
}
