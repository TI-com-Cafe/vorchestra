# C4 Model

VOrchestra is a local-first desktop application for managing Python environments across workspaces. It coordinates existing tools instead of replacing them.

## Context

```mermaid
flowchart LR
  User[Developer / data scientist] --> App[VOrchestra desktop app]
  App --> Files[Local workspaces and venvs]
  App --> Python[Python interpreters]
  App --> Pip[pip]
  App --> Uv[uv]
  App --> Audit[pip-audit]
  App --> Tree[pipdeptree / metadata tree]
  App --> Editor[VS Code]
  App --> Docker[Docker]
  App --> Jupyter[Jupyter kernels]
  App --> PyPI[PyPI metadata]
```

Network use is explicit. PyPI search, package installation, security audit, and metadata refresh may need network access. Workspace scanning, inventory, local diagnostics, `.env` editing, VS Code doctor, and most repair flows are local.

## Containers

```mermaid
flowchart TB
  UI[React + TypeScript UI] --> Services[Frontend services and hooks]
  Services --> Tauri[Tauri command boundary]
  Tauri --> Jobs[Rust background jobs]
  Tauri --> Commands[Rust command modules]
  Commands --> Managers[Package manager abstraction]
  Commands --> Runner[Command runner]
  Commands --> Cache[PyPI metadata cache]
  Commands --> SQLite[SQLite plugin database]
  Jobs --> Processes[External processes]
  Processes --> Pip[pip]
  Processes --> Uv[uv]
  Processes --> Python[Python scripts]
  Processes --> Tools[pip-audit / pipdeptree / Docker / VS Code]
```

## Components

```mermaid
flowchart LR
  Studio[Studio Modal] --> Packages[Package Studio]
  Studio --> Diagnostics[Diagnostics / Security]
  Studio --> Repair[Repair Wizard]
  Studio --> Automation[Automation]
  Studio --> Config[Config / env vars]
  Studio --> Deploy[Docker / Jupyter / VS Code / pre-commit]

  Packages --> PackageJobs[package_jobs.rs]
  Packages --> PackageOps[package_ops.rs]
  Packages --> PackageAnalysis[package_analysis.rs]
  PackageOps --> Managers[package_managers.rs]
  PackageAnalysis --> Runner[command_runner.rs]

  Diagnostics --> DiagnosticsCommands[diagnostics.rs]
  Repair --> VenvCommands[venv.rs]
  Deploy --> Integrations[integrations*.rs]
  Config --> Files[files.rs]
```

## Background Jobs

```mermaid
sequenceDiagram
  participant UI as React UI
  participant Tauri as Tauri command
  participant Jobs as jobs.rs
  participant Worker as spawn_blocking worker
  participant Proc as External process

  UI->>Tauri: start_*_job(args)
  Tauri->>Jobs: create_background_job()
  Tauri-->>UI: job_id
  Tauri->>Worker: spawn_blocking(work)
  Worker->>Jobs: set_job_progress(message, progress)
  Worker->>Proc: run command
  Proc-->>Worker: stdout/stderr lines
  Worker->>Jobs: append_job_log(stream, line)
  Jobs-->>UI: job update event
  Worker->>Jobs: set_job_status(success/error/cancelled)
  UI->>Tauri: get_background_job(job_id) fallback
```

Use jobs for scans, diagnostics, security checks, installs, updates, deletes, package sizes, dependency trees, Python installs, `uv sync`, lockfile restore, bundle import, rebuild, and clone restore.

## SQLite And Cache

```mermaid
flowchart TB
  WorkspaceScan[Workspace scan job] --> ScanResult[Discovered environments]
  ScanResult --> DbQueue[Serialized DB update path]
  DbQueue --> SQLite[(SQLite)]
  UI[React UI] --> SQLite
  PyPISearch[PyPI search] --> Cache[Local metadata cache]
  Cache --> PyPI[PyPI JSON API]
  Cache --> UI
```

Do not let stale scan results recreate deleted venv entries. Prefer local cache fallback when network metadata fails and stale cached data exists.

## Adding A Package Manager

1. Add a manager implementation in `src-tauri/src/package_managers.rs`.
2. Implement command builders for install, uninstall, update, freeze, check, outdated, requirements install, preview install, and preview upgrade.
3. Add command construction tests using a fake venv path.
4. Decide whether mutations are safe. If not, keep the manager read-only like Conda/Pixi.
5. Update diagnostics, package tree, repair actions, and install hints only after command builders are tested.
6. Add UI copy that explains what is editable and what remains native-manager-only.
