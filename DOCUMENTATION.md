# VOrchestra — Technical Documentation

## Overview
VOrchestra is a Tauri v2 desktop application for discovering, creating, auditing, and maintaining Python virtual environments. It combines:
- Frontend: React 19 + TypeScript + Tailwind CSS v4
- Backend: Rust (Tauri commands)
- Local persistence: SQLite via `tauri-plugin-sql`

Goal: centralize the venv lifecycle (pip/uv) with local cache, diagnostics, and visual dependency tools.

## Architecture

### Frontend (`src/`)
- `App.tsx` — global state, main flow, modal orchestration, `invoke` calls.
- `components/Sidebar.tsx` — workspaces, theme, global hygiene.
- `components/HygieneOverlay.tsx` — DB ↔ disk audit (prune/adopt).
- `components/CommandPalette.tsx` — global search (`Ctrl/Cmd + K`).
- `components/Studio/*` — per-environment panels (packages, automation, config, diagnostics, deploy, PyPI explorer).
- `services/db.ts` — SQLite access on the frontend (cache + metadata).
- `services/packageManager.ts` — package operations facade keyed by `manager_type`.

### Backend (`src-tauri/src/lib.rs`)
Responsibilities:
- Discover venvs on the filesystem (WalkDir with filters).
- Run package commands (`pip`, `uv`, `pipdeptree`, `pip-audit`).
- Collect diagnostic data (health, outdated, security).
- Utility ops (open terminal, VS Code, Docker file generation, requirements export).
- Manage local DB migrations.
- Background jobs with cancellation for long-running ops.

### Persistence (SQLite)
Database: `vorchestra.db` in the platform-specific app data directory.

Tables (created via migrations):
1. `workspaces` (`path`, `is_default`)
2. `venvs` (`workspace_path`, `name`, `path`, `version`, `status`, `issue`, `last_modified`, `manager_type`, `pyproject_path`)
3. `scripts` (`venv_path`, `name`, `command`)
4. `custom_templates` (`name`, `packages` — JSON-serialized)

## Boot Flow
On app start (`App.tsx`):
1. Load saved workspaces and pick the default.
2. Load venv cache from SQLite.
3. Discover Python interpreters on `PATH`.
4. Load custom templates.
5. Detect installed managers (`uv`, `poetry`, `pdm`); prefer `uv` when available.

## Implemented Features

### 1. Workspaces & Discovery
- Add/remove/default workspace.
- Recursive venv scan via `start_list_venvs_job`.
- Per-workspace local cache for fast reload.

### 2. Environment Creation
- Engine choice: `pip` or `uv` (when detected).
- Python binary picker.
- Automatic template-based package install after creation.

### 3. Environment Cards
Per-environment actions:
- Single-env sync (`start_scan_venv_job`)
- Open in VS Code
- Open terminal
- Open Studio
- Delete environment from disk (`delete_venv`)

### 4. Studio (per-environment overlay)
#### Packages
- `pip freeze` + total size.
- Per-package size estimation.
- Update / uninstall packages.
- Export `requirements.txt` to project root.
- Three views: flat list, dependency tree (pipdeptree / Python introspection for uv), interactive React Flow graph.

#### Automation
- Persist Python snippets per environment.
- Run scripts via the venv's own `python -c`.

#### Config
- Edit `.env` in the project root (parent of the venv).
- Read-only `pyvenv.cfg` viewer.

#### Diagnostics
- Consistency via `pip check` (`uv pip check` for uv-managed envs).
- Outdated packages via `pip list --outdated --format=json`.
- Security audit via `pip-audit` (with `uvx` fallback for uv envs).
- Cancellable background jobs.

#### Deploy
- Generate `Dockerfile` and `docker-compose.yml` in memory.
- **Save to Project**: writes the manifests to the project root.

#### PyPI Explorer
- Search PyPI from inside the app.
- Version picker.
- Pre-install conflict check (`--dry-run`).
- One-click install.

### 5. Global Hygiene
DB ↔ disk audit:
- `broken_links`: DB entries with no folder on disk.
- `untracked_venvs`: venvs on disk with no DB record.

Actions:
- `Prune`: remove dead DB entry.
- `Adopt`: register an orphan venv into the matching workspace.

## Tauri Commands

Discovery / lifecycle: `start_list_venvs_job`, `start_scan_venv_job`, `start_create_venv_with_template_job`, `delete_venv`, `get_venv_mtime`, `start_get_venv_packages_job`, `start_get_venv_size_job`.

Packages: `start_install_dependency_job`, `install_dependency_elevated`, `start_uninstall_package_job`, `start_update_package_job`, `start_get_dependency_tree_job`, `check_dependency_tree_prereq`, `start_get_package_sizes_job`, `start_export_requirements_job`, `start_search_pypi_job`, `start_check_install_conflicts_job`.

Diagnostics: `start_diagnostics_job`, `start_security_audit_job`, `start_package_metadata_audit_job`, `export_package_sbom`, `get_background_job`, `cancel_background_job`.

Config / files: `read_env_file`, `save_env_file`, `get_pyvenv_cfg`, `save_project_file`.

System integration: `open_terminal`, `open_terminal_with_venv_command`, `open_in_vscode`.

Support: `list_system_pythons`, `check_managers`, `start_audit_environments_job`, `generate_docker_files`, `start_get_cache_summary_job`, `start_purge_cache_job`.

## External Dependencies

Required:
- Python 3.x
- Node.js 20+
- Rust 1.85+

Optional / auto-detected:
- `uv` — fast venv creation and installs.
- `pipdeptree` — dependency tree for pip-managed envs.
- `pip-audit` — security auditing.
- VS Code CLI (`code`) — "Open in VS Code" action.

## Configuration

| Variable | Default | Range | Purpose |
|---|---|---|---|
| `VORCHESTRA_SCAN_MAX_DEPTH` | `16` | 3–64 | Maximum directory depth for venv scanning |

## Engine Detection
`detect_manager_type` resolves the engine for a venv in this order:
1. `.vorchestra-engine` marker file inside the venv (`pip` or `uv`).
2. `pyvenv.cfg` line starting with `uv =` (uv writes this).
3. `uv.lock` in the venv or its parent.
4. Default to `pip`.

The marker file is written by VOrchestra at venv creation time.

## Background Jobs
Long-running operations (full diagnostics, security audit) run as background jobs:
- Started via `start_*_job` returning a `job_id`.
- Polled via `get_background_job(job_id)` until status is `success` / `error` / `cancelled`.
- Cancelled via `cancel_background_job(job_id)`.
- Finished jobs are garbage-collected after 10 minutes.

## File Map
- Frontend:
  - `src/App.tsx`
  - `src/components/**`
  - `src/services/db.ts`
  - `src/services/packageManager.ts`
- Backend:
  - `src-tauri/src/lib.rs`
  - `src-tauri/Cargo.toml`
  - `src-tauri/tauri.conf.json`

## Known Limitations & Future Work
1. Security audit results require `pip-audit` to be installed in the target environment (or available via `uvx`).
2. Deep dependency graphs can become heavy in large environments — tree depth is bounded as a mitigation.
3. No automated test suite yet (planned for v0.3).
4. No code-signed binaries yet (planned for v0.4).
