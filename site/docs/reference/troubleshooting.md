# Troubleshooting

Use this page to diagnose common issues before opening a bug report.

## `database is locked`

This usually means two write operations tried to update SQLite at the same time or a long scan kept writing while another mutation ran.

Actions:

- Wait for active scans/jobs to finish or cancel them.
- Avoid scanning very broad roots like `/`.
- Retry after the current job has stopped.
- If deleting or recreating an environment, cancel active scans for the same workspace first.
- Report the sequence if it repeats. Include workspace path, action attempted, environment path, and visible job logs.

## Workspace scan keeps running after deleting an environment

A workspace scan is a background job. Deleting an environment does not automatically stop an already-running scan.

Actions:

- Cancel the scan before deleting or recreating the same environment path.
- Re-scan after deletion if the inventory looks stale.
- If the deleted path reappears, report the scan path and deleted environment path.

## Cannot remove `/` workspace

A root workspace can be expensive and noisy. If removing it fails:

- Make sure no scan is running for `/`.
- Cancel active jobs.
- Retry removal.
- Restart the app if a stale UI state remains.

Use narrower workspaces for normal use.

## Package catalog loops or never finishes

Possible causes:

- Environment Python is broken.
- `pip` is missing.
- Manager type was detected incorrectly.
- A previous scan/job is still active.
- The environment path was deleted while a package read was running.

Actions:

- Open Repair Wizard for the environment.
- Install missing `pip` or helper tools if prompted.
- Cancel active jobs and retry package load.
- Use a narrow workspace scan.
- Try opening an activated terminal and running `python --version` and `python -m pip --version` inside the environment.

## Package list says no installed packages but a count appears elsewhere

This can happen when package summary state and package list state are out of sync after a cancelled or failed catalog job.

Actions:

- Refresh the package catalog.
- Cancel any active package job.
- Reopen Studio.
- If it repeats, report the manager type and job logs.

## Dependency tree says helper is missing

For pip environments, install `pipdeptree` in the selected environment:

```bash
python -m pip install pipdeptree
```

VOrchestra should also show an install button and an open-terminal command for the selected environment.

For uv environments, VOrchestra adapts commands where supported. If `uv tree` fails, check your uv version:

```bash
uv --version
uv tree --help
```

## Dependency graph overlaps or is too dense

Use graph controls:

- Start with Top only.
- Use Level 1 or Level 2 before Full capped.
- Click dependency hubs to focus.
- Use Tree search for exact package inspection.

## Security scan unavailable

Install `pip-audit` in the selected environment:

```bash
python -m pip install pip-audit
```

If the environment has no `pip`, repair that first.

For uv environments, use uv-targeted installation when shown by the app.

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

Check:

- Environment manager is detected as `uv`, not `pip`.
- Template package list is not empty.
- Project manifests are valid.
- Job logs show package installation attempts.

If the issue repeats, include template name, manager, manifest files, uv version, and logs.

## `uv tree` unexpected argument

uv CLI versions differ. Check supported arguments:

```bash
uv --version
uv tree --help
```

Report the uv version and the exact error.

## Offline use

The app can run offline for:

- Workspace scan.
- Local package cataloging.
- Local diagnostics.
- `.env` editing.
- VS Code settings.
- Docker file generation.
- Repair views.
- Local dependency tree when metadata/tooling exists.

Network is needed for:

- PyPI search.
- Package installation.
- Security advisory retrieval.
- Dependency downloads.
- Fresh package metadata cache.
