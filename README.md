<p align="center">
  <img src="./assets/vorchestra-icon.svg" alt="VOrchestra logo" width="128"/>
</p>

# VOrchestra

<p align="center"><em>Local-first orchestration for Python virtual environments.</em></p>

<p align="center">
  <a href="./LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg"/></a>
  <a href="https://github.com/TI-com-Cafe/vorchestra/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/TI-com-Cafe/vorchestra/actions/workflows/ci.yml/badge.svg"/></a>
  <img alt="Version" src="https://img.shields.io/badge/version-0.1.0-66d9ef"/>
  <img alt="Tauri" src="https://img.shields.io/badge/Tauri-2.x-f92672"/>
  <img alt="Status" src="https://img.shields.io/badge/status-pre--release-faa61a"/>
</p>

VOrchestra is a native desktop app for discovering, creating, inspecting, repairing, auditing, and operating Python virtual environments across local workspaces.

It is built for developers who manage many `.venv` folders and need one place to understand environment health, dependency drift, security posture, disk usage, project configuration, and daily automation.

> Current release: [`v0.1.0`](https://github.com/TI-com-Cafe/vorchestra/releases/tag/v0.1.0) pre-release. Native installers are available for Linux, Windows, and macOS.

## Product Positioning

VOrchestra does not try to replace `uv`, `pip`, VS Code, Conda, Pixi, Docker, or Jupyter.

It sits above them as a local control center:

- Inventory: find environments across workspaces.
- Diagnostics: understand health, drift, outdated packages, and security posture.
- Repair: guide safe fixes for broken, stale, or incomplete environments.
- Cleanup: reclaim cache and environment disk space intentionally.
- Operations: run package, lockfile, Docker, VS Code, Jupyter, pre-commit, and script workflows from one app.

## Download

Download the latest pre-release from:

https://github.com/TI-com-Cafe/vorchestra/releases/tag/v0.1.0

Available packages:

- Linux: `.AppImage`, `.deb`, `.rpm`
- Windows: `.exe`, `.msi`
- macOS: `.dmg` for Apple Silicon and Intel

## Screenshots

Screenshots are available in the documentation site and local screenshot capture notes live in [`assets/screenshots/README.md`](./assets/screenshots/README.md).

## Core Features

### Workspace Inventory

- Add one or more workspaces.
- Scan recursively for Python environments.
- Keep a local SQLite cache for fast startup.
- Mark a default workspace.
- Adopt untracked environments found on disk.
- Remove stale database entries when a folder no longer exists.
- Serialize SQLite writes and retry transient `database is locked` failures.
- Configure scan depth with `VORCHESTRA_SCAN_MAX_DEPTH`.

### Environment Creation

- Create environments using `pip` or `uv`.
- Create from built-in templates for common community workflows.
- Create custom templates from existing environments.
- Create from project manifests such as `requirements.txt`, `pyproject.toml`, `Pipfile`, `setup.py`, and `setup.cfg`.
- Use cancellable background jobs for template builds and package installs.
- Use local writable `UV_CACHE_DIR` for `uv` operations to avoid global cache permission failures.

### Project-First Mode

- Group environments by project root.
- Show project posture signals.
- Show best environment health.
- Detect manifests and installable inputs.
- Run project-level `uv sync`, `uv lock`, `uv run`, `uv add`, and `uv remove` where supported.
- Provide next-best actions such as scan, sync, repair, diagnostics, packages, or `uv sync`.

### Package Studio

- Package list with search, sort, and filters.
- Package count and disk allocation cards.
- Package install, uninstall, update, and export requirements.
- PyPI search with version selection.
- Install from PyPI, Test PyPI, Git, URL, local file, or local project.
- Compatibility check before package changes.
- Dependency tree and graph views.
- Package-size scans are separated from package cataloging so package lists can render first.
- Tree and graph views include search/collapse controls to remain usable on large environments.

### Health And Repair

- Environment Health Score.
- Repair Wizard with recommended next actions.
- Install missing `pip` when supported.
- Install helper tools such as `pipdeptree` and `pip-audit` when missing.
- Remove stale inventory entries without deleting files.
- Rebuild a broken environment from project sources.
- Rebuild Source Preview before destructive changes.
- Recoverable workspace-local trash for rebuild/delete flows.
- Export support bundles for bug reports.

### Diagnostics And Security

- Diagnostics do not auto-run when opening the tab.
- Heavy checks run as cancellable background jobs.
- Consistency checks through `pip` or `uv` depending on environment engine.
- Outdated package checks.
- Security scan through `pip-audit` and PyPA advisories.
- Missing `pip-audit` UI with install and terminal-command options.
- Package metadata audit:
  - license summary;
  - missing-license queue;
  - deprecated/inactive package hints;
  - suspicious package-name hints;
  - searchable/filterable review queue.
- CycloneDX SBOM export.

### Native Manager Inventory

Conda and Pixi environments are detected as read-only inventory.

VOrchestra can inspect and guide these environments, but it does not mutate native-manager metadata. Use Conda/Pixi for package mutation, then sync inventory in VOrchestra.

### Cleanup

- Cache summary.
- Cache purge for allow-listed cache directories.
- Duplicate wheel groups.
- Large and stale environment candidates.
- Missing database entries.
- Cleanup guidance before destructive action.

### Project Tools

- Structured `.env` editor.
- `.env.example` and `.env.template` awareness.
- Secret-like value masking.
- Raw `.env` edit mode.
- Read-only `pyvenv.cfg` viewer.
- Saved automation scripts.
- Quick tools such as pytest, ruff, black, and mypy.
- Open activated terminal.
- VS Code Interpreter Doctor.
- Generate VS Code settings.
- Register Jupyter kernels.
- Generate Docker files.
- Run Docker build/run in a terminal.
- Install pre-commit hooks.

## What VOrchestra Does Not Do Yet

- No Homebrew, winget, Flathub, or Snap distribution yet.
- No remote SSH workspace inventory yet.
- No full package mutation support for Conda/Pixi.
- No telemetry.
- No account or cloud sync.

## Requirements

### Development Requirements

- Node.js 20+
- npm
- Rust 1.85+
- Python 3.x

### Recommended Runtime Tools

- `uv` for fast environment creation and package operations.
- `pipdeptree` for dependency tree support in `pip` environments.
- `pip-audit` for security scans.
- Docker for Docker build/run actions.
- Git for pre-commit setup.
- VS Code CLI (`code`) for editor integration.
- Jupyter and `ipykernel` for kernel registration.
- Conda or Pixi if you want read-only native-manager inventory.

### Linux System Packages

Tauri/WebKit dependencies vary by distribution. On Debian/Ubuntu-like systems, you usually need packages similar to:

```bash
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libsoup-3.0-dev \
  libjavascriptcoregtk-4.1-dev
```

Check the Tauri prerequisites for your distribution if the build fails.

## Build From Source

```bash
git clone https://github.com/TI-com-Cafe/vorchestra.git
cd vorchestra
npm install
npm run tauri dev
```

Frontend-only development server:

```bash
npm run dev
```

Production build:

```bash
npm run tauri build
```

## Validation

Use targeted checks while developing:

```bash
npm run check:frontend
npm run test:frontend:product
npm run check:rust
npm run test:rust
```

Run the full project check before pushing larger changes:

```bash
npm run check
```

Other useful commands:

```bash
npm run test:frontend
npm run test:frontend:components
npm run test:frontend:hooks
npm run test:frontend:smoke
cd src-tauri && cargo fmt --all -- --check
cd src-tauri && cargo clippy --all-targets -- -D warnings
```

## Configuration

| Variable | Default | Purpose |
|---|---:|---|
| `VORCHESTRA_SCAN_MAX_DEPTH` | `16` | Maximum workspace scan depth. Values are clamped to `3..64`. |

## Data And Privacy

VOrchestra is local-first.

- No telemetry.
- No analytics.
- No account required.
- Project files are written only when explicitly requested.
- Workspace and environment metadata is stored locally through SQLite.
- Network is used only for network-dependent workflows such as PyPI search, package install/update checks, and advisory lookups.

## Architecture Overview

```text
src/
  App.tsx                         # Main shell and overlay routing
  components/                     # Product screens, Studio tabs, overlays, modals
  constants/                      # Built-in templates and UI constants
  hooks/app/                      # Domain hooks for app state and lifecycle
  hooks/studio/                   # Studio-specific controllers
  services/                       # SQLite/package/background job facades
  types/                          # Shared TypeScript interfaces
  utils/                          # Shared frontend utilities

src-tauri/
  src/lib.rs                      # Tauri setup, migrations, command registration
  src/jobs.rs                     # Background job state/cancellation
  src/commands/                   # Tauri command modules by domain
  src/*                           # Parsers, package helpers, process utilities, reports
```

Heavy work runs in Rust and is moved off the UI thread where needed. Long-running operations are exposed through background jobs and cancellation where supported.

## Troubleshooting

### `database is locked`

Close other running VOrchestra instances and retry. VOrchestra serializes frontend writes and retries transient locks, but another process can still hold the database.

### `No module named pip`

Some `uv` environments do not include `pip`. VOrchestra uses `uv pip ... --python <venv_python>` where possible. Use Repair to install missing `pip` only for environments where that is safe.

### Conda/Pixi looks read-only

This is intentional. Use the native manager for mutation:

```bash
conda list
conda env export
conda update --all --dry-run
```

```bash
pixi list
pixi lock
pixi install
```

### Dependency tree requires `pipdeptree`

Install it into the selected environment:

```bash
pip install pipdeptree
```

The Tree screen can install it directly or open a terminal with the command ready.

### Security scan requires `pip-audit`

For `pip`:

```bash
pip install pip-audit
```

For `uv`:

```bash
uv pip install --python "<venv>/bin/python" pip-audit
```

The Security Scan screen can install it directly or open a terminal with the correct command.

### VS Code uses the wrong interpreter

Open Studio -> Repair or Project Tools and use VS Code Interpreter Doctor.

### Docker action fails

Confirm Docker is installed and running. Save generated manifests before using Build & Run.

## Documentation

- [Published documentation site](https://ti-com-cafe.github.io/vorchestra/)
- [Architecture](./docs/ARCHITECTURE.md)
- [Command model](./docs/COMMANDS.md)
- [Background jobs](./docs/JOBS.md)
- [Developer contribution notes](./docs/CONTRIBUTING_DEV.md)
- [Good first issue candidates](./docs/GOOD_FIRST_ISSUES.md)
- [Language policy](./docs/LANGUAGE.md)
- [Release process](./RELEASE.md)
- [Roadmap](./ROADMAP.md)
- [Changelog](./CHANGELOG.md)

## Contributing

Contributions are welcome after the first public repository reset.

Start with [`CONTRIBUTING.md`](./CONTRIBUTING.md), then check [`docs/GOOD_FIRST_ISSUES.md`](./docs/GOOD_FIRST_ISSUES.md) for scoped starter work.

## Security

Please report vulnerabilities privately using GitHub Security Advisories. Do not open public issues for security reports.

## License

Apache-2.0. See [`LICENSE`](./LICENSE).

---

Built by Marco Antero.
