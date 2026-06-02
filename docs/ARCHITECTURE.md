# Architecture

VOrchestra is a local-first Tauri 2 desktop app. The frontend owns UI state and orchestration; the Rust backend owns filesystem access, subprocess execution, package introspection, and long-running jobs.

## Frontend

- `src/App.tsx` wires global state, overlays, and high-level routing.
- `src/hooks/app/` contains domain hooks split by responsibility:
  - `useAppInitialization.ts` bootstraps workspaces, cache, Python discovery, templates, and manager status.
  - `useWorkspaceOperations.ts` owns workspace scans, single-venv sync, and workspace CRUD.
  - `useVenvLifecycle.ts` owns create/delete/template-save flows.
  - `useStudioLoader.ts` loads Studio-adjacent data after selecting an environment.
  - `useUiPreferences.ts` owns global shortcuts, theme, and zoom.
- `src/components/Studio/` contains the environment Studio panels.
- `src/services/backgroundJobs.ts` is the frontend job observer for long-running backend work.

## Backend

- `src-tauri/src/lib.rs` registers Tauri commands and database migrations.
- `src-tauri/src/jobs.rs` tracks background job state, progress, logs, result, and cancellation.
- `src-tauri/src/helpers.rs` contains shared Python/venv helpers, parsers, and safety utilities.
- `src-tauri/src/process_utils.rs` contains process execution helpers, including streaming stdout/stderr support.
- `src-tauri/src/package_managers.rs` centralizes `pip` and `uv` command construction.
- `src-tauri/src/command_runner.rs` provides a narrow test seam for package-analysis command execution.
- `src-tauri/src/commands/` is split by feature area:
  - `venv.rs`: scan/create/clone/diff/details.
  - `packages.rs`: install/update/uninstall/tree/sizes/PyPI/package hygiene.
  - `diagnostics.rs`: diagnostics and security audit jobs.
  - `lockfile.rs`: freeze/restore/drift.
  - `cache.rs`: cache summary, duplicate wheel detection, purge.
  - `project.rs`: manifest autodetect.
  - `system.rs`: Python/runtime manager discovery and automation commands.
  - `integrations*.rs`: terminals, VS Code, Jupyter, pre-commit, Docker.
  - `bundle.rs`: export/import venv bundles.
  - `files.rs`: `.env`, `pyvenv.cfg`, and generated project files.

## Design Rules

- Anything that can recurse over directories, call Python, call pip/uv, or install packages should be a background job.
- UI should not auto-run expensive diagnostics on tab entry.
- Commands that mutate environments should surface progress and cancellation when possible.
- The app is local-first: no telemetry, no account, and network only for explicit package/search/audit operations.

## C4 Reference

See `docs/C4_MODEL.md` for context, container, component, background-job, SQLite/cache, and package-manager extension diagrams.
