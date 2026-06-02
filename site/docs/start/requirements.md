# Requirements

VOrchestra is a Tauri desktop app. Requirements differ depending on whether you run a released installer or build from source. The desktop app can open without every optional tool, but each workflow needs the matching local tool.

## Runtime baseline

Required for normal use:

- A supported desktop operating system: Linux, Windows, or macOS.
- Access to local project folders and Python environments.
- Python `3.x` when you want to create environments, inspect package metadata, or run Python-based diagnostics.

Strongly recommended:

- `pip`, because many package operations, helper installs, diagnostics, and fallback flows rely on it.
- `uv`, if you create environments often or use uv-native projects.

Optional workflow tools:

- `pipdeptree` for dependency tree support in pip environments.
- `pip-audit` for vulnerability scans.
- Docker for generated Docker manifests and build/run terminal workflows.
- Git for pre-commit setup and repository-aware project operations.
- VS Code CLI for editor integration and interpreter doctor workflows.
- Jupyter plus `ipykernel` for notebook kernel registration.
- Conda or Pixi when you want VOrchestra to inventory those native-manager environments read-only.

## Tool-to-feature map

Python:

- Create pip environments.
- Read installed distributions.
- Run metadata inspection scripts.
- Repair missing pip where supported.
- Execute automation scripts inside an environment.

pip:

- Install, update, and uninstall packages in pip environments.
- Export requirements.
- Run `pip check` diagnostics.
- Install helper tools such as `pipdeptree`, `pip-audit`, `ipykernel`, or `pre-commit`.

uv:

- Create fast environments.
- Run uv-targeted package operations.
- Run uv-native project flows such as `uv sync`, `uv lock`, `uv add`, `uv remove`, and `uv run` where supported.
- Target package installs at a selected Python executable with `uv pip --python`.

pipdeptree:

- Build rich dependency trees for pip environments.
- Feed Tree and Graph views when the selected manager does not provide a native tree.

pip-audit:

- Run vulnerability checks against installed packages.
- Show PyPA advisory data where available.
- Support security review workflows.

Docker:

- Use generated Dockerfile and compose-style project files.
- Open a terminal with build/run commands.

Git:

- Install pre-commit hooks.
- Validate project roots for repository-dependent workflows.

VS Code CLI:

- Open project folders from VOrchestra.
- Validate interpreter settings through VS Code Interpreter Doctor.

Jupyter and ipykernel:

- Register the selected environment as a Jupyter kernel.

Conda and Pixi:

- Show native-manager environments in inventory.
- Keep mutation read-only in VOrchestra until explicit native workflows are implemented and tested.

## Recommended installs

Install or upgrade pip in the target Python installation:

```bash
python -m ensurepip --upgrade
python -m pip install --upgrade pip
```

Install helper tools globally only if you want them available everywhere:

```bash
python -m pip install pipdeptree pip-audit ipykernel pre-commit
```

VOrchestra can also install missing helper tools inside the selected environment when a workflow needs them.

Install uv:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

On Windows, install uv with one of the official methods, for example PowerShell:

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

Install Docker Desktop on Windows/macOS, or Docker Engine on Linux, if you want container workflows.

Install VS Code CLI by enabling the `code` command from VS Code's command palette or installer options.

## Environment-scoped helper installs

For a pip environment:

```bash
/path/to/venv/bin/python -m pip install pipdeptree pip-audit ipykernel pre-commit
```

For a uv-managed environment:

```bash
uv pip install --python /path/to/venv/bin/python pipdeptree pip-audit ipykernel pre-commit
```

On Windows, use the environment Python inside `Scripts`:

```powershell
.\venv\Scripts\python.exe -m pip install pipdeptree pip-audit ipykernel pre-commit
```

## Version guidance

Python:

- Python `3.9+` is recommended for modern projects.
- Python `3.11+` is preferred for new environments when project constraints allow it.
- VOrchestra can inventory older environments, but package tooling support may vary.

pip:

- Keep pip reasonably current for dry-run previews, JSON output, and reliable installs.
- If preview behavior fails, upgrade pip inside the selected environment.

uv:

- Keep uv current when using uv-native project commands.
- uv CLI options can differ by version. If an uv command fails, check `uv --version` and `uv <command> --help`.

pipdeptree and pip-audit:

- Install them inside the selected environment when you want environment-specific results.
- Global installs are convenient but may not reflect every environment.

## Development requirements

Use these versions or newer when building from source:

- Node.js `20+`
- npm bundled with Node.js
- Rust `1.85+`
- Python `3.x`

Recommended development tools:

- uv
- Docker
- VS Code CLI
- pipdeptree
- pip-audit

## Linux WebKit dependencies

Released Linux packages include the built app, but source builds require Tauri WebKit and GTK dependencies.

On Debian/Ubuntu-like systems:

```bash
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libsoup-3.0-dev \
  libjavascriptcoregtk-4.1-dev
```

For Fedora-like systems, install the equivalent WebKitGTK, GTK, AppIndicator, and librsvg development packages.

For other distributions, follow the official Tauri Linux prerequisites for your package manager.

## Offline behavior

Works offline:

- Workspace scan.
- Existing environment inventory.
- Local package cataloging.
- Local dependency tree when required tooling is already installed.
- `.env` editing.
- VS Code settings inspection.
- Docker file generation.
- Repair guidance.

Needs network:

- Downloading package dependencies.
- PyPI search and fresh metadata.
- Security advisory retrieval.
- Installing uv, Docker, VS Code, or other external tools.

## Environment variables

`VORCHESTRA_SCAN_MAX_DEPTH` controls workspace scan recursion depth. It defaults to `16` and is clamped to `3..64`.

Example:

```bash
VORCHESTRA_SCAN_MAX_DEPTH=12 npm run tauri dev
```
