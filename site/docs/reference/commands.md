# Command surface

Tauri commands are internal app API. Treat them as semi-public because frontend behavior depends on names and payloads.

## Naming

- Long-running commands should use `start_*_job` and return a `jobId`.
- Read-only quick commands may return values directly.
- Elevated or tool-install commands should be explicit.

## Heavy job areas

- Workspace scans.
- Venv details, package reads and size scans.
- Package install/update/uninstall/export/tree/hygiene/conflict preview.
- Diagnostics and security audit.
- Lockfile generate/restore/drift.
- Clone/diff/import/export bundle.
- Cache summary and purge.
- Runtime install/listing.
- Studio integrations for VS Code, Jupyter, pre-commit and Docker.

## Safety guidelines

- Never execute user-provided shell text through a shell unless quoting is controlled and the source is trusted.
- Prefer `Command` args arrays over interpolated strings.
- Validate filesystem paths before destructive operations.
- Use `spawn_blocking` for blocking filesystem/subprocess work.
- Use cancellation-aware command execution when a child process can take time.
