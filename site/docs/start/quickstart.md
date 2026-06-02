# Quick start

VOrchestra is currently distributed from source. You need Node.js, npm, Rust, and Python.

## Clone and run

```bash
git clone https://github.com/TI-com-Cafe/vorchestra.git
cd vorchestra
npm install
npm run tauri dev
```

The app opens as a Tauri desktop window.

## First run flow

1. Add a workspace that contains Python projects.
2. Scan the workspace.
3. Select an environment or create a new one.
4. Open Studio for that environment.
5. Load packages, run diagnostics, review security, and inspect repair suggestions.

## Recommended tools

Install these if you want the full product surface:

```bash
python -m pip install --upgrade pip
pip install pipdeptree pip-audit
curl -LsSf https://astral.sh/uv/install.sh | sh
```

`pipdeptree` enables richer dependency tree views. `pip-audit` enables security scans. `uv` enables faster environment creation and project workflows.
