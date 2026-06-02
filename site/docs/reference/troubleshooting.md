# Troubleshooting

## `database is locked`

This usually means two write operations tried to update SQLite at the same time or a long scan kept writing while another mutation ran.

Actions:

- Wait for active scans/jobs to finish or cancel them.
- Avoid scanning very broad roots like `/`.
- Retry after the current job has stopped.
- Report the sequence if it repeats; include workspace path, action attempted and app logs.

## Package catalog loops or never finishes

Possible causes:

- Environment Python is broken.
- `pip` is missing.
- Manager type was detected incorrectly.
- A previous scan/job is still active.

Actions:

- Open Repair Wizard for the environment.
- Install missing `pip` or helper tools if prompted.
- Cancel active jobs and retry package load.
- Use a narrow workspace scan.

## Dependency tree says helper is missing

For pip environments, install `pipdeptree` in the selected environment:

```bash
python -m pip install pipdeptree
```

For uv environments, VOrchestra adapts commands where supported. If `uv tree` fails, check your uv version:

```bash
uv --version
uv tree --help
```

## Security scan unavailable

Install `pip-audit` in the selected environment:

```bash
python -m pip install pip-audit
```

If the environment has no `pip`, repair that first.

## Tauri build fails on Linux

Install WebKit/GTK prerequisites for your distribution. On Debian/Ubuntu-like systems:

```bash
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libsoup-3.0-dev \
  libjavascriptcoregtk-4.1-dev
```

## uv-created template has no packages

Check that the environment manager is detected as `uv`, not `pip`, and that project manifests are valid. If the issue repeats, include the template name, manager, manifest files and logs.

## Offline use

The app can run offline for inventory, local package cataloging, local diagnostics, `.env`, VS Code settings, Docker file generation and many repair views. Network is needed for PyPI search, package installation, security advisory retrieval and dependency downloads.
