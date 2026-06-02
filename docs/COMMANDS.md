# Command Surface

Tauri commands are internal app API. Treat them as semi-public because frontend behavior depends on their names and payloads.

## Naming

- Long-running commands should use `start_*_job` and return a `jobId`.
- Read-only quick commands may return values directly.
- Elevated commands should be explicit, e.g. `install_dependency_elevated`.

## Current Heavy Job Areas

- Workspace scans.
- Venv details/package reads/size scans.
- Package install/update/uninstall/export/tree/hygiene/conflict preview.
- Diagnostics/security audit.
- Lockfile generate/restore/drift.
- Clone/diff/import/export bundle.
- Cache summary/purge.
- Runtime install/listing.
- Studio integrations for VS Code/Jupyter/pre-commit.

## Safety Guidelines

- Never execute user-provided shell text through a shell unless quoting is controlled.
- Prefer `Command` args arrays over interpolated strings.
- Validate filesystem paths before destructive operations.
- Use `spawn_blocking` for blocking filesystem/subprocess work.
- Use `run_command_with_timeout_and_cancel` when a child process can take time.
