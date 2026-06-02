//! Disk-size scanning for installed package folders.

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::helpers::safe_dir_size_mb;

pub fn scan_package_sizes(
    venv_path: &str,
    cancel: Option<&AtomicBool>,
    mut on_progress: impl FnMut(String, Option<f64>),
) -> Result<HashMap<String, f64>, String> {
    let mut sizes = HashMap::new();
    let p = Path::new(venv_path);

    #[cfg(not(windows))]
    let lib_dir = p.join("lib");
    #[cfg(windows)]
    let lib_dir = p.join("Lib").join("site-packages");

    #[cfg(not(windows))]
    if let Ok(entries) = fs::read_dir(lib_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() && entry.file_name().to_string_lossy().starts_with("python") {
                scan_site_packages(
                    &path.join("site-packages"),
                    cancel,
                    &mut on_progress,
                    &mut sizes,
                )?;
            }
        }
    }

    #[cfg(windows)]
    scan_site_packages(&lib_dir, cancel, &mut on_progress, &mut sizes)?;

    Ok(sizes)
}

fn scan_site_packages(
    site_pkgs: &Path,
    cancel: Option<&AtomicBool>,
    on_progress: &mut impl FnMut(String, Option<f64>),
    sizes: &mut HashMap<String, f64>,
) -> Result<(), String> {
    if !site_pkgs.exists() {
        return Ok(());
    }
    let Ok(pkg_entries) = fs::read_dir(site_pkgs) else {
        return Ok(());
    };
    let pkgs: Vec<_> = pkg_entries.flatten().collect();
    let total = pkgs.len().max(1);
    for (idx, pkg) in pkgs.into_iter().enumerate() {
        if cancel.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
            return Err("Cancelled by user".to_string());
        }
        let pkg_path = pkg.path();
        let name = pkg.file_name().to_string_lossy().to_string();
        if !name.ends_with(".dist-info") && !name.starts_with("__") {
            on_progress(
                format!("Measuring {}", name),
                Some(0.2 + ((idx as f64 / total as f64) * 0.7)),
            );
            sizes.insert(name, safe_dir_size_mb(&pkg_path, 120_000));
        }
    }
    Ok(())
}
