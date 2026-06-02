# Requirements

## Development requirements

| Tool | Minimum | Purpose |
|---|---:|---|
| Node.js | 20+ | Frontend tooling and Docusaurus docs |
| npm | bundled with Node | Dependency install and scripts |
| Rust | 1.85+ | Tauri backend |
| Python | 3.x | Environment creation and package inspection |

## Runtime tools

| Tool | Required | Purpose |
|---|---|---|
| `pip` | Recommended | Default package manager and fallback operations |
| `uv` | Optional | Fast creation, sync, lock, add/remove, uv-native project flows |
| `pipdeptree` | Optional | Dependency tree and graph support for pip environments |
| `pip-audit` | Optional | Security scan through PyPA advisories |
| Docker | Optional | Docker file generation and build/run terminal action |
| Git | Optional | pre-commit setup and project operations |
| VS Code CLI | Optional | Interpreter doctor and settings integration |
| Jupyter/ipykernel | Optional | Kernel registration |
| Conda/Pixi | Optional | Read-only native manager inventory |

## Linux WebKit dependencies

On Debian/Ubuntu-like systems, Tauri usually needs packages similar to:

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

## Environment variables

| Variable | Default | Purpose |
|---|---:|---|
| `VORCHESTRA_SCAN_MAX_DEPTH` | `16` | Maximum workspace scan depth, clamped to `3..64`. |
