//! Tauri command implementations grouped by domain. The submodules are
//! `pub` so `lib.rs` can pass each `#[tauri::command]` symbol into
//! `tauri::generate_handler!`.

pub mod bundle;
pub mod cache;
pub mod diagnostics;
pub mod files;
pub mod integrations;
pub mod integrations_extra;
pub mod local_ai;
pub mod lockfile;
pub mod packages;
pub mod project;
pub mod snapshots;
pub mod system;
pub mod venv;
