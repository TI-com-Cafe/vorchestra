//! VOrchestra — Tauri backend.
//!
//! `lib.rs` is intentionally thin: it wires the module tree together,
//! plugs in Tauri plugins / state / migrations, and registers the
//! command handlers. All implementation lives in the submodules.

pub mod command_runner;
pub mod commands;
pub mod dependency_tree;
pub mod helpers;
pub mod jobs;
pub mod lockfile_report;
pub mod package_analysis;
pub mod package_catalog;
pub mod package_hygiene;
pub mod package_jobs;
pub mod package_managers;
pub mod package_ops;
pub mod package_sizes;
pub mod policy_engine;
pub mod process_utils;
pub mod project_manifest;
pub mod python_parsers;
pub mod recycle;
pub mod runtime_installers;
pub mod types;
pub mod venv_diff;
pub mod venv_freeze;
pub mod venv_inspection;

use jobs::{attach_app_handle, AppState};
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration { version: 1, description: "init", sql: "CREATE TABLE workspaces (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT UNIQUE); CREATE TABLE venvs (id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_path TEXT, name TEXT, path TEXT UNIQUE, version TEXT, status TEXT, issue TEXT);", kind: MigrationKind::Up },
        Migration { version: 2, description: "last_mod", sql: "ALTER TABLE venvs ADD COLUMN last_modified INTEGER DEFAULT 0;", kind: MigrationKind::Up },
        Migration { version: 3, description: "scripts", sql: "CREATE TABLE scripts (id INTEGER PRIMARY KEY AUTOINCREMENT, venv_path TEXT, name TEXT, command TEXT);", kind: MigrationKind::Up },
        Migration { version: 4, description: "custom_templates", sql: "CREATE TABLE custom_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, packages TEXT);", kind: MigrationKind::Up },
        Migration { version: 5, description: "orchestrator_fields", sql: "ALTER TABLE venvs ADD COLUMN manager_type TEXT DEFAULT 'pip'; ALTER TABLE venvs ADD COLUMN pyproject_path TEXT;", kind: MigrationKind::Up },
        Migration { version: 6, description: "default_workspace", sql: "ALTER TABLE workspaces ADD COLUMN is_default INTEGER DEFAULT 0;", kind: MigrationKind::Up },
        Migration { version: 7, description: "indices", sql: "CREATE INDEX IF NOT EXISTS idx_venvs_workspace_path ON venvs(workspace_path); CREATE INDEX IF NOT EXISTS idx_scripts_venv_path ON scripts(venv_path);", kind: MigrationKind::Up },
        Migration { version: 8, description: "venv_template_name", sql: "ALTER TABLE venvs ADD COLUMN template_name TEXT;", kind: MigrationKind::Up }
    ];

    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:vorchestra.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let state = app.state::<AppState>();
            attach_app_handle(&state, app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Diagnostics & background jobs
            commands::diagnostics::start_diagnostics_job,
            commands::diagnostics::start_security_audit_job,
            commands::diagnostics::start_package_metadata_audit_job,
            commands::diagnostics::export_package_sbom,
            commands::diagnostics::get_background_job,
            commands::diagnostics::cancel_background_job,
            // Packages
            commands::packages::start_install_dependency_job,
            commands::packages::install_dependency_elevated,
            commands::packages::start_uninstall_package_job,
            commands::packages::start_update_package_job,
            commands::packages::start_get_dependency_tree_job,
            commands::packages::check_dependency_tree_prereq,
            commands::packages::start_get_package_sizes_job,
            commands::packages::start_export_requirements_job,
            commands::packages::start_search_pypi_job,
            commands::packages::start_check_install_conflicts_job,
            commands::packages::evaluate_install_policy,
            commands::packages::start_preview_upgrade_job,
            commands::packages::start_why_is_installed_job,
            commands::packages::start_analyze_package_hygiene_job,
            // Venv lifecycle
            commands::venv::start_scan_venv_job,
            commands::venv::start_install_pip_in_venv_job,
            commands::venv::start_list_venvs_job,
            commands::venv::start_create_venv_with_template_job,
            commands::venv::get_rebuild_source_preview,
            commands::venv::start_rebuild_venv_from_project_job,
            commands::venv::start_clone_venv_job,
            commands::venv::start_diff_venvs_job,
            commands::venv::delete_venv,
            commands::venv::get_venv_mtime,
            commands::venv::start_get_venv_packages_job,
            commands::venv::start_get_venv_size_job,
            // System / managers / hygiene
            runtime_installers::list_system_pythons,
            runtime_installers::start_install_python_job,
            runtime_installers::install_python_elevated,
            runtime_installers::check_managers,
            runtime_installers::start_install_uv_job,
            runtime_installers::install_uv_elevated,
            runtime_installers::uv_install_command,
            commands::system::start_audit_environments_job,
            runtime_installers::start_list_python_versions_job,
            commands::system::check_app_update,
            commands::system::start_run_venv_script_job,
            commands::system::start_run_in_venv_job,
            commands::system::start_run_uv_project_job,
            // Lockfile + drift
            commands::lockfile::start_generate_lockfile_job,
            commands::lockfile::start_restore_from_lockfile_job,
            commands::lockfile::start_compute_lockfile_drift_job,
            // Project snapshots / rollback
            commands::snapshots::list_project_snapshots,
            commands::snapshots::start_create_project_snapshot_job,
            commands::snapshots::start_restore_project_snapshot_job,
            // Local-first AI
            commands::local_ai::check_local_ai_status,
            commands::local_ai::explain_environment_with_local_ai,
            // Project autodetect
            commands::project::start_detect_project_manifests_job,
            // Cache hygiene
            commands::cache::start_get_cache_summary_job,
            commands::cache::start_purge_cache_job,
            // Venv bundle export / import
            commands::bundle::start_export_venv_bundle_job,
            commands::bundle::read_bundle_manifest,
            commands::bundle::start_import_venv_bundle_job,
            // Files
            commands::files::read_env_file,
            commands::files::save_env_file,
            commands::files::read_env_entries,
            commands::files::save_env_entries,
            commands::files::get_pyvenv_cfg,
            commands::files::save_project_file,
            commands::files::export_support_bundle,
            commands::files::generate_docker_files,
            // Integrations
            commands::integrations::open_terminal,
            commands::integrations::open_terminal_with_venv_command,
            commands::integrations::open_terminal_activated,
            commands::integrations::open_in_vscode,
            commands::integrations_extra::get_vscode_interpreter_status,
            commands::integrations_extra::start_generate_vscode_config_job,
            commands::integrations_extra::start_register_jupyter_kernel_job,
            commands::integrations_extra::start_install_precommit_hooks_job,
            commands::integrations::run_docker_for_venv,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
