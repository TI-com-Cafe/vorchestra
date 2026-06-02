# Requirements

VOrchestra is a Tauri desktop app. Requirements differ depending on whether you are running a released installer or building from source.

## Runtime requirements

Released desktop builds include the app runtime. You still need local tools for the workflows you want to use.

Python is required for environment creation and package inspection.

pip is recommended because many Python environments use it directly or indirectly.

uv is optional but recommended for fast environment creation and uv-native project workflows.

pipdeptree is optional and used for rich dependency tree support in pip environments.

pip-audit is optional and used for security audit.

Docker is optional and used for Docker file generation plus build/run terminal workflows.

Git is optional and used for pre-commit hooks and project workflows.

VS Code CLI is optional and used for interpreter setup and project integration.

Jupyter and ipykernel are optional and used for kernel registration.

Conda and Pixi are optional and currently detected as read-only inventory.

## Development requirements

Use these versions or newer:

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

On Debian/Ubuntu-like systems, install Tauri WebKit and GTK dependencies if building from source:

```bash
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libsoup-3.0-dev \
  libjavascriptcoregtk-4.1-dev
```

For other distributions, follow the Tauri Linux prerequisites for your package manager.

## Helper tool installation

Install helper tools globally only if you want them available everywhere. VOrchestra can also install missing helpers inside the selected environment.

```bash
python -m pip install --upgrade pip
python -m pip install pipdeptree pip-audit
```

Install uv:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

## Environment variables

`VORCHESTRA_SCAN_MAX_DEPTH` controls workspace scan recursion depth. It defaults to `16` and is clamped to `3..64`.

Example:

```bash
VORCHESTRA_SCAN_MAX_DEPTH=12 npm run tauri dev
```
